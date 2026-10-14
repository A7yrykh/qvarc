import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import { PaymentsService } from '../payments/payments.service';
import { EquipmentTypeBody, EquipmentUnitBody, ServiceBody } from './services.schemas';

/** Разделы каталога (service.category) */
export const CATEGORY_NAMES: Record<string, string> = {
  rental: 'Прокат',
  water: 'На воде',
  excursion: 'Экскурсии',
  room_extra: 'В номер',
  food: 'Еда',
  custom: 'Другое',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_NAMES);

export type Actor = { type: 'user' | 'guest' | 'system'; id: string | null; propertyId: string; ip?: string | null };
export type Source = 'admin' | 'guest_app' | 'booking_site';
type Action = 'confirm' | 'issue' | 'return' | 'cancel';
const ALLOWED: Record<Action, string[]> = {
  confirm: ['requested'],
  issue: ['confirmed'],
  return: ['in_use'],
  cancel: ['requested', 'confirmed'],
};
/** Брони проживания, к которым можно добавлять услуги */
const OPEN_BOOKING = ['pending_payment', 'pending_confirmation', 'confirmed', 'checked_in'];

export interface BookInput {
  serviceId: string;
  bookingId: string;
  /** Обязательно для услуги с оборудованием (запись на время); для заявки — желаемое время, если есть */
  startsAt?: Date | null;
  quantity: number;
  comment?: string | null;
}

/**
 * Доп. услуги и прокат.
 * Услуга с типом оборудования бронируется на время: ресурсы — исправные единицы этого типа,
 * двойную выдачу запрещает ограничение исключения на equipment_reservation.
 * Услуга без оборудования — заявка: подтверждается сразу или администратором.
 * Стоимость добавляется в бронь проживания строкой и оплачивается вместе с остатком.
 */
