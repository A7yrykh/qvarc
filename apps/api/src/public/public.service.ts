import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { cancellationOutcome, cancellationPenaltyMinor, depositApplies, seasonOf, type CancellationTier, type DepositPolicy } from '../../../../packages/domain/src';
import { setActor, type Database } from '../../../../packages/db/src';
import { AvailabilityService } from '../bookings/availability.service';
import { BookingsService } from '../bookings/bookings.service';
import { AuditService } from '../common/audit.service';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import { PaymentsService } from '../payments/payments.service';
import type { OffersQuery, PublicBookingBody } from './public.schemas';

/** Версия текста согласия на обработку ПДн. Меняется вместе с текстом на сайте. */
export const PD_CONSENT_VERSION = 'pd-2026-10';
export const MARKETING_CONSENT_VERSION = 'marketing-2026-10';

/** Сезонный депозит для показа гостю: действует ли он для этой даты заезда и с какого срока. */
function depositRule(policy: unknown, arrival: string) {
  const p = policy as DepositPolicy | null;
  const season = p ? seasonOf(p.seasons, arrival) : null;
  return p && season ? { season: season.name, daysBefore: p.days_before } : null;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest();

/** Модуль бронирования для сайта: поиск, бронь с оплатой, ссылка гостя для просмотра и отмены. */
@Injectable()
export class PublicService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly availability: AvailabilityService,
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  async property(code: string) {
    const p = await this.db
      .selectFrom('property')
      .select(['id', 'code', 'name', 'timezone', 'check_in_time', 'check_out_time', 'hold_minutes'])
      .where('code', '=', code)
      .executeTakeFirst();
    if (!p) throw new NotFoundException('Объект не найден');
    return p;
  }

  async info(code: string) {
    const p = await this.property(code);
    const { today } = await this.availability.propertyToday(p.id);
    return { code: p.code, name: p.name, checkInTime: p.check_in_time.slice(0, 5), checkOutTime: p.check_out_time.slice(0, 5), today, holdMinutes: p.hold_minutes };
  }

  async offers(code: string, q: z.infer<typeof OffersQuery>) {
    const p = await this.property(code);
    const found = await this.availability.search(p.id, { arrival: q.arrival, departure: q.departure, adults: q.adults, children: q.children.length, publicOnly: true });
    const plans = await this.db
      .selectFrom('rate_plan')
      .select(['id', 'cancellation_policy', 'prepayment_policy', 'deposit_policy', 'meal_plan', 'is_refundable'])
      .where('property_id', '=', p.id)
      .execute();
    const planById = new Map(plans.map((x) => [x.id, x]));
    return found
      .map((t) => {
        const offers = t.offers
          .filter((o) => o.bookable || o.restrictions.every((r) => !['no_price', 'too_many_guests', 'closed'].includes(r.code)))
          .map((o) => {
            const plan = planById.get(o.ratePlan.id)!;
            return {
              ratePlan: { id: o.ratePlan.id, name: o.ratePlan.name, mealPlan: o.ratePlan.meal_plan, isRefundable: o.ratePlan.is_refundable },
              bookable: o.bookable && t.freeUnits > 0,
              restrictions: o.restrictions,
              nights: o.nights,
              totalMinor: o.totalMinor,
              prepaymentDueMinor: o.prepaymentDueMinor,
              cancellationPolicy: plan.is_refundable ? (plan.cancellation_policy as unknown as CancellationTier[]) : null,
              depositRule: plan.is_refundable ? depositRule(plan.deposit_policy, q.arrival) : null,
            };
          });
        const { id, name, kind, area_m2, max_occupancy, amenities, photos, description } = t.accommodationType;
        return {
          accommodationType: { id, name, kind, areaM2: area_m2 === null ? null : Number(area_m2), maxOccupancy: max_occupancy, amenities, photos, description },
          soldOut: t.freeUnits === 0,
          // Точное число свободных номеров не раскрываем, только «последний номер»
          lastOne: t.freeUnits === 1,
          offers,
        };
      })
      .filter((t) => t.offers.length > 0 || t.soldOut);
  }

  async createBooking(code: string, input: z.infer<typeof PublicBookingBody>, ip: string | null) {
    const p = await this.property(code);
    const plan = await this.db
      .selectFrom('rate_plan as rp')
      .innerJoin('rate_plan_type as pt', 'pt.rate_plan_id', 'rp.id')
      .select(['rp.id', 'rp.prepayment_policy'])
      .where('rp.id', '=', input.ratePlanId)
      .where('rp.property_id', '=', p.id)
      .where('rp.is_active', '=', true)
      .where('rp.is_public', '=', true)
      .where('rp.promo_only', '=', false)
      .where('pt.accommodation_type_id', '=', input.accommodationTypeId)
      .executeTakeFirst();
    if (!plan) throw new NotFoundException('Тариф недоступен для бронирования на сайте');

    const quote = await this.availability.quote(p.id, {
      accommodationTypeId: input.accommodationTypeId,
      ratePlanId: input.ratePlanId,
      arrival: input.arrival,
      departure: input.departure,
      adults: input.adults,
      children: input.childrenAges.length,
    });
    const needsPayment = quote.prepaymentDueMinor > 0;
    const token = randomBytes(32).toString('base64url');

    const created = await this.bookings.create(
      { user: null, propertyId: p.id, ip, source: 'booking_widget' },
      {
        guest: { ...input.guest, middleName: input.guest.middleName ?? null },
        accommodationTypeId: input.accommodationTypeId,
        ratePlanId: input.ratePlanId,
        arrival: input.arrival,
        departure: input.departure,
        adults: input.adults,
        childrenAges: input.childrenAges,
        status: needsPayment ? 'pending_payment' : 'confirmed',
        channelCode: 'direct_site',
        specialRequests: input.specialRequests ?? null,
        idempotencyKey: `web:${input.idempotencyKey}`,
        overrideRestrictions: false,
      },
      async (trx, ids) => {
        await trx.updateTable('booking').set({ manage_token_hash: hashToken(token), utm: input.utm ? JSON.stringify(input.utm) : null }).where('id', '=', ids.bookingId).execute();
        const now = new Date();
        await trx
          .insertInto('guest_consent')
          .values([
            { guest_id: ids.guestId, kind: 'pd_processing', text_version: PD_CONSENT_VERSION, granted_at: now, source: 'booking_widget', ip },
            ...(input.consents.marketing
              ? [{ guest_id: ids.guestId, kind: 'marketing_email', text_version: MARKETING_CONSENT_VERSION, granted_at: now, source: 'booking_widget', ip }]
              : []),
          ])
          .execute();
      },
    );

    // Повторная отправка формы: та же бронь, но ссылку гостя заново не выдаём (её хэш уже сохранён)
    if (created.duplicate) {
      throw new ConflictException({ message: 'Эта бронь уже создана. Ссылка на неё отправлена на почту.', code: 'duplicate_booking', number: created.number });
    }

    let confirmationUrl: string | null = null;
    if (created.status === 'pending_payment') {
      const pay = await this.payments.startBookingPayment({
        bookingId: created.id,
        amountMinor: created.prepaymentDueMinor,
        purpose: 'prepayment',
        idempotencyKey: `web:${input.idempotencyKey}:pay1`,
        returnUrl: `${this.config.bookingSiteUrl}/b/${token}`,
      });
      confirmationUrl = pay.confirmationUrl;
    }
    return { number: created.number, status: created.status, manageToken: token, confirmationUrl };
  }

  private async byToken(token: string, trx: Database = this.db) {
    const b = await trx
      .selectFrom('booking as b')
      .innerJoin('property as p', 'p.id', 'b.property_id')
      .select(['b.id', 'b.property_id', 'p.code as property_code', 'b.status'])
      .where('b.manage_token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!b) throw new NotFoundException('Бронь не найдена');
    return b;
  }

  /** Бронь по ссылке гостя. Перед показом сверяет незавершённые платежи с эквайером. */
  async manage(token: string) {
    const ref = await this.byToken(token);
    const pending = await this.db.selectFrom('payment').select('id').where('booking_id', '=', ref.id).where('status', '=', 'pending').execute();
    for (const p of pending) await this.payments.syncPayment(p.id);

    const b = await this.db
      .selectFrom('booking as b')
      .innerJoin('guest as g', 'g.id', 'b.booker_guest_id')
      .innerJoin('booking_stay as s', 's.booking_id', 'b.id')
      .innerJoin('accommodation_type as t', 't.id', 's.accommodation_type_id')
      .leftJoin('rate_plan as rp', 'rp.id', 's.rate_plan_id')
      .innerJoin('property as p', 'p.id', 'b.property_id')
      .select([
        'b.id', 'b.number', 'b.status', 'b.payment_state', 'b.arrival', 'b.departure', 'b.adults', 'b.children_ages', 'b.total_minor',
        'b.prepayment_due_minor', 'b.hold_expires_at', 'b.special_requests', 'g.last_name', 'g.first_name', 't.name as type_name',
        'rp.name as rate_plan_name', 'rp.cancellation_policy', 'rp.deposit_policy', 'rp.is_refundable', 'p.name as property_name', 'p.timezone',
        'p.check_in_time', 'p.check_out_time',
      ])
      .where('b.id', '=', ref.id)
      .executeTakeFirstOrThrow();
    const paid = await this.payments.paidMinor(this.db, b.id);
    const kept = await this.db.selectFrom('guest_deposit').select(['balance_minor', 'season']).where('source_booking_id', '=', b.id).executeTakeFirst();
    const { today } = await this.availability.propertyToday(ref.property_id);
    const cancellable = ['pending_payment', 'confirmed', 'pending_confirmation'].includes(b.status) && today <= b.arrival;
    const penalty = cancellable ? await this.penalty(b, today) : null;
    const deposit = cancellable && b.status !== 'pending_payment' && b.is_refundable !== false && depositApplies(b.deposit_policy as DepositPolicy | null, b.arrival, today);
    return {
      number: b.number,
      status: b.status,
      paymentState: b.payment_state,
      propertyName: b.property_name,
      arrival: b.arrival,
      departure: b.departure,
      checkInTime: b.check_in_time.slice(0, 5),
      checkOutTime: b.check_out_time.slice(0, 5),
      adults: b.adults,
      childrenAges: b.children_ages,
      guestName: `${b.first_name} ${b.last_name}`,
      accommodation: b.type_name,
      ratePlan: b.rate_plan_name,
      cancellationPolicy: b.is_refundable ? b.cancellation_policy : null,
      depositRule: b.is_refundable ? depositRule(b.deposit_policy, b.arrival) : null,
      totalMinor: b.total_minor,
      prepaymentDueMinor: b.prepayment_due_minor,
      paidMinor: paid,
      holdExpiresAt: b.hold_expires_at,
      canPay: b.status === 'pending_payment' && !!b.hold_expires_at && new Date(b.hold_expires_at) > new Date(),
      cancellation: cancellable ? cancellationOutcome(penalty!, paid, deposit) : null,
      depositMinor: kept ? Number(kept.balance_minor) : 0,
    };
  }

  /** Удержание при отмене: неоплаченная бронь отменяется без удержания. */
  private async penalty(b: { id: string; status: string; is_refundable: boolean | null; cancellation_policy: unknown; total_minor: number; arrival: string }, today: string, trx: Database = this.db) {
    if (b.status === 'pending_payment') return 0;
    if (b.is_refundable === false) return b.total_minor;
    const nights = await trx
      .selectFrom('booking_night_price as n')
      .innerJoin('booking_stay as s', 's.id', 'n.booking_stay_id')
      .select(['n.amount_minor'])
      .where('s.booking_id', '=', b.id)
      .orderBy('n.night')
      .execute();
    return cancellationPenaltyMinor(b.cancellation_policy as CancellationTier[], b.total_minor, b.arrival, today, nights.map((n) => Number(n.amount_minor)));
  }

  /** Повторная попытка оплаты, пока номер удерживается. */
  async pay(token: string, attemptKey: string) {
    const info = await this.manage(token);
    if (!info.canPay) throw new ConflictException('Оплатить эту бронь уже нельзя');
    const ref = await this.byToken(token);
    const pay = await this.payments.startBookingPayment({
      bookingId: ref.id,
      amountMinor: Math.max(0, info.prepaymentDueMinor - info.paidMinor),
      purpose: 'prepayment',
      idempotencyKey: `web:${ref.id}:${attemptKey}`,
      returnUrl: `${this.config.bookingSiteUrl}/b/${token}`,
    });
    return { confirmationUrl: pay.confirmationUrl };
  }

  /** Отмена гостем по условиям тарифа с автоматическим возвратом оплаты за вычетом удержания. */
  async cancel(token: string, ip: string | null) {
    const ref = await this.byToken(token);
    const result = await this.db.transaction().execute(async (trx) => {
      await setActor(trx, null, 'guest', 'Отмена гостем');
      const b = await trx
        .selectFrom('booking as b')
        .innerJoin('booking_stay as s', 's.booking_id', 'b.id')
        .leftJoin('rate_plan as rp', 'rp.id', 's.rate_plan_id')
        .select(['b.id', 'b.status', 'b.arrival', 'b.total_minor', 'b.property_id', 'b.booker_guest_id', 'rp.cancellation_policy', 'rp.deposit_policy', 'rp.is_refundable'])
        .where('b.id', '=', ref.id)
        .forUpdate(['b'])
        .executeTakeFirstOrThrow();
      const { today } = await this.availability.propertyToday(b.property_id, trx);
      if (!['pending_payment', 'confirmed', 'pending_confirmation'].includes(b.status) || today > b.arrival) {
        throw new ConflictException('Эту бронь уже нельзя отменить онлайн, позвоните нам');
      }
      const penalty = await this.penalty(b, today, trx);
      const paid = await this.payments.paidMinor(trx, b.id);
      const policy = b.deposit_policy as DepositPolicy | null;
      const deposit = b.status !== 'pending_payment' && b.is_refundable !== false && depositApplies(policy, b.arrival, today);
      const outcome = cancellationOutcome(penalty, paid, deposit);
      await trx.updateTable('booking').set({ status: 'cancelled', hold_expires_at: null }).where('id', '=', b.id).execute();
      if (outcome.depositMinor > 0) {
        await trx
          .insertInto('guest_deposit')
          .values({
            property_id: b.property_id,
            guest_id: b.booker_guest_id,
            source_booking_id: b.id,
            amount_minor: outcome.depositMinor,
            balance_minor: outcome.depositMinor,
            season: seasonOf(policy!.seasons, b.arrival)!.name,
          })
          .execute();
      }
      await this.audit.write(
        { propertyId: b.property_id, actorType: 'guest', actorId: null, action: 'booking.cancel_by_guest', entity: 'booking', entityId: b.id, after: { ...outcome, paidMinor: paid }, ip },
        trx,
      );
      return { bookingId: b.id, refundMinor: outcome.refundMinor };
    });

    await this.payments.cancelPending(result.bookingId);
    // Возврат по успешным платежам, начиная с последнего
    let left = result.refundMinor;
    const paidList = await this.payments.listForBooking(ref.property_id, result.bookingId);
    for (const p of paidList.filter((x) => x.status === 'succeeded').reverse()) {
      if (left <= 0) break;
      const amount = Math.min(left, p.amount_minor - Number(p.refunded_minor ?? 0));
      if (amount <= 0) continue;
      await this.payments.refund({ paymentId: p.id, amountMinor: amount, reason: 'Отмена гостем по условиям тарифа' });
      left -= amount;
    }
    return this.manage(token);
  }
}
