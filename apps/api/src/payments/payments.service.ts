import { BadGatewayException, ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { prepaymentReceipt, type Receipt } from '../../../../packages/domain/src';
import { setActor, type Database } from '../../../../packages/db/src';
import { AvailabilityService } from '../bookings/availability.service';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderStatus } from './provider';

type Purpose = 'prepayment' | 'balance';

/** Тело уведомления для журнала: JSON как есть, параметры формы или адреса (Сбер) — объектом */
function asJsonText(raw: string) {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return JSON.stringify(Object.fromEntries(new URLSearchParams(raw)));
  }
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
  ) {}

  /** Оплачено по брони: успешные платежи минус успешные возвраты. */
  async paidMinor(trx: Database, bookingId: string): Promise<number> {
    const r = await sql<{ paid: string | null }>`
      SELECT (coalesce(sum(p.amount_minor), 0) - coalesce(sum(r.refunded), 0))::bigint AS paid
        FROM payment p
        LEFT JOIN LATERAL (SELECT sum(amount_minor) AS refunded FROM refund
                            WHERE payment_id = p.id AND status = 'succeeded') r ON true
       WHERE p.status = 'succeeded' AND p.booking_id = ${bookingId}`.execute(trx);
    return Number(r.rows[0]?.paid ?? 0);
  }

  /** Пересчитывает признак оплаты брони по фактическим платежам и возвратам. */
  async recomputePaymentState(trx: Database, bookingId: string) {
    const b = await trx.selectFrom('booking').select(['total_minor']).where('id', '=', bookingId).executeTakeFirstOrThrow();
    const paid = await this.paidMinor(trx, bookingId);
    const pendingRefund = await trx
      .selectFrom('refund as r')
      .innerJoin('payment as p', 'p.id', 'r.payment_id')
      .select('r.id')
      .where('p.booking_id', '=', bookingId)
      .where('r.status', 'in', ['requested', 'approved', 'pending'])
      .executeTakeFirst();
    const anyRefunded = await trx
      .selectFrom('refund as r')
      .innerJoin('payment as p', 'p.id', 'r.payment_id')
      .select('r.id')
      .where('p.booking_id', '=', bookingId)
      .where('r.status', '=', 'succeeded')
      .executeTakeFirst();
    const state = pendingRefund
      ? 'refund_pending'
      : paid === 0
        ? anyRefunded ? 'refunded' : 'unpaid'
        : paid < b.total_minor ? 'partially_paid' : paid === b.total_minor ? 'paid' : 'overpaid';
    await trx.updateTable('booking').set({ payment_state: state }).where('id', '=', bookingId).execute();
    return { paid, state };
  }

  private async receiptFor(trx: Database, bookingId: string, amountMinor: number): Promise<Receipt> {
    const b = await trx
      .selectFrom('booking as b')
      .innerJoin('guest as g', 'g.id', 'b.booker_guest_id')
      .select(['b.number', 'b.total_minor', 'b.arrival', 'b.departure', 'g.email', 'g.phone_e164'])
      .where('b.id', '=', bookingId)
      .executeTakeFirstOrThrow();
    return prepaymentReceipt({
      title: `Проживание, бронь ${b.number}`,
      paymentMinor: amountMinor,
      bookingTotalMinor: b.total_minor,
      email: b.email,
      phone: b.phone_e164,
    });
  }

  /**
   * Создаёт платёж у эквайера и возвращает ссылку на страницу оплаты.
   * Повтор с тем же ключом возвращает тот же платёж.
   */
  async startBookingPayment(input: { bookingId: string; amountMinor: number; purpose: Purpose; idempotencyKey: string; returnUrl: string; userId?: string | null }) {
    if (input.amountMinor <= 0) throw new UnprocessableEntityException('Сумма оплаты должна быть больше нуля');
    const created = await this.db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('payment').selectAll().where('idempotency_key', '=', input.idempotencyKey).executeTakeFirst();
      if (existing) return { payment: existing, receipt: null, fresh: false };
      const b = await trx.selectFrom('booking').select(['id', 'property_id', 'status']).where('id', '=', input.bookingId).forUpdate().executeTakeFirst();
      if (!b) throw new NotFoundException('Бронь не найдена');
      if (!['pending_payment', 'confirmed', 'checked_in', 'pending_confirmation'].includes(b.status)) {
        throw new ConflictException('Бронь в этом статусе оплатить нельзя');
      }
      const receipt = await this.receiptFor(trx, b.id, input.amountMinor);
      const payment = await trx
        .insertInto('payment')
        .values({
          property_id: b.property_id,
          booking_id: b.id,
          purpose: input.purpose,
          method: 'online_card',
          provider: this.provider.code,
          amount_minor: input.amountMinor,
          idempotency_key: input.idempotencyKey,
          created_by: input.userId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { payment, receipt, fresh: true };
    });
    if (!created.fresh) {
      if (!created.payment.confirmation_url) throw new ConflictException('Платёж по этому ключу уже обработан');
      return { paymentId: created.payment.id, confirmationUrl: created.payment.confirmation_url, status: created.payment.status };
    }

    const p = created.payment;
    try {
      const r = await this.provider.createPayment({
        paymentId: p.id,
        amountMinor: p.amount_minor,
        description: created.receipt!.items[0].name,
        idempotencyKey: p.idempotency_key,
        returnUrl: input.returnUrl,
        receipt: created.receipt!,
      });
      await this.db
        .updateTable('payment')
        .set({ provider_payment_id: r.providerPaymentId, confirmation_url: r.confirmationUrl, status: 'pending' })
        .where('id', '=', p.id)
        .execute();
      return { paymentId: p.id, confirmationUrl: r.confirmationUrl, status: 'pending' as const };
    } catch (e) {
      this.log.error(`Эквайер не создал платёж ${p.id}: ${e instanceof Error ? e.message : e}`);
      await this.db.updateTable('payment').set({ status: 'failed' }).where('id', '=', p.id).where('status', '=', 'created').execute();
      throw new BadGatewayException('Платёжный сервис недоступен, попробуйте ещё раз');
    }
  }

  /** Уведомление эквайера. Повтор того же уведомления ничего не меняет. */
  async handleWebhook(headers: Record<string, string | undefined>, rawBody: Buffer | undefined) {
    if (!rawBody) throw new UnprocessableEntityException('Пустое уведомление');
    const ev = this.provider.parseWebhook(headers, rawBody);
    if (!ev) {
      this.log.warn('Уведомление с неверной подписью отклонено');
      throw new UnprocessableEntityException('Неверная подпись');
    }
    const payment = await this.db
      .selectFrom('payment')
      .select(['id'])
      .where('provider', '=', this.provider.code)
      .where('provider_payment_id', '=', ev.providerPaymentId)
      .executeTakeFirst();
    const inserted = await this.db
      .insertInto('payment_event')
      .values({
        provider: this.provider.code,
        provider_event_id: ev.eventId,
        payment_id: payment?.id ?? null,
        event_type: ev.type,
        payload: asJsonText(rawBody.toString('utf8')),
        signature_valid: true,
      })
      .onConflict((oc) => oc.columns(['provider', 'provider_event_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return { ok: true, duplicate: true };
    if (!payment) {
      this.log.warn(`Уведомление о неизвестном платеже ${ev.providerPaymentId}`);
      return { ok: true, unknown: true };
    }
    // Статус берём у эквайера, а не из тела уведомления
    const status = await this.provider.fetchStatus(ev.providerPaymentId);
    await this.applyStatus(payment.id, status, 'provider');
    await this.db.updateTable('payment_event').set({ processed_at: new Date() }).where('id', '=', inserted.id).execute();
    return { ok: true };
  }

  /** Сверяет платёж с эквайером (для страницы возврата гостя и фоновой проверки). */
  async syncPayment(paymentId: string) {
    const p = await this.db.selectFrom('payment').select(['id', 'status', 'provider_payment_id']).where('id', '=', paymentId).executeTakeFirst();
    if (!p || !p.provider_payment_id || p.status !== 'pending') return;
    const status = await this.provider.fetchStatus(p.provider_payment_id);
    if (status !== 'pending') await this.applyStatus(p.id, status, 'provider');
  }

  /**
   * Применяет статус эквайера к платежу и брони. Успешная оплата подтверждает бронь,
   * если внесена предоплата. Если удержание уже снято и номер заняли, деньги возвращаются.
   */
  async applyStatus(paymentId: string, status: ProviderStatus, source: string) {
    const refundAll = await this.db.transaction().execute(async (trx) => {
      await setActor(trx, null, source, 'Оплата');
      const p = await trx.selectFrom('payment').selectAll().where('id', '=', paymentId).forUpdate().executeTakeFirstOrThrow();
      if (p.status === status || ['succeeded', 'failed', 'cancelled'].includes(p.status)) return null;
      await trx
        .updateTable('payment')
        .set({ status, paid_at: status === 'succeeded' ? new Date() : null })
        .where('id', '=', p.id)
        .execute();
      if (status !== 'succeeded' || !p.booking_id) return null;

      await trx
        .insertInto('fiscal_receipt')
        .values({
          payment_id: p.id,
          receipt_type: 'prepayment',
          provider: p.provider ?? 'unknown',
          // Чек передаётся вместе с платежом; у тестового провайдера считается зарегистрированным сразу
          status: p.provider === 'sandbox' ? 'registered' : 'pending',
        })
        .execute();

      const b = await trx.selectFrom('booking').selectAll().where('id', '=', p.booking_id).forUpdate().executeTakeFirstOrThrow();
      const { paid } = await this.recomputePaymentState(trx, b.id);
      await this.audit.write(
        { propertyId: b.property_id, actorType: 'provider', actorId: null, action: 'payment.succeeded', entity: 'payment', entityId: p.id, after: { bookingId: b.id, amountMinor: p.amount_minor } },
        trx,
      );

      const enough = paid >= b.prepayment_due_minor;
      if (b.status === 'pending_payment' && enough) {
        await trx.updateTable('booking').set({ status: 'confirmed', hold_expires_at: null }).where('id', '=', b.id).execute();
        await this.queueConfirmation(trx, b.id, b.property_id, b.booker_guest_id);
      } else if (b.status === 'expired' && enough) {
        if (await this.reinstate(trx, b.id)) {
          await this.queueConfirmation(trx, b.id, b.property_id, b.booker_guest_id);
        } else {
          await this.audit.write(
            { propertyId: b.property_id, actorType: 'system', actorId: null, action: 'payment.late_no_room', entity: 'booking', entityId: b.id, after: { paymentId: p.id } },
            trx,
          );
          return p.id;
        }
      } else if (b.status === 'cancelled') {
        return p.id;
      }
      return null;
    });
    if (refundAll) {
      const p = await this.db.selectFrom('payment').select(['amount_minor']).where('id', '=', refundAll).executeTakeFirstOrThrow();
      await this.refund({ paymentId: refundAll, amountMinor: p.amount_minor, reason: 'Оплата пришла после снятия брони, номер занят' });
    }
  }

  /** Депозиты гостя (сезонный депозит по оферте), которые ещё можно зачесть в оплату брони */
  availableDeposits(propertyId: string, guestId: string) {
    return this.db
      .selectFrom('guest_deposit as d')
      .innerJoin('booking as b', 'b.id', 'd.source_booking_id')
      .select(['d.id', 'd.amount_minor', 'd.balance_minor', 'd.season', 'd.created_at', 'b.number as source_number'])
      .where('d.property_id', '=', propertyId)
      .where('d.guest_id', '=', guestId)
      .where('d.balance_minor', '>', 0)
      .orderBy('d.created_at')
      .execute();
  }

  /**
   * Зачёт депозита гостя в оплату брони: платёж «с депозита» без эквайера, баланс депозита уменьшается.
   * Как и онлайн-оплата, достаточная сумма подтверждает бронь, ожидающую оплаты.
   */
  async applyDeposit(input: { propertyId: string; bookingId: string; depositId: string; amountMinor: number; userId: string }) {
    return this.db.transaction().execute(async (trx) => {
      await setActor(trx, input.userId, 'app', 'Зачёт депозита');
      const b = await trx.selectFrom('booking').selectAll().where('id', '=', input.bookingId).where('property_id', '=', input.propertyId).forUpdate().executeTakeFirst();
      if (!b) throw new NotFoundException('Бронь не найдена');
      if (!['pending_payment', 'confirmed', 'checked_in', 'pending_confirmation'].includes(b.status)) throw new ConflictException('Бронь в этом статусе оплатить нельзя');
      const d = await trx.selectFrom('guest_deposit').selectAll().where('id', '=', input.depositId).where('property_id', '=', input.propertyId).forUpdate().executeTakeFirst();
      if (!d) throw new NotFoundException('Депозит не найден');
      if (d.guest_id !== b.booker_guest_id) throw new ConflictException('Депозит принадлежит другому гостю');
      if (input.amountMinor > Number(d.balance_minor)) throw new UnprocessableEntityException('Сумма больше остатка депозита');
      const due = b.total_minor - (await this.paidMinor(trx, b.id));
      if (input.amountMinor > due) throw new UnprocessableEntityException('Сумма больше остатка к оплате по брони');

      const payment = await trx
        .insertInto('payment')
        .values({
          property_id: b.property_id,
          booking_id: b.id,
          purpose: due === b.total_minor && input.amountMinor < b.total_minor ? 'prepayment' : 'balance',
          method: 'guest_deposit',
          provider: null,
          status: 'succeeded',
          amount_minor: input.amountMinor,
          idempotency_key: `deposit:${randomUUID()}`,
          paid_at: new Date(),
          created_by: input.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.updateTable('guest_deposit').set({ balance_minor: Number(d.balance_minor) - input.amountMinor }).where('id', '=', d.id).execute();
      await trx.insertInto('guest_deposit_use').values({ deposit_id: d.id, payment_id: payment.id, amount_minor: input.amountMinor, created_by: input.userId }).execute();
      const { paid } = await this.recomputePaymentState(trx, b.id);
      await this.audit.write(
        { propertyId: b.property_id, actorType: 'user', actorId: input.userId, action: 'payment.deposit_offset', entity: 'payment', entityId: payment.id, after: { bookingId: b.id, depositId: d.id, amountMinor: input.amountMinor } },
        trx,
      );
      if (b.status === 'pending_payment' && paid >= b.prepayment_due_minor) {
        await trx.updateTable('booking').set({ status: 'confirmed', hold_expires_at: null }).where('id', '=', b.id).execute();
        await this.queueConfirmation(trx, b.id, b.property_id, b.booker_guest_id);
      }
      return payment;
    });
  }

  /** Поздняя оплата: возвращает истёкшую бронь, если её номер или другой номер категории свободен. */
  private async reinstate(trx: Database, bookingId: string) {
    const stay = await trx.selectFrom('booking_stay').selectAll().where('booking_id', '=', bookingId).forUpdate().executeTakeFirstOrThrow();
    await trx.selectFrom('accommodation_type').select('id').where('id', '=', stay.accommodation_type_id).forUpdate().execute();
    const b = await trx.selectFrom('booking').select(['arrival', 'departure']).where('id', '=', bookingId).executeTakeFirstOrThrow();
    const free = await this.availability.freeUnits(stay.accommodation_type_id, b.arrival, b.departure, trx);
    if (!free.length) return false;
    const unitId = free.some((u) => u.id === stay.unit_id) ? stay.unit_id : free[0].id;
    await trx.updateTable('booking_stay').set({ unit_id: unitId }).where('id', '=', stay.id).execute();
    await trx.updateTable('booking').set({ status: 'confirmed', hold_expires_at: null }).where('id', '=', bookingId).execute();
    return true;
  }

  /** Письмо-подтверждение ставится в очередь; отправка подключается вместе с почтовым сервисом. */
  private async queueConfirmation(trx: Database, bookingId: string, propertyId: string, guestId: string) {
    await trx
      .insertInto('notification')
      .values({
        property_id: propertyId,
        guest_id: guestId,
        booking_id: bookingId,
        channel: 'email',
        template_code: 'booking_confirmed',
        scheduled_at: new Date(),
        dedupe_key: `booking_confirmed:${bookingId}`,
      })
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .execute();
  }

  /** Возврат по платежу. Сумма возвратов не может превысить платёж: это проверяет база. */
  async refund(input: { paymentId: string; amountMinor: number; reason: string; userId?: string | null; propertyId?: string }) {
    const prep = await this.db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('payment').selectAll().where('id', '=', input.paymentId).forUpdate().executeTakeFirst();
      if (!p || (input.propertyId && p.property_id !== input.propertyId)) throw new NotFoundException('Платёж не найден');
      if (!p.provider_payment_id) throw new ConflictException('Платёж прошёл не через эквайера, верните деньги вручную');
      const refund = await trx
        .insertInto('refund')
        .values({
          payment_id: p.id,
          amount_minor: input.amountMinor,
          reason: input.reason,
          status: 'pending',
          idempotency_key: randomUUID(),
          requested_by: input.userId ?? null,
          approved_by: input.userId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (p.booking_id) await this.recomputePaymentState(trx, p.booking_id);
      const receipt = p.booking_id ? await this.receiptFor(trx, p.booking_id, input.amountMinor) : null;
      return { p, refund, receipt };
    });

    let result: { providerRefundId: string; status: 'pending' | 'succeeded' | 'failed' };
    try {
      result = await this.provider.refund({
        providerPaymentId: prep.p.provider_payment_id!,
        amountMinor: input.amountMinor,
        idempotencyKey: prep.refund.idempotency_key,
        receipt: prep.receipt!,
      });
    } catch (e) {
      this.log.error(`Эквайер не принял возврат ${prep.refund.id}: ${e instanceof Error ? e.message : e}`);
      result = { providerRefundId: '', status: 'failed' };
    }

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('refund')
        .set({
          status: result.status,
          provider_refund_id: result.providerRefundId || null,
          completed_at: result.status === 'pending' ? null : new Date(),
        })
        .where('id', '=', prep.refund.id)
        .execute();
      if (result.status === 'succeeded') {
        await trx
          .insertInto('fiscal_receipt')
          .values({ refund_id: prep.refund.id, receipt_type: 'refund', provider: prep.p.provider ?? 'unknown', status: prep.p.provider === 'sandbox' ? 'registered' : 'pending' })
          .execute();
      }
      if (prep.p.booking_id) await this.recomputePaymentState(trx, prep.p.booking_id);
      await this.audit.write(
        {
          propertyId: prep.p.property_id,
          actorType: input.userId ? 'user' : 'system',
          actorId: input.userId ?? null,
          action: `refund.${result.status}`,
          entity: 'refund',
          entityId: prep.refund.id,
          after: { paymentId: prep.p.id, amountMinor: input.amountMinor, reason: input.reason },
        },
        trx,
      );
    });
    return { refundId: prep.refund.id, status: result.status };
  }

  /** Отмена неоплаченных платежей брони у эквайера (при снятии удержания). */
  async cancelPending(bookingId: string) {
    const pending = await this.db
      .selectFrom('payment')
      .select(['id', 'provider_payment_id'])
      .where('booking_id', '=', bookingId)
      .where('status', 'in', ['created', 'pending'])
      .execute();
    for (const p of pending) {
      if (p.provider_payment_id) {
        const st = await this.provider.fetchStatus(p.provider_payment_id);
        if (st !== 'pending') {
          await this.applyStatus(p.id, st, 'provider');
          continue;
        }
        await this.provider.cancel(p.provider_payment_id);
      }
      await this.db.updateTable('payment').set({ status: 'cancelled' }).where('id', '=', p.id).where('status', 'in', ['created', 'pending']).execute();
    }
  }

  listForBooking(propertyId: string, bookingId: string) {
    return this.db
      .selectFrom('payment as p')
      .select((eb) => [
        'p.id', 'p.purpose', 'p.method', 'p.provider', 'p.status', 'p.amount_minor', 'p.paid_at', 'p.created_at',
        eb
          .selectFrom('refund as r')
          .select(sql<number>`coalesce(sum(r.amount_minor), 0)::bigint`.as('x'))
          .whereRef('r.payment_id', '=', 'p.id')
          .where('r.status', '=', 'succeeded')
          .as('refunded_minor'),
      ])
      .where('p.property_id', '=', propertyId)
      .where('p.booking_id', '=', bookingId)
      .orderBy('p.created_at')
      .execute();
  }
}
