import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { diffDays, nightsBetween, toDateRange } from '../../../../packages/domain/src';
import { setActor, type Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import { GuestsService } from '../guests/guests.service';
import type { StaffUser } from '../iam/auth.decorators';
import { AvailabilityService } from './availability.service';
import { ChangeDatesBody, CreateBookingBody, ListQuery, MoveBody, StatusBody } from './bookings.schemas';

type Actor = { user: StaffUser | null; propertyId: string; ip: string | null; source?: string };
const ACTIVE = ['draft', 'pending_payment', 'pending_confirmation', 'confirmed', 'checked_in'] as const;

@Injectable()
export class BookingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly availability: AvailabilityService,
    private readonly guests: GuestsService,
    private readonly audit: AuditService,
  ) {}

  private log(a: Actor, action: string, bookingId: string, trx: Database, before?: unknown, after?: unknown) {
    return this.audit.write(
      {
        propertyId: a.propertyId,
        actorType: a.user ? 'user' : 'guest',
        actorId: a.user?.id ?? null,
        action,
        entity: 'booking',
        entityId: bookingId,
        before,
        after,
        ip: a.ip,
      },
      trx,
    );
  }

  /** Блокирует бронь до конца транзакции. Чужая бронь выглядит как отсутствующая. */
  private async lockBooking(trx: Database, propertyId: string, id: string) {
    const b = await trx
      .selectFrom('booking')
      .selectAll()
      .where('id', '=', id)
      .where('property_id', '=', propertyId)
      .forUpdate()
      .executeTakeFirst();
    if (!b) throw new NotFoundException('Бронь не найдена');
    const stay = await trx.selectFrom('booking_stay').selectAll().where('booking_id', '=', id).forUpdate().executeTakeFirstOrThrow();
    return { b, stay };
  }

  async create(a: Actor, input: z.infer<typeof CreateBookingBody>) {
    return this.db.transaction().execute(async (trx) => {
      await setActor(trx, a.user?.id ?? null, a.source ?? 'app', input.overrideReason);

      if (input.idempotencyKey) {
        const existing = await trx
          .selectFrom('booking')
          .select('id')
          .where('idempotency_key', '=', input.idempotencyKey)
          .where('property_id', '=', a.propertyId)
          .executeTakeFirst();
        if (existing) return { id: existing.id, duplicate: true };
      }

      // Брони одной категории оформляются по очереди: так выбор свободного номера всегда точен.
      // Ограничение исключения в базе остаётся последней защитой от пересечений.
      await trx
        .selectFrom('accommodation_type')
        .select('id')
        .where('id', '=', input.accommodationTypeId)
        .where('property_id', '=', a.propertyId)
        .forUpdate()
        .executeTakeFirst();

      const children = input.childrenAges.length;
      const q = await this.availability.quote(
        a.propertyId,
        { accommodationTypeId: input.accommodationTypeId, ratePlanId: input.ratePlanId, arrival: input.arrival, departure: input.departure, adults: input.adults, children },
        trx,
      );
      const hardBlockers = q.restrictions.filter((r) => r.code === 'no_price' || r.code === 'too_many_guests');
      if (hardBlockers.length || (!q.bookable && !input.overrideRestrictions)) {
        throw new UnprocessableEntityException({ message: 'Бронь на этих условиях невозможна', restrictions: q.restrictions });
      }

      let unitId: string;
      if (input.unitId) {
        const unit = await trx
          .selectFrom('accommodation_unit')
          .select(['id', 'is_active'])
          .where('id', '=', input.unitId)
          .where('accommodation_type_id', '=', input.accommodationTypeId)
          .executeTakeFirst();
        if (!unit || !unit.is_active) throw new UnprocessableEntityException('Номер не относится к выбранной категории');
        if (await this.availability.isUnitBlocked(unit.id, input.arrival, input.departure, trx))
          throw new ConflictException('Номер закрыт на эти даты');
        unitId = unit.id;
      } else {
        const free = await this.availability.freeUnits(input.accommodationTypeId, input.arrival, input.departure, trx);
        if (!free.length) throw new ConflictException({ message: 'Нет свободных номеров этой категории на эти даты', code: 'sold_out' });
        unitId = free[0].id;
      }

      const guestId = input.guestId
        ? (await this.assertGuest(trx, a.propertyId, input.guestId)).id
        : (await this.guests.create(a.propertyId, input.guest!, trx)).id;

      const channel = await trx
        .selectFrom('channel')
        .select('id')
        .where('property_id', '=', a.propertyId)
        .where('code', '=', input.channelCode)
        .executeTakeFirst();
      if (!channel) throw new UnprocessableEntityException(`Неизвестный источник брони: ${input.channelCode}`);

      const { holdMinutes } = await this.availability.propertyToday(a.propertyId, trx);
      const seq = await sql<{ n: number }>`SELECT nextval('booking_number_seq')::int AS n`.execute(trx);
      const number = `QV-${input.arrival.slice(0, 4)}-${String(seq.rows[0].n).padStart(6, '0')}`;

      const booking = await trx
        .insertInto('booking')
        .values({
          property_id: a.propertyId,
          number,
          status: input.status,
          channel_id: channel.id,
          booker_guest_id: guestId,
          arrival: input.arrival,
          departure: input.departure,
          adults: input.adults,
          children_ages: input.childrenAges,
          special_requests: input.specialRequests ?? null,
          total_minor: q.totalMinor,
          prepayment_due_minor: q.prepaymentDueMinor,
          hold_expires_at: input.status === 'pending_payment' ? new Date(Date.now() + holdMinutes * 60_000) : null,
          idempotency_key: input.idempotencyKey ?? null,
          created_by: a.user?.id ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const stay = await trx
        .insertInto('booking_stay')
        .values({
          booking_id: booking.id,
          accommodation_type_id: input.accommodationTypeId,
          unit_id: unitId,
          rate_plan_id: input.ratePlanId,
          stay: toDateRange(input.arrival, input.departure),
          adults: input.adults,
          children,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('booking_night_price')
        .values(q.nights.map((n) => ({ booking_stay_id: stay.id, night: n.night, amount_minor: n.amountMinor })))
        .execute();
      const type = await trx.selectFrom('accommodation_type').select('name').where('id', '=', input.accommodationTypeId).executeTakeFirstOrThrow();
      await trx
        .insertInto('booking_item')
        .values({
          booking_id: booking.id,
          kind: 'accommodation',
          ref_id: stay.id,
          title: `${type.name}, ${q.nights.length} ноч.`,
          quantity: q.nights.length,
          amount_minor: q.totalMinor,
        })
        .execute();
      await trx.insertInto('booking_guest').values({ booking_id: booking.id, guest_id: guestId, stay_id: stay.id, is_primary: true }).execute();
      await trx.insertInto('folio').values({ booking_id: booking.id, payer_guest_id: guestId }).execute();

      await this.log(a, 'booking.create', booking.id, trx, undefined, {
        number,
        unitId,
        arrival: input.arrival,
        departure: input.departure,
        totalMinor: q.totalMinor,
        overrideRestrictions: input.overrideRestrictions ? q.restrictions : undefined,
      });
      return { id: booking.id, number, duplicate: false };
    });
  }

  private async assertGuest(trx: Database, propertyId: string, id: string) {
    const g = await trx.selectFrom('guest').select('id').where('id', '=', id).where('property_id', '=', propertyId).executeTakeFirst();
    if (!g) throw new NotFoundException('Гость не найден');
    return g;
  }

  /** Перенос в другой номер. Цены ночей сохраняются: гость платит то, что ему подтвердили. */
  async move(a: Actor, id: string, input: z.infer<typeof MoveBody>) {
    return this.db.transaction().execute(async (trx) => {
      await setActor(trx, a.user?.id ?? null, a.source ?? 'app', input.reason);
      const { b, stay } = await this.lockBooking(trx, a.propertyId, id);
      if (!(ACTIVE as readonly string[]).includes(b.status)) throw new ConflictException('Бронь неактивна, перенос невозможен');
      const unit = await trx
        .selectFrom('accommodation_unit as u')
        .innerJoin('accommodation_type as t', 't.id', 'u.accommodation_type_id')
        .select(['u.id', 'u.accommodation_type_id', 'u.is_active'])
        .where('u.id', '=', input.unitId)
        .where('t.property_id', '=', a.propertyId)
        .executeTakeFirst();
      if (!unit || !unit.is_active) throw new NotFoundException('Номер не найден');
      if (await this.availability.isUnitBlocked(unit.id, b.arrival, b.departure, trx)) throw new ConflictException('Номер закрыт на эти даты');
      await trx
        .updateTable('booking_stay')
        .set({ unit_id: unit.id, accommodation_type_id: unit.accommodation_type_id })
        .where('id', '=', stay.id)
        .execute(); // пересечение отклонит ограничение исключения → 409
      await trx.updateTable('booking').set({ updated_at: new Date() }).where('id', '=', id).execute();
      await this.log(a, 'booking.move', id, trx, { unitId: stay.unit_id }, { unitId: unit.id, reason: input.reason });
      return this.get(a.user, id, trx);
    });
  }

  /**
   * Изменение дат, продление и сокращение. Ночи, которые остаются, сохраняют подтверждённую цену,
   * новые ночи считаются по текущему тарифу. После заезда дату заезда менять нельзя.
   */
  async changeDates(a: Actor, id: string, input: z.infer<typeof ChangeDatesBody>) {
    return this.db.transaction().execute(async (trx) => {
      await setActor(trx, a.user?.id ?? null, a.source ?? 'app', input.reason);
      const { b, stay } = await this.lockBooking(trx, a.propertyId, id);
      if (!(ACTIVE as readonly string[]).includes(b.status)) throw new ConflictException('Бронь неактивна');
      if (b.status === 'checked_in' && input.arrival !== b.arrival) throw new ConflictException('Гость уже заселён: можно менять только дату выезда');
      if (!stay.rate_plan_id || !stay.unit_id) throw new ConflictException('У брони нет тарифа или номера');
      if (await this.availability.isUnitBlocked(stay.unit_id, input.arrival, input.departure, trx)) {
        throw new ConflictException('Номер закрыт на часть новых дат');
      }

      const kept = await trx.selectFrom('booking_night_price').selectAll().where('booking_stay_id', '=', stay.id).execute();
      const keptByNight = new Map(kept.map((k) => [k.night, k.amount_minor]));
      const newNights = nightsBetween(input.arrival, input.departure);
      const toPrice = newNights.filter((n) => !keptByNight.has(n));

      let priced = new Map<string, number>();
      if (toPrice.length) {
        const q = await this.availability.quote(
          a.propertyId,
          { accommodationTypeId: stay.accommodation_type_id, ratePlanId: stay.rate_plan_id, arrival: input.arrival, departure: input.departure, adults: stay.adults, children: stay.children },
          trx,
        );
        priced = new Map(q.nights.map((n) => [n.night, n.amountMinor]));
        const missing = toPrice.filter((n) => !priced.has(n));
        if (missing.length) throw new UnprocessableEntityException({ message: 'Нет цены на новые ночи', nights: missing });
      }

      await trx
        .updateTable('booking_stay')
        .set({ stay: toDateRange(input.arrival, input.departure) })
        .where('id', '=', stay.id)
        .execute(); // пересечение отклонит ограничение исключения → 409
      await trx
        .deleteFrom('booking_night_price')
        .where('booking_stay_id', '=', stay.id)
        .where((eb) => eb.or([eb('night', '<', input.arrival), eb('night', '>=', input.departure)]))
        .execute();
      if (toPrice.length) {
        await trx
          .insertInto('booking_night_price')
          .values(toPrice.map((n) => ({ booking_stay_id: stay.id, night: n, amount_minor: priced.get(n)! })))
          .execute();
      }
      const accommodation = newNights.reduce((s, n) => s + (keptByNight.get(n) ?? priced.get(n)!), 0);
      const nightsCount = diffDays(input.arrival, input.departure);
      const type = await trx.selectFrom('accommodation_type').select('name').where('id', '=', stay.accommodation_type_id).executeTakeFirstOrThrow();
      await trx
        .updateTable('booking_item')
        .set({ amount_minor: accommodation, quantity: nightsCount, title: `${type.name}, ${nightsCount} ноч.` })
        .where('booking_id', '=', id)
        .where('ref_id', '=', stay.id)
        .where('kind', '=', 'accommodation')
        .execute();
      const total = await trx
        .selectFrom('booking_item')
        .select(sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('t'))
        .where('booking_id', '=', id)
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('booking')
        .set({ arrival: input.arrival, departure: input.departure, total_minor: Math.max(0, total.t), updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await this.log(a, 'booking.change_dates', id, trx,
        { arrival: b.arrival, departure: b.departure, totalMinor: b.total_minor },
        { arrival: input.arrival, departure: input.departure, totalMinor: total.t, reason: input.reason });
      return this.get(a.user, id, trx);
    });
  }

  /** Смена статуса. Допустимость перехода проверяет база (таблица booking_status_transition). */
  async changeStatus(a: Actor, id: string, input: z.infer<typeof StatusBody>) {
    return this.db.transaction().execute(async (trx) => {
      await setActor(trx, a.user?.id ?? null, a.source ?? 'app', input.reason);
      const { b, stay } = await this.lockBooking(trx, a.propertyId, id);
      if (input.status === 'checked_in') {
        const { today } = await this.availability.propertyToday(a.propertyId, trx);
        if (today < b.arrival) throw new ConflictException('Заселение раньше даты заезда: сначала измените даты брони');
      }
      await trx
        .updateTable('booking')
        .set({ status: input.status, hold_expires_at: null })
        .where('id', '=', id)
        .execute();
      if (input.status === 'checked_in') {
        await trx.updateTable('booking_stay').set({ actual_check_in: new Date() }).where('id', '=', stay.id).execute();
      }
      if (input.status === 'checked_out') {
        await trx.updateTable('booking_stay').set({ actual_check_out: new Date() }).where('id', '=', stay.id).execute();
      }
      await this.log(a, 'booking.status', id, trx, { status: b.status }, { status: input.status, reason: input.reason });
      return this.get(a.user, id, trx);
    });
  }

  async get(user: StaffUser | null, id: string, trx: Database = this.db) {
    const b = await trx
      .selectFrom('booking as b')
      .innerJoin('channel as c', 'c.id', 'b.channel_id')
      .innerJoin('guest as g', 'g.id', 'b.booker_guest_id')
      .selectAll('b')
      .select(['c.code as channel_code', 'g.last_name', 'g.first_name', 'g.phone_e164', 'g.email'])
      .where('b.id', '=', id)
      .where('b.property_id', '=', user?.propertyId ?? '')
      .executeTakeFirst();
    if (!b) throw new NotFoundException('Бронь не найдена');
    const stays = await trx
      .selectFrom('booking_stay as s')
      .leftJoin('accommodation_unit as u', 'u.id', 's.unit_id')
      .innerJoin('accommodation_type as t', 't.id', 's.accommodation_type_id')
      .selectAll('s')
      .select(['u.name as unit_name', 't.name as type_name'])
      .where('s.booking_id', '=', id)
      .execute();
    const nights = await trx
      .selectFrom('booking_night_price')
      .selectAll()
      .where('booking_stay_id', 'in', stays.map((s) => s.id))
      .orderBy('night')
      .execute();
    const items = await trx.selectFrom('booking_item').selectAll().where('booking_id', '=', id).orderBy('created_at').execute();
    const history = await trx.selectFrom('booking_status_history').selectAll().where('booking_id', '=', id).orderBy('id').execute();
    const paid = await this.paidMinor(trx, [id]);
    const transitions = await trx
      .selectFrom('booking_status_transition')
      .select('to_status')
      .where('from_status', '=', b.status)
      .execute();
    const canSeeContacts = !!user?.permissions.has('guest.contacts.read');
    const { manage_token_hash: _hidden, ...rest } = b;
    return {
      ...rest,
      phone_e164: canSeeContacts ? b.phone_e164 : null,
      email: canSeeContacts ? b.email : null,
      stays,
      nights,
      items,
      history,
      allowed_transitions: transitions.map((t) => t.to_status),
      paid_minor: paid.get(id) ?? 0,
      balance_minor: b.total_minor - (paid.get(id) ?? 0),
    };
  }

  /** Оплачено по брони: успешные платежи минус успешные возвраты. */
  private async paidMinor(trx: Database, ids: string[]) {
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const rows = await sql<{ booking_id: string; paid: number }>`
      SELECT p.booking_id,
             (sum(p.amount_minor) - coalesce(sum(r.refunded), 0))::bigint AS paid
        FROM payment p
        LEFT JOIN LATERAL (SELECT sum(amount_minor) AS refunded FROM refund
                            WHERE payment_id = p.id AND status = 'succeeded') r ON true
       WHERE p.status = 'succeeded' AND p.booking_id = ANY(${ids}::uuid[])
       GROUP BY p.booking_id`.execute(trx);
    for (const r of rows.rows) map.set(r.booking_id, Number(r.paid));
    return map;
  }

  async list(user: StaffUser, q: z.infer<typeof ListQuery>) {
    let query = this.db
      .selectFrom('booking as b')
      .innerJoin('guest as g', 'g.id', 'b.booker_guest_id')
      .innerJoin('channel as c', 'c.id', 'b.channel_id')
      .select(['b.id', 'b.number', 'b.status', 'b.payment_state', 'b.arrival', 'b.departure', 'b.total_minor', 'b.created_at', 'g.last_name', 'g.first_name', 'c.code as channel_code'])
      .where('b.property_id', '=', user.propertyId);
    if (q.q) {
      const like = `%${q.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
      query = query.where((eb) => eb.or([eb(sql`lower(b.number)`, 'like', like), eb(sql`lower(g.last_name)`, 'like', like)]));
    }
    if (q.arrivalFrom) query = query.where('b.arrival', '>=', q.arrivalFrom);
    if (q.arrivalTo) query = query.where('b.arrival', '<', q.arrivalTo);
    if (q.status) query = query.where('b.status', '=', q.status as never);
    return query.orderBy('b.arrival', 'desc').limit(200).execute();
  }

  /** Шахматка: номера по строкам и брони, пересекающие период. */
  async calendar(user: StaffUser, from: string, to: string) {
    if (diffDays(from, to) > 120) throw new UnprocessableEntityException('Период шахматки не больше 120 дней');
    const units = await this.db
      .selectFrom('accommodation_unit as u')
      .innerJoin('accommodation_type as t', 't.id', 'u.accommodation_type_id')
      .select(['u.id', 'u.name', 'u.is_active', 't.id as type_id', 't.name as type_name'])
      .where('t.property_id', '=', user.propertyId)
      .orderBy('t.sort_order')
      .orderBy('u.name')
      .execute();
    const stays = await this.db
      .selectFrom('booking_stay as s')
      .innerJoin('booking as b', 'b.id', 's.booking_id')
      .innerJoin('guest as g', 'g.id', 'b.booker_guest_id')
      .innerJoin('channel as c', 'c.id', 'b.channel_id')
      .select(['s.id as stay_id', 's.unit_id', 's.stay', 'b.id as booking_id', 'b.number', 'b.status', 'b.payment_state', 'b.total_minor', 'b.adults', 'b.children_ages', 'c.code as channel_code', 'g.last_name', 'g.first_name'])
      .where('b.property_id', '=', user.propertyId)
      .where('s.is_active', '=', true)
      .where(sql<boolean>`s.stay && daterange(${from}, ${to})`)
      .execute();
    const blocks = await this.db
      .selectFrom('availability_block as bl')
      .leftJoin('accommodation_unit as u', 'u.id', 'bl.unit_id')
      .leftJoin('accommodation_type as t', (j) => j.on((eb) => eb.or([eb('t.id', '=', eb.ref('bl.accommodation_type_id')), eb('t.id', '=', eb.ref('u.accommodation_type_id'))])))
      .select(['bl.id', 'bl.unit_id', 'bl.accommodation_type_id', 'bl.period', 'bl.reason'])
      .where('t.property_id', '=', user.propertyId)
      .where(sql<boolean>`bl.period && daterange(${from}, ${to})`)
      .execute();
    const paid = await this.paidMinor(this.db, [...new Set(stays.map((s) => s.booking_id))]);
    return {
      from,
      to,
      units,
      blocks,
      stays: stays.map((s) => ({ ...s, paid_minor: paid.get(s.booking_id) ?? 0, balance_minor: s.total_minor - (paid.get(s.booking_id) ?? 0) })),
    };
  }
}