@Injectable()
export class ServicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  // ───────────── каталог ─────────────

  listAll(propertyId: string) {
    return this.db
      .selectFrom('service as s')
      .leftJoin('equipment_type as e', 'e.id', 's.equipment_type_id')
      .selectAll('s')
      .select(['e.name as equipment_name'])
      .where('s.property_id', '=', propertyId)
      .orderBy('s.sort_order')
      .orderBy('s.name')
      .execute();
  }

  /** Каталог для гостя по разделам. onlySlots — только запись на время (приложение). */
  async catalog(propertyId: string, onlySlots = false) {
    let q = this.db
      .selectFrom('service')
      .selectAll()
      .where('property_id', '=', propertyId)
      .where('is_active', '=', true)
      .where('bookable_online', '=', true);
    if (onlySlots) q = q.where('equipment_type_id', 'is not', null);
    const rows = await q.orderBy('sort_order').orderBy('name').execute();
    const groups = new Map<string, { id: string; name: string; services: ReturnType<typeof toPublic>[] }>();
    for (const s of [...rows].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))) {
      if (!groups.has(s.category)) groups.set(s.category, { id: s.category, name: CATEGORY_NAMES[s.category] ?? s.category, services: [] });
      groups.get(s.category)!.services.push(toPublic(s));
    }
    return [...groups.values()];
  }

  private async assertEquipmentType(propertyId: string, id: string, trx: Database = this.db) {
    const e = await trx.selectFrom('equipment_type').selectAll().where('id', '=', id).where('property_id', '=', propertyId).executeTakeFirst();
    if (!e) throw new NotFoundException('Тип оборудования не найден');
    return e;
  }

  private values(input: z.infer<typeof ServiceBody>) {
    return {
      category: input.category,
      name: input.name,
      description: input.description ?? null,
      pricing: input.pricing,
      price_minor: input.priceMinor,
      duration_minutes: input.durationMinutes ?? null,
      min_age: input.minAge ?? null,
      rules: input.rules ?? null,
      cancellation_text: input.cancellationText ?? null,
      open_time: input.openTime,
      close_time: input.closeTime,
      slot_step_minutes: input.slotStepMinutes,
      max_quantity: input.maxQuantity,
      requires_confirmation: input.requiresConfirmation,
      equipment_type_id: input.equipmentTypeId ?? null,
      requires_slot: !!input.equipmentTypeId,
      photos: JSON.stringify(input.photos ?? []),
      sort_order: input.sortOrder,
      bookable_online: input.bookableOnline,
      is_active: input.isActive,
    };
  }

  async createService(a: Actor, input: z.infer<typeof ServiceBody>) {
    if (input.equipmentTypeId) await this.assertEquipmentType(a.propertyId, input.equipmentTypeId);
    return this.db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('service').values({ property_id: a.propertyId, ...this.values(input) }).returningAll().executeTakeFirstOrThrow();
      await this.log(a, 'service.create', 'service', row.id, input, trx);
      return row;
    });
  }

  async updateService(a: Actor, id: string, input: z.infer<typeof ServiceBody>) {
    if (input.equipmentTypeId) await this.assertEquipmentType(a.propertyId, input.equipmentTypeId);
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('service').selectAll().where('id', '=', id).where('property_id', '=', a.propertyId).executeTakeFirst();
      if (!before) throw new NotFoundException('Услуга не найдена');
      const row = await trx.updateTable('service').set(this.values(input)).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.log(a, 'service.update', 'service', id, input, trx, before);
      return row;
    });
  }

  async listEquipment(propertyId: string) {
    const types = await this.db.selectFrom('equipment_type').selectAll().where('property_id', '=', propertyId).orderBy('name').execute();
    const units = types.length
      ? await this.db.selectFrom('equipment_unit').selectAll().where('equipment_type_id', 'in', types.map((t) => t.id)).orderBy('inventory_no').execute()
      : [];
    return types.map((t) => ({ ...t, units: units.filter((u) => u.equipment_type_id === t.id) }));
  }

  async createEquipmentType(a: Actor, input: z.infer<typeof EquipmentTypeBody>) {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('equipment_type')
        .values({ property_id: a.propertyId, name: input.name, deposit_minor: input.depositMinor, buffer_minutes: input.bufferMinutes, is_active: input.isActive })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'equipment.type.create', 'equipment_type', row.id, input, trx);
      return row;
    });
  }

  async updateEquipmentType(a: Actor, id: string, input: z.infer<typeof EquipmentTypeBody>) {
    return this.db.transaction().execute(async (trx) => {
      const before = await this.assertEquipmentType(a.propertyId, id, trx);
      const row = await trx
        .updateTable('equipment_type')
        .set({ name: input.name, deposit_minor: input.depositMinor, buffer_minutes: input.bufferMinutes, is_active: input.isActive })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'equipment.type.update', 'equipment_type', id, input, trx, before);
      return row;
    });
  }

  async createUnit(a: Actor, typeId: string, input: z.infer<typeof EquipmentUnitBody>) {
    return this.db.transaction().execute(async (trx) => {
      await this.assertEquipmentType(a.propertyId, typeId, trx);
      const row = await trx
        .insertInto('equipment_unit')
        .values({ equipment_type_id: typeId, inventory_no: input.inventoryNo, condition: input.condition, notes: input.notes ?? null })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'equipment.unit.create', 'equipment_unit', row.id, input, trx);
      return row;
    });
  }

  async updateUnit(a: Actor, id: string, input: z.infer<typeof EquipmentUnitBody>) {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('equipment_unit as u')
        .innerJoin('equipment_type as t', 't.id', 'u.equipment_type_id')
        .selectAll('u')
        .where('u.id', '=', id)
        .where('t.property_id', '=', a.propertyId)
        .executeTakeFirst();
      if (!before) throw new NotFoundException('Единица оборудования не найдена');
      const row = await trx
        .updateTable('equipment_unit')
        .set({ inventory_no: input.inventoryNo, condition: input.condition, notes: input.notes ?? null })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'equipment.unit.update', 'equipment_unit', id, input, trx, before);
      return row;
    });
  }

  // ───────────── время и свободные единицы ─────────────

  private async service(propertyId: string, id: string, trx: Database = this.db, lock = false) {
    // Брони одной услуги оформляются по очереди
    if (lock) await trx.selectFrom('service').select('id').where('id', '=', id).forUpdate().execute();
    const s = await trx
      .selectFrom('service as s')
      .innerJoin('property as p', 'p.id', 's.property_id')
      .leftJoin('equipment_type as e', 'e.id', 's.equipment_type_id')
      .selectAll('s')
      .select(['p.timezone', 'e.buffer_minutes', 'e.deposit_minor'])
      .where('s.id', '=', id)
      .where('s.property_id', '=', propertyId)
      .where('s.is_active', '=', true)
      .executeTakeFirst();
    if (!s) throw new NotFoundException({ message: 'Услуга не найдена', code: 'not_found' });
    return { ...s, buffer_minutes: s.buffer_minutes ?? 0, deposit_minor: s.deposit_minor ?? 0 };
  }

  /** Исправные единицы, свободные на [from, to) */
  private freeUnits(equipmentTypeId: string, from: unknown, to: unknown) {
    return sql<{ id: string }>`
      SELECT u.id FROM equipment_unit u
       WHERE u.equipment_type_id = ${equipmentTypeId} AND u.condition = 'ok'
         AND NOT EXISTS (SELECT 1 FROM equipment_reservation r
                          WHERE r.equipment_unit_id = u.id AND r.status IN ('reserved', 'issued')
                            AND r.period && tstzrange(${from}, ${to}, '[)'))
       ORDER BY u.inventory_no`;
  }

  /** Свободное время на дату: начало сеансов с шагом slot_step_minutes в часы работы */
  async slots(propertyId: string, serviceId: string, date: string) {
    const s = await this.service(propertyId, serviceId);
    if (!s.equipment_type_id || !s.duration_minutes) {
      // Заявка без оборудования: предлагаем желаемое время в часы работы, подтверждает администратор
      const len = s.duration_minutes ?? s.slot_step_minutes;
      const rows = await sql<{ startsAt: Date; endsAt: Date; available: number }>`
        SELECT gs AS "startsAt", gs + make_interval(mins => ${len}) AS "endsAt", ${s.max_quantity}::int AS available
          FROM generate_series((${date}::date + ${s.open_time}::time) AT TIME ZONE ${s.timezone},
                               (${date}::date + ${s.close_time}::time) AT TIME ZONE ${s.timezone} - make_interval(mins => ${len}),
                               make_interval(mins => ${s.slot_step_minutes})) gs
         WHERE gs > now() ORDER BY gs`.execute(this.db);
      return { serviceId, date, slots: rows.rows };
    }
    const free = this.freeUnits(s.equipment_type_id, sql`sl.starts_at`, sql`sl.busy_until`);
    const rows = await sql<{ startsAt: Date; endsAt: Date; available: number }>`
      WITH sl AS (
        SELECT gs AS starts_at, gs + make_interval(mins => ${s.duration_minutes}) AS ends_at,
               gs + make_interval(mins => ${s.duration_minutes + s.buffer_minutes}) AS busy_until
          FROM generate_series((${date}::date + ${s.open_time}::time) AT TIME ZONE ${s.timezone},
                               (${date}::date + ${s.close_time}::time) AT TIME ZONE ${s.timezone} - make_interval(mins => ${s.duration_minutes}),
                               make_interval(mins => ${s.slot_step_minutes})) gs)
      SELECT sl.starts_at AS "startsAt", sl.ends_at AS "endsAt", (SELECT count(*) FROM (${free}) f)::int AS available
        FROM sl WHERE sl.starts_at > now() ORDER BY sl.starts_at`.execute(this.db);
    return { serviceId, date, slots: rows.rows };
  }

  // ───────────── бронирование ─────────────

  /** Бронь проживания, к которой добавляется услуга, и её даты по местному времени */
  private async stay(propertyId: string, bookingId: string, trx: Database) {
    const b = await trx
      .selectFrom('booking as b')
      .innerJoin('property as p', 'p.id', 'b.property_id')
      .select([
        'b.id', 'b.status', 'b.booker_guest_id', 'b.property_id',
        sql<Date>`((b.arrival + p.check_in_time) AT TIME ZONE p.timezone)`.as('arrival_at'),
        sql<Date>`((b.departure + p.check_out_time) AT TIME ZONE p.timezone)`.as('departure_at'),
      ])
      .where('b.id', '=', bookingId)
      .where('b.property_id', '=', propertyId)
      .forUpdate()
      .executeTakeFirst();
    if (!b) throw new NotFoundException('Бронь не найдена');
    if (!OPEN_BOOKING.includes(b.status)) throw new ConflictException({ message: 'Услуги можно добавить только к действующей брони', code: 'booking_inactive' });
    return b;
  }

  /**
   * Бронь услуги. Повтор с тем же ключом возвращает ту же бронь.
   * Время сверяется с часами работы и датами проживания, оборудование подбирается из свободных исправных единиц.
   */
  async book(a: Actor, input: BookInput, source: Source, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.db.selectFrom('service_booking').select('id').where('idempotency_key', '=', idempotencyKey).executeTakeFirst();
      if (existing) return this.get(a.propertyId, existing.id);
    }
    const id = await this.db.transaction().execute(async (trx) => {
      const b = await this.stay(a.propertyId, input.bookingId, trx);
      const s = await this.service(a.propertyId, input.serviceId, trx, true);
      if (source !== 'admin' && !s.bookable_online) throw new UnprocessableEntityException({ message: 'Эта услуга оформляется через администратора', code: 'not_online' });
      if (input.quantity > s.max_quantity) throw new UnprocessableEntityException({ message: `Можно забронировать не больше ${s.max_quantity}`, code: 'quantity_exceeded' });

      const slot = !!s.equipment_type_id;
      let period: string | null = null;
      let units: { id: string }[] = [];
      let busyUntil: Date | null = null;
      if (slot) {
        if (!input.startsAt) throw new UnprocessableEntityException({ message: 'Выберите время', code: 'time_required' });
        const startsAt = input.startsAt;
        const endsAt = new Date(startsAt.getTime() + s.duration_minutes! * 60_000);
        busyUntil = new Date(endsAt.getTime() + s.buffer_minutes * 60_000);
        if (startsAt <= new Date()) throw new UnprocessableEntityException({ message: 'Выберите время в будущем', code: 'in_past' });
        if (startsAt < new Date(b.arrival_at) || endsAt > new Date(b.departure_at)) {
          throw new UnprocessableEntityException({ message: 'Время услуги должно быть в пределах проживания', code: 'outside_stay' });
        }
        const inHours = await sql<{ ok: boolean }>`
          SELECT ((${startsAt}::timestamptz AT TIME ZONE ${s.timezone})::date = (${endsAt}::timestamptz AT TIME ZONE ${s.timezone})::date
                  AND (${startsAt}::timestamptz AT TIME ZONE ${s.timezone})::time >= ${s.open_time}::time
                  AND (${endsAt}::timestamptz AT TIME ZONE ${s.timezone})::time <= ${s.close_time}::time) AS ok`.execute(trx);
        if (!inHours.rows[0].ok) throw new UnprocessableEntityException({ message: 'Услуга недоступна в это время', code: 'outside_hours' });
        units = (await sql<{ id: string }>`${this.freeUnits(s.equipment_type_id!, startsAt, busyUntil)} LIMIT ${input.quantity}`.execute(trx)).rows;
        if (units.length < input.quantity) {
          throw new ConflictException({ message: units.length ? `На это время свободно только ${units.length}` : 'На это время всё занято', code: 'not_available', available: units.length });
        }
        period = `[${startsAt.toISOString()},${endsAt.toISOString()})`;
      } else if (input.startsAt) {
        period = `[${input.startsAt.toISOString()},${input.startsAt.toISOString()}]`;
      }

      const amount = s.price_minor * input.quantity;
      const status = s.requires_confirmation ? 'requested' : 'confirmed';
      const sb = await trx
        .insertInto('service_booking')
        .values({
          property_id: a.propertyId,
          service_id: s.id,
          booking_id: b.id,
          guest_id: b.booker_guest_id,
          period,
          quantity: input.quantity,
          amount_minor: amount,
          status,
          comment: input.comment ?? null,
          source,
          idempotency_key: idempotencyKey ?? null,
          created_by: a.type === 'user' ? a.id : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const u of units) {
        await trx
          .insertInto('equipment_reservation')
          .values({
            equipment_unit_id: u.id,
            service_booking_id: sb.id,
            guest_id: b.booker_guest_id,
            booking_id: b.id,
            period: `[${input.startsAt!.toISOString()},${busyUntil!.toISOString()})`,
            deposit_minor: s.deposit_minor,
          })
          .execute();
      }
      if (amount > 0) {
        const when = input.startsAt ? `, ${fmtLocal(input.startsAt, s.timezone)}` : '';
        const item = await trx
          .insertInto('booking_item')
          .values({ booking_id: b.id, kind: slot ? 'rental' : 'service', ref_id: sb.id, title: `${s.name}${when}`, quantity: String(input.quantity), amount_minor: amount })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx.updateTable('service_booking').set({ booking_item_id: item.id }).where('id', '=', sb.id).execute();
        await this.retotal(trx, b.id);
      }
      await this.log(a, 'service_booking.create', 'service_booking', sb.id, { ...input, source, amountMinor: amount, status }, trx);
      return sb.id;
    });
    return this.get(a.propertyId, id);
  }

  /** Сумма брони = сумма строк; признак оплаты пересчитывается */
  private async retotal(trx: Database, bookingId: string) {
    const t = await trx.selectFrom('booking_item').select(sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('t')).where('booking_id', '=', bookingId).executeTakeFirstOrThrow();
    await trx.updateTable('booking').set({ total_minor: Math.max(0, Number(t.t)), updated_at: new Date() }).where('id', '=', bookingId).execute();
    await this.payments.recomputePaymentState(trx, bookingId);
  }

  async get(propertyId: string, id: string) {
    const r = await this.db
      .selectFrom('service_booking as sb')
      .innerJoin('service as s', 's.id', 'sb.service_id')
      .leftJoin('booking as b', 'b.id', 'sb.booking_id')
      .innerJoin('guest as g', 'g.id', 'sb.guest_id')
      .selectAll('sb')
      .select([
        's.name as service_name', 's.cancellation_text', 's.equipment_type_id', 'b.number as booking_number', 'g.last_name', 'g.first_name',
        sql<Date | null>`lower(sb.period)`.as('starts_at'),
        sql<Date | null>`upper(sb.period)`.as('ends_at'),
      ])
      .where('sb.id', '=', id)
      .where('sb.property_id', '=', propertyId)
      .executeTakeFirst();
    if (!r) throw new NotFoundException('Бронь услуги не найдена');
    const units = await this.db
      .selectFrom('equipment_reservation as r')
      .innerJoin('equipment_unit as u', 'u.id', 'r.equipment_unit_id')
      .select(['r.id', 'r.status', 'u.inventory_no'])
      .where('r.service_booking_id', '=', id)
      .orderBy('u.inventory_no')
      .execute();
    return { ...r, units };
  }

  /** Расписание: брони услуг за день (по местному времени) и заявки без времени */
  async schedule(propertyId: string, date: string) {
    return this.db
      .selectFrom('service_booking as sb')
      .innerJoin('service as s', 's.id', 'sb.service_id')
      .innerJoin('property as p', 'p.id', 'sb.property_id')
      .leftJoin('booking as b', 'b.id', 'sb.booking_id')
      .innerJoin('guest as g', 'g.id', 'sb.guest_id')
      .selectAll('sb')
      .select([
        's.name as service_name', 's.category', 'b.number as booking_number', 'g.last_name', 'g.first_name', 'g.phone_e164',
        sql<Date | null>`lower(sb.period)`.as('starts_at'),
        sql<Date | null>`upper(sb.period)`.as('ends_at'),
        sql<string | null>`(SELECT string_agg(u.inventory_no, ', ' ORDER BY u.inventory_no) FROM equipment_reservation r JOIN equipment_unit u ON u.id = r.equipment_unit_id
                            WHERE r.service_booking_id = sb.id AND r.status <> 'cancelled')`.as('units'),
      ])
      .where('sb.property_id', '=', propertyId)
      .where((eb) =>
        eb.or([
          eb(sql`(lower(sb.period) AT TIME ZONE p.timezone)::date`, '=', date),
          eb.and([eb('sb.period', 'is', null), eb('sb.status', 'in', ['requested', 'confirmed'])]),
        ]),
      )
      .orderBy(sql`lower(sb.period)`, sql`asc nulls last`)
      .orderBy('sb.created_at')
      .execute();
  }

  /** Бронь услуги в виде, который ждёт приложение (ServiceBookingResult) */
  async forGuest(propertyId: string, id: string, bookingIds: string[]) {
    const r = await this.get(propertyId, id);
    if (!r.booking_id || !bookingIds.includes(r.booking_id)) throw new NotFoundException('Бронь услуги не найдена');
    return toGuest(r);
  }

  async listForGuest(propertyId: string, bookingIds: string[]) {
    if (!bookingIds.length) return [];
    const rows = await this.db.selectFrom('service_booking').select('id').where('property_id', '=', propertyId).where('booking_id', 'in', bookingIds).orderBy('created_at', 'desc').execute();
    return Promise.all(rows.map((r) => this.get(propertyId, r.id).then(toGuest)));
  }

  forBooking(propertyId: string, bookingId: string) {
    return this.db
      .selectFrom('service_booking as sb')
      .innerJoin('service as s', 's.id', 'sb.service_id')
      .selectAll('sb')
      .select(['s.name as service_name', sql<Date | null>`lower(sb.period)`.as('starts_at'), sql<Date | null>`upper(sb.period)`.as('ends_at')])
      .where('sb.property_id', '=', propertyId)
      .where('sb.booking_id', '=', bookingId)
      .orderBy('sb.created_at')
      .execute();
  }

  /**
   * Подтверждение заявки, выдача, возврат, отмена.
   * Отмена снимает строку из брони проживания; если услуга уже оплачена, возврат делается кнопкой «Вернуть» в брони.
   */
  async act(a: Actor, id: string, action: Action, opts: { needsCheck?: boolean; guestBookingIds?: string[] } = {}) {
    await this.db.transaction().execute(async (trx) => {
      const sb = await trx.selectFrom('service_booking').selectAll().where('id', '=', id).where('property_id', '=', a.propertyId).forUpdate().executeTakeFirst();
      if (!sb || (opts.guestBookingIds && !opts.guestBookingIds.includes(sb.booking_id ?? ''))) throw new NotFoundException('Бронь услуги не найдена');
      if (!ALLOWED[action].includes(sb.status)) throw new ConflictException({ message: 'Действие недоступно в текущем статусе', code: 'bad_status', status: sb.status });
      const now = new Date();
      if (action === 'confirm') {
        await trx.updateTable('service_booking').set({ status: 'confirmed' }).where('id', '=', id).execute();
      } else if (action === 'issue') {
        await trx.updateTable('service_booking').set({ status: 'in_use' }).where('id', '=', id).execute();
        await trx.updateTable('equipment_reservation').set({ status: 'issued', issued_at: now, issued_by: a.type === 'user' ? a.id : null }).where('service_booking_id', '=', id).where('status', '=', 'reserved').execute();
      } else if (action === 'return') {
        await trx.updateTable('service_booking').set({ status: 'done' }).where('id', '=', id).execute();
        const res = await trx
          .updateTable('equipment_reservation')
          .set({ status: 'returned', returned_at: now, returned_by: a.type === 'user' ? a.id : null })
          .where('service_booking_id', '=', id)
          .where('status', '=', 'issued')
          .returning('equipment_unit_id')
          .execute();
        if (opts.needsCheck && res.length) await trx.updateTable('equipment_unit').set({ condition: 'needs_check' }).where('id', 'in', res.map((r) => r.equipment_unit_id)).execute();
      } else {
        if (a.type === 'guest') {
          const start = await sql<{ s: Date | null }>`SELECT lower(${sql.ref('period')}) AS s FROM service_booking WHERE id = ${id}`.execute(trx);
          if (start.rows[0].s && new Date(start.rows[0].s) <= now) throw new ConflictException({ message: 'Время услуги уже наступило, отменить её может администратор', code: 'started' });
        }
        await trx.updateTable('service_booking').set({ status: 'cancelled', cancelled_at: now }).where('id', '=', id).execute();
        await trx.updateTable('equipment_reservation').set({ status: 'cancelled' }).where('service_booking_id', '=', id).where('status', '=', 'reserved').execute();
        if (sb.booking_item_id && sb.booking_id) {
          await trx.updateTable('service_booking').set({ booking_item_id: null }).where('id', '=', id).execute();
          await trx.deleteFrom('booking_item').where('id', '=', sb.booking_item_id).execute();
          await this.retotal(trx, sb.booking_id);
        }
      }
      await this.log(a, `service_booking.${action}`, 'service_booking', id, { needsCheck: opts.needsCheck }, trx, { status: sb.status });
    });
    return this.get(a.propertyId, id);
  }

  private log(a: Actor, action: string, entity: string, entityId: string, after: unknown, trx: Database, before?: unknown) {
    return this.audit.write({ propertyId: a.propertyId, actorType: a.type, actorId: a.id, action, entity, entityId, before, after, ip: a.ip ?? null }, trx);
  }
}

