import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import type { StaffUser } from '../iam/auth.decorators';
import type { GuestPrincipal } from './guest.guard';
import { guestProfileId, shortNumber } from './guest-profile';
import { GuestStayService } from './stay.service';

export const TABLE_STATUSES = ['requested', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'] as const;
type TableStatus = (typeof TABLE_STATUSES)[number];
const TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  requested: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};
const ACTIVE: TableStatus[] = ['requested', 'confirmed', 'seated'];
/** Для приложения: «requested» показывается как «ждёт подтверждения» */
const guestStatus = (s: string) => (s === 'requested' ? 'pending_confirmation' : s);

export interface RestaurantInput {
  name: string;
  description?: string | null;
  phone?: string | null;
  seatingMinutes?: number;
  turnoverMinutes?: number;
  autoConfirmReservations?: boolean;
  acceptsDelivery?: boolean;
  isActive?: boolean;
  hours?: { weekday: number; opensAt: string; closesAt: string; lastSeating?: string | null }[];
}

/**
 * Ресторан и брони столиков. Свободный столик подбирается под блокировкой ресторана;
 * последняя защита от двойной брони — ограничение исключения на table_assignment.
 */
@Injectable()
export class RestaurantService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly stay: GuestStayService,
    private readonly audit: AuditService,
  ) {}

  async list(propertyId: string) {
    const rows = await this.db
      .selectFrom('restaurant')
      .select(['id', 'name', 'description', 'phone', 'photos', 'seating_minutes', 'accepts_delivery'])
      .where('property_id', '=', propertyId)
      .where('is_active', '=', true)
      .orderBy('name')
      .execute();
    const hours = rows.length
      ? await this.db.selectFrom('restaurant_hours').selectAll().where('restaurant_id', 'in', rows.map((r) => r.id)).orderBy('weekday').execute()
      : [];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      phone: r.phone,
      photos: r.photos as string[],
      seatingMinutes: r.seating_minutes,
      acceptsDelivery: r.accepts_delivery,
      hours: hours
        .filter((h) => h.restaurant_id === r.id)
        .map((h) => ({ weekday: h.weekday, opensAt: h.opens_at.slice(0, 5), closesAt: h.closes_at.slice(0, 5) })),
    }));
  }

  async restaurant(propertyId: string, id: string, trx: Database = this.db, lock = false) {
    if (lock) await trx.selectFrom('restaurant').select('id').where('id', '=', id).forUpdate().execute();
    const r = await trx
      .selectFrom('restaurant as r')
      .innerJoin('property as p', 'p.id', 'r.property_id')
      .selectAll('r')
      .select('p.timezone')
      .where('r.id', '=', id)
      .where('r.property_id', '=', propertyId)
      .where('r.is_active', '=', true)
      .executeTakeFirst();
    if (!r) throw new NotFoundException({ message: 'Ресторан не найден', code: 'not_found' });
    return r;
  }

  /** Свободные столики подходящей вместимости на [from, to), меньшие сначала */
  private freeTables(trx: Database, restaurantId: string, from: Date | ReturnType<typeof sql>, to: Date | ReturnType<typeof sql>, party: number) {
    return sql<{ id: string; zone: string | null }>`
      SELECT t.id, t.zone FROM restaurant_table t
       WHERE t.restaurant_id = ${restaurantId} AND t.is_active AND t.seats >= ${party}
         AND NOT EXISTS (SELECT 1 FROM table_assignment a
                          WHERE a.table_id = t.id AND a.is_active AND a.period && tstzrange(${from}, ${to}, '[)'))
       ORDER BY t.seats, t.name`.execute(trx);
  }

  /** Слоты по 30 минут в часы работы; время последней посадки — за длительность посадки до закрытия */
  async availability(propertyId: string, restaurantId: string, date: string, party: number) {
    const r = await this.restaurant(propertyId, restaurantId);
    const rows = await sql<{ startsAt: Date; available: boolean }>`
      WITH h AS (SELECT * FROM restaurant_hours WHERE restaurant_id = ${r.id} AND weekday = extract(isodow FROM ${date}::date)),
           sl AS (SELECT gs AS starts_at, gs + make_interval(mins => ${r.seating_minutes + r.turnover_minutes}) AS busy_until
                    FROM h, generate_series((${date}::date + h.opens_at) AT TIME ZONE ${r.timezone},
                                            (${date}::date + coalesce(h.last_seating, h.closes_at - make_interval(mins => ${r.seating_minutes}))) AT TIME ZONE ${r.timezone},
                                            interval '30 minutes') gs)
      SELECT sl.starts_at AS "startsAt",
             EXISTS (SELECT 1 FROM restaurant_table t
                      WHERE t.restaurant_id = ${r.id} AND t.is_active AND t.seats >= ${party}
                        AND NOT EXISTS (SELECT 1 FROM table_assignment a
                                         WHERE a.table_id = t.id AND a.is_active AND a.period && tstzrange(sl.starts_at, sl.busy_until, '[)'))) AS available
        FROM sl WHERE sl.starts_at > now() ORDER BY sl.starts_at`.execute(this.db);
    return rows.rows;
  }

  private async bookableTime(trx: Database, r: { id: string; timezone: string; seating_minutes: number }, startsAt: Date) {
    const ok = await sql<{ ok: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM restaurant_hours h
         WHERE h.restaurant_id = ${r.id}
           AND h.weekday = extract(isodow FROM (${startsAt}::timestamptz AT TIME ZONE ${r.timezone}))
           AND (${startsAt}::timestamptz AT TIME ZONE ${r.timezone})::time >= h.opens_at
           AND (${startsAt}::timestamptz AT TIME ZONE ${r.timezone})::time <= coalesce(h.last_seating, h.closes_at - make_interval(mins => ${r.seating_minutes}))
      ) AS ok`.execute(trx);
    return ok.rows[0].ok;
  }

  async reserve(
    g: GuestPrincipal,
    input: { restaurantId: string; startsAt: Date; partySize: number; bookingId?: string; wishes?: string; allergies?: string; comment?: string },
    key: string,
  ) {
    const existing = await this.db.selectFrom('table_reservation').select('id').where('idempotency_key', '=', key).executeTakeFirst();
    if (existing) return this.getForGuest(g, existing.id);
    if (input.bookingId) await this.stay.getOwn(g, input.bookingId);
    const id = await this.db.transaction().execute(async (trx) => {
      // Брони одного ресторана оформляются по очереди
      const r = await this.restaurant(g.propertyId, input.restaurantId, trx, true);
      const startsAt = input.startsAt;
      const endsAt = new Date(startsAt.getTime() + r.seating_minutes * 60_000);
      const busyUntil = new Date(endsAt.getTime() + r.turnover_minutes * 60_000);
      if (startsAt <= new Date()) throw new UnprocessableEntityException({ message: 'Выберите время в будущем', code: 'in_past' });
      if (!(await this.bookableTime(trx, r, startsAt))) throw new UnprocessableEntityException({ message: 'Ресторан не принимает брони на это время', code: 'outside_hours' });
      const free = await this.freeTables(trx, r.id, startsAt, busyUntil, input.partySize);
      const table = free.rows[0];
      if (!table) throw new ConflictException({ message: 'На это время нет свободных столиков. Выберите другое время.', code: 'no_tables' });
      const row = await trx
        .insertInto('table_reservation')
        .values({
          property_id: g.propertyId,
          restaurant_id: r.id,
          guest_id: await guestProfileId(trx, g),
          guest_account_id: g.accountId,
          booking_id: input.bookingId ?? null,
          number: shortNumber('T'),
          period: `[${startsAt.toISOString()},${endsAt.toISOString()})`,
          party_size: input.partySize,
          status: r.auto_confirm_reservations ? 'confirmed' : 'requested',
          wishes: input.wishes ?? null,
          allergies: input.allergies ?? null,
          comment: input.comment ?? null,
          idempotency_key: key,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('table_assignment')
        .values({ table_reservation_id: row.id, table_id: table.id, period: `[${startsAt.toISOString()},${busyUntil.toISOString()})` })
        .execute();
      await this.audit.write(
        { propertyId: g.propertyId, actorType: 'guest', actorId: g.accountId, action: 'table_reservation.create', entity: 'table_reservation', entityId: row.id, after: { partySize: input.partySize } },
        trx,
      );
      return row.id;
    });
    return this.getForGuest(g, id);
  }

  private view() {
    return this.db
      .selectFrom('table_reservation as r')
      .innerJoin('restaurant as rs', 'rs.id', 'r.restaurant_id')
      .select((eb) => [
        'r.id', 'r.number', 'r.status', 'r.period', 'r.party_size', 'r.wishes', 'r.allergies', 'r.comment', 'rs.name as restaurant',
        sql<Date>`lower(r.period)`.as('starts_at'),
        sql<Date>`upper(r.period)`.as('ends_at'),
        eb
          .selectFrom('table_assignment as a')
          .innerJoin('restaurant_table as t', 't.id', 'a.table_id')
          .select('t.zone')
          .whereRef('a.table_reservation_id', '=', 'r.id')
          .limit(1)
          .as('zone'),
      ]);
  }

  async getForGuest(g: GuestPrincipal, id: string) {
    const r = await this.view().where('r.id', '=', id).where('r.guest_account_id', '=', g.accountId).executeTakeFirst();
    if (!r) throw new NotFoundException({ message: 'Бронь столика не найдена', code: 'not_found' });
    return {
      id: r.id, number: r.number, status: guestStatus(r.status), startsAt: r.starts_at, endsAt: r.ends_at, partySize: r.party_size,
      wishes: r.wishes, allergies: r.allergies, comment: r.comment, restaurant: r.restaurant, zone: r.zone,
    };
  }

  async cancelByGuest(g: GuestPrincipal, id: string) {
    const r = await this.db.selectFrom('table_reservation').select('id').where('id', '=', id).where('guest_account_id', '=', g.accountId).executeTakeFirst();
    if (!r) throw new NotFoundException({ message: 'Бронь столика не найдена', code: 'not_found' });
    await this.setStatus(g.propertyId, id, 'cancelled', { type: 'guest', id: g.accountId });
    return this.getForGuest(g, id);
  }

  async setStatus(propertyId: string, id: string, to: TableStatus, actor: { type: 'guest' | 'user'; id: string }) {
    await this.db.transaction().execute(async (trx) => {
      const r = await trx.selectFrom('table_reservation').select(['status']).where('id', '=', id).where('property_id', '=', propertyId).forUpdate().executeTakeFirst();
      if (!r) throw new NotFoundException('Бронь столика не найдена');
      const from = r.status as TableStatus;
      if (!TRANSITIONS[from].includes(to)) throw new ConflictException({ message: `Нельзя перевести бронь из «${from}» в «${to}»`, code: 'invalid_transition' });
      await trx.updateTable('table_reservation').set({ status: to }).where('id', '=', id).execute();
      // Столик освобождается сразу после отмены, неявки или ухода гостей
      if (!ACTIVE.includes(to)) await trx.updateTable('table_assignment').set({ is_active: false }).where('table_reservation_id', '=', id).execute();
      await this.audit.write(
        { propertyId, actorType: actor.type, actorId: actor.id, action: 'table_reservation.status', entity: 'table_reservation', entityId: id, before: { status: from }, after: { status: to } },
        trx,
      );
    });
    return { id, status: to };
  }

  // ── Администратор ──

  async staffDay(user: StaffUser, restaurantId: string, date: string) {
    const r = await this.restaurant(user.propertyId, restaurantId);
    const rows = await this.view()
      .innerJoin('guest as g', 'g.id', 'r.guest_id')
      .select(['g.last_name', 'g.first_name', 'g.phone_e164'])
      .where('r.restaurant_id', '=', r.id)
      .where(sql<boolean>`(lower(r.period) AT TIME ZONE ${r.timezone})::date = ${date}::date`)
      .orderBy(sql`lower(r.period)`)
      .execute();
    const contacts = user.permissions.has('guest.contacts.read');
    return rows.map((x) => ({
      id: x.id, number: x.number, status: x.status, startsAt: x.starts_at, endsAt: x.ends_at, partySize: x.party_size, zone: x.zone,
      wishes: x.wishes, allergies: x.allergies, comment: x.comment,
      guestName: [x.last_name, x.first_name].filter(Boolean).join(' '),
      guestPhone: contacts ? x.phone_e164 : null,
    }));
  }

  async save(user: StaffUser, input: RestaurantInput, id?: string) {
    const values = {
      name: input.name,
      description: input.description ?? null,
      phone: input.phone ?? null,
      seating_minutes: input.seatingMinutes ?? 120,
      turnover_minutes: input.turnoverMinutes ?? 15,
      auto_confirm_reservations: input.autoConfirmReservations ?? true,
      accepts_delivery: input.acceptsDelivery ?? true,
      is_active: input.isActive ?? true,
    };
    return this.db.transaction().execute(async (trx) => {
      let rid: string;
      if (id) {
        const r = await trx.updateTable('restaurant').set(values).where('id', '=', id).where('property_id', '=', user.propertyId).returning('id').executeTakeFirst();
        if (!r) throw new NotFoundException('Ресторан не найден');
        rid = r.id;
      } else {
        rid = (await trx.insertInto('restaurant').values({ property_id: user.propertyId, ...values }).returning('id').executeTakeFirstOrThrow()).id;
      }
      if (input.hours) {
        await trx.deleteFrom('restaurant_hours').where('restaurant_id', '=', rid).execute();
        if (input.hours.length) {
          await trx
            .insertInto('restaurant_hours')
            .values(input.hours.map((h) => ({ restaurant_id: rid, weekday: h.weekday, opens_at: h.opensAt, closes_at: h.closesAt, last_seating: h.lastSeating ?? null })))
            .execute();
        }
      }
      await this.audit.write({ propertyId: user.propertyId, actorId: user.id, action: id ? 'restaurant.update' : 'restaurant.create', entity: 'restaurant', entityId: rid, after: input }, trx);
      return { id: rid };
    });
  }

  async addTable(user: StaffUser, restaurantId: string, input: { name: string; seats: number; zone?: string | null }) {
    const r = await this.restaurant(user.propertyId, restaurantId);
    return this.db
      .insertInto('restaurant_table')
      .values({ property_id: user.propertyId, restaurant_id: r.id, name: input.name, seats: input.seats, zone: input.zone ?? null })
      .returning(['id', 'name', 'seats', 'zone'])
      .executeTakeFirstOrThrow();
  }
}