function toPublic(s: { id: string; name: string; description: string | null; price_minor: number; equipment_type_id: string | null; duration_minutes: number | null; min_age: number | null; rules: string | null; cancellation_text: string | null; photos: unknown; max_quantity: number; requires_confirmation: boolean; pricing: string }) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    price: s.price_minor,
    pricing: s.pricing,
    bookingMode: s.equipment_type_id ? 'slot' : 'request',
    durationMinutes: s.duration_minutes,
    minAge: s.min_age,
    rules: s.rules,
    cancellationPolicy: s.cancellation_text,
    photos: ((s.photos as { url: string }[] | string[]) ?? []).map((p) => (typeof p === 'string' ? p : p.url)),
    maxQuantity: s.max_quantity,
    requiresConfirmation: s.requires_confirmation,
  };
}

const GUEST_STATUS: Record<string, string> = { requested: 'pending_confirmation', confirmed: 'confirmed', in_use: 'confirmed', done: 'confirmed', cancelled: 'canceled' };

function toGuest(r: { id: string; status: string; starts_at: Date | null; ends_at: Date | null; created_at: Date; quantity: number; amount_minor: number | string; service_name: string; cancellation_text: string | null }) {
  const startsAt = r.starts_at ?? r.created_at;
  return {
    id: r.id,
    status: GUEST_STATUS[r.status] ?? r.status,
    startsAt,
    endsAt: r.ends_at ?? startsAt,
    quantity: r.quantity,
    amount: Number(r.amount_minor),
    holdExpiresAt: null,
    service: r.service_name,
    cancellationPolicy: r.cancellation_text,
  };
}

function fmtLocal(d: Date, timeZone: string) {
  return d.toLocaleString('ru-RU', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
