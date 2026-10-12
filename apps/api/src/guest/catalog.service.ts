import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import type { StaffUser } from '../iam/auth.decorators';
import type { GuestPrincipal } from './guest.guard';
import { guestProfileId } from './guest-profile';
import { GuestStayService } from './stay.service';

/** Названия разделов каталога для гостя (service.category) */
export const CATEGORY_NAMES: Record<string, string> = {
  rental: 'Прокат',
  water: 'На воде',
  excursion: 'Экскурсии',
  room_extra: 'В номер',
  food: 'Еда',
  custom: 'Другое',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_NAMES);

type Actor = { type: 'guest' | 'user'; id: string };
type Action = 'confirm' | 'issue' | 'return' | 'cancel';
const ALLOWED: Record<Action, string[]> = {
  confirm: ['requested'],
  issue: ['confirmed'],
  return: ['in_use'],
  cancel: ['requested', 'hold', 'confirmed'],
};
/** Для приложения: «requested» показывается как «ждёт подтверждения» */
const guestStatus = (s: string) => (s === 'requested' ? 'pending_confirmation' : s);

export interface ServiceInput {
  category: string;
  name: string;
  description?: string | null;
  pricing?: 'per_item' | 'per_hour' | 'per_day' | 'per_person' | 'per_stay';
  priceMinor: number;
  durationMinutes?: number | null;
  minAge?: number | null;
  rules?: string | null;
  cancellationText?: string | null;
  openTime?: string;
  closeTime?: string;
  slotStepMinutes?: number;
  maxQuantity?: number;
  requiresConfirmation?: boolean;
  holdMinutes?: number;
  equipmentTypeId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Услуги и прокат. Ресурсы услуги — исправные единицы оборудования её типа (equipment_unit).
 * Защита от двойной брони в два слоя: блокировка услуги на время подбора единиц
 * и ограничение исключения на equipment_reservation.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly stay: GuestStayService,
    private readonly audit: AuditService,
  ) {}

  async list(propertyId: string) {
    const rows = await this.db
      .selectFrom('service')
      .selectAll()
      .where('property_id', '=', propertyId)
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .orderBy('name')
      .execute();
    const groups = new Map<string, { id: string; name: string; services: unknown[] }>();
    const sorted = [...rows].sort((a, b) => rank(a.category) - rank(b.category));
    for (const s of sorted) {
      if (!groups.has(s.category)) groups.set(s.category, { id: s.category, name: CATEGORY_NAMES[s.category] ?? s.category, services: [] });
      groups.get(s.category)!.services.push({
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price_minor,
        bookingMode: slotMode(s) ? 'slot' : 'request',
        durationMinutes: s.duration_minutes,
        minAge: s.min_age,
        rules: s.rules,
        cancellationPolicy: s.cancellation_text,
        photos: s.photos as string[],
        maxQuantity: s.max_quantity,
        requiresConfirmation: s.requires_confirmation,
      });
    }
    return [...groups.values()];
  }

  private async service(propertyId: string, id: string, trx: Database = this.db, lock = false) {
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

  /** Неоплаченные удержания с истёкшим сроком освобождают оборудование */
  private async releaseExpiredHolds(trx: Database, serviceId: string) {
    const expired = await trx
      .updateTable('service_booking')
      .set({ status: 'expired' })
      .where('service_id', '=', serviceId)
      .where('status', '=', 'hold')
      .where('hold_expires_at', '<=', new Date())
      .returning('id')
      .execute();
    if (expired.length) {
      await trx
        .updateTable('equipment_reservation')
        .set({ status: 'cancelled' })
        .where('service_booking_id', 'in', expired.map((e) => e.id))
        .where('status', '=', 'reserved')
        .execute();
    }
  }

  /** Исправные единицы, свободные на [from, to) */
  private freeUnits(trx: Database, equipmentTypeId: string, from: Date | ReturnType<typeof sql>, to: Date | ReturnType<typeof sql>) {
    return sql<{ id: string }>`
      SELECT u.id FROM equipment_unit u
       WHERE u.equipment_type_id = ${equipmentTypeId} AND u.condition = 'ok'
         AND NOT EXISTS (SELECT 1 FROM equipment_reservation r
                          WHERE r.equipment_unit_id = u.id AND r.status IN ('reserved', 'issued')
                            AND r.period && tstzrange(${from}, ${to}, '[)'))
       ORDER BY u.inventory_no`;
  }

  async slots(propertyId: string, serviceId: string, date: string) {
    const s = await this.service(propertyId, serviceId);
    if (!slotMode(s)) return { serviceId, date, slots: [] };
    await this.db.transaction().execute((trx) => this.releaseExpiredHolds(trx, s.id));
    const free = this.freeUnits(this.db, s.equipment_type_id!, sql`sl.starts_at`, sql`sl.busy_until`);
    const rows = await sql<{ startsAt: Date; endsAt: Date; available: number }>`
      WITH sl AS (
        SELECT gs AS starts_at, gs + make_interval(mins => ${s.duration_minutes}) AS ends_at,
               gs + make_interval(mins => ${s.duration_minutes! + s.buffer_minutes}) AS busy_until
          FROM generate_series((${date}::date + ${s.open_time}::time) AT TIME ZONE ${s.timezone},
                               (${date}::date + ${s.close_time}::time) AT TIME ZONE ${s.timezone} - make_interval(mins => ${s.duration_minutes}),
                               make_interval(mins => ${s.slot_step_minutes})) gs)
      SELECT sl.starts_at AS "startsAt", sl.ends_at AS "endsAt", (SELECT count(*) FROM (${free}) f)::int AS available
        FROM sl WHERE sl.starts_at > now() ORDER BY sl.starts_at`.execute(this.db);
    return { serviceId, date, slots: rows.rows };
  }

  async book(g: GuestPrincipal, input: { serviceId: string; bookingId: string; startsAt: Date; quantity: number; comment?: string }, key: string) {
    const existing = await this.db.selectFrom('service_booking').select('id').where('idempotency_key', '=', key).executeTakeFirst();
    if (existing) return this.getForGuest(g, existing.id);

    const stay = await this.stay.getOwn(g, input.bookingId);
    if (!['confirmed', 'checked_in'].includes(stay.status)) {
      throw new ConflictException({ message: 'Услуги доступны только при действующем бронировании', code: 'booking_inactive' });
    }

    const id = await this.db.transaction().execute(async (trx) => {
      // Брони одной услуги оформляются по очереди
      const s = await this.service(g.propertyId, input.serviceId, trx, true);
      if (!slotMode(s)) throw new UnprocessableEntityException({ message: 'Эта услуга оформляется через администратора', code: 'not_slot_service' });
      if (input.quantity > s.max_quantity) {
        throw new UnprocessableEntityException({ message: `Можно забронировать не больше ${s.max_quantity}`, code: 'quantity_exceeded' });
      }
      const now = new Date();
      const startsAt = input.startsAt;
      const endsAt = new Date(startsAt.getTime() + s.duration_minutes! * 60_000);
      const busyUntil = new Date(endsAt.getTime() + s.buffer_minutes * 60_000);
      if (startsAt <= now) throw new UnprocessableEntityException({ message: 'Выберите время в будущем', code: 'in_past' });
      if (startsAt < new Date(stay.arrival_at) || endsAt > new Date(stay.departure_at)) {
        throw new UnprocessableEntityException({ message: 'Время услуги должно быть в пределах проживания', code: 'outside_stay' });
      }
      const inHours = await sql<{ ok: boolean }>`
        SELECT ((${startsAt}::timestamptz AT TIME ZONE ${s.timezone})::date = (${endsAt}::timestamptz AT TIME ZONE ${s.timezone})::date
                AND (${startsAt}::timestamptz AT TIME ZONE ${s.timezone})::time >= ${s.open_time}::time
                AND (${endsAt}::timestamptz AT TIME ZONE ${s.timezone})::time <= ${s.close_time}::time) AS ok`.execute(trx);
      if (!inHours.rows[0].ok) throw new UnprocessableEntityException({ message: 'Услуга недоступна в это время', code: 'outside_hours' });

      await this.releaseExpiredHolds(trx, s.id);
      const free = (await sql<{ id: string }>`${this.freeUnits(trx, s.equipment_type_id!, startsAt, busyUntil)} LIMIT ${input.quantity}`.execute(trx)).rows;
      if (free.length < input.quantity) {
        throw new ConflictException({
          message: free.length ? `На это время свободно только ${free.length}` : 'На это время всё занято',
          code: 'not_available',
          available: free.length,
        });
      }
      const amount = s.price_minor * input.quantity;
      const status = s.requires_confirmation ? 'requested' : amount > 0 ? 'hold' : 'confirmed';
      const guestId = await guestProfileId(trx, g);
      const row = await trx
        .insertInto('service_booking')
        .values({
          service_id: s.id,
          booking_id: stay.id,
          guest_id: guestId,
          guest_account_id: g.accountId,
          period: `[${startsAt.toISOString()},${endsAt.toISOString()})`,
          quantity: input.quantity,
          amount_minor: amount,
          status,
          hold_expires_at: status === 'hold' ? new Date(now.getTime() + s.hold_minutes * 60_000) : null,
          comment: input.comment ?? null,
          idempotency_key: key,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('equipment_reservation')
        .values(
          free.map((u) => ({
            equipment_unit_id: u.id,
            service_booking_id: row.id,
            guest_id: guestId,
            booking_id: stay.id,
            period: `[${startsAt.toISOString()},${busyUntil.toISOString()})`,
            deposit_minor: s.deposit_minor,
          })),
        )
        .execute();
      await this.audit.write(
        {
          propertyId: g.propertyId, actorType: 'guest', actorId: g.accountId, action: 'service_booking.create',
          entity: 'service_booking', entityId: row.id, after: { serviceId: s.id, quantity: input.quantity, status },
        },
        trx,
      );
      return row.id;
    });
    return this.getForGuest(g, id);
  }

  async getForGuest(g: GuestPrincipal, id: string) {
    const r = await this.db
      .selectFrom('service_booking as sb')
      .innerJoin('service as s', 's.id', 'sb.service_id')
      .select([
        'sb.id', 'sb.status', 'sb.quantity', 'sb.amount_minor', 'sb.hold_expires_at', 's.name', 's.cancellation_text',
        sql<Date>`lower(sb.period)`.as('starts_at'),
        sql<Date>`upper(sb.period)`.as('ends_at'),
      ])
      .where('sb.id', '=', id)
      .where('sb.guest_account_id', '=', g.accountId)
      .executeTakeFirst();
    if (!r) throw new NotFoundException({ message: 'Бронирование услуги не найдено', code: 'not_found' });
    // Истёкшее удержание гость видит сразу, даже если его ещё никто не освободил
    const expired = r.status === 'hold' && r.hold_expires_at && new Date(r.hold_expires_at) <= new Date();
    return {
      id: r.id, status: expired ? 'expired' : guestStatus(r.status), startsAt: r.starts_at, endsAt: r.ends_at, quantity: r.quantity,
      amount: r.amount_minor, holdExpiresAt: r.hold_expires_at, service: r.name, cancellationPolicy: r.cancellation_text,
    };
  }

  async cancelByGuest(g: GuestPrincipal, id: string) {
    const own = await this.db.selectFrom('service_booking').select('id').where('id', '=', id).where('guest_account_id', '=', g.accountId).executeTakeFirst();
    if (!own) throw new NotFoundException({ message: 'Бронирование услуги не найдено', code: 'not_found' });
    await this.transition(g.propertyId, id, 'cancel', { type: 'guest', id: g.accountId });
    return this.getForGuest(g, id);
  }

  // ── Сотрудники проката ──

  async staffDay(user: StaffUser, date: string) {
    const rows = await sql<{
      id: string; service: string; status: string; startsAt: Date; endsAt: Date; quantity: number; amount: number;
      last_name: string; first_name: string; phone_e164: string | null; unit: string | null;
      units: { inventoryNo: string; status: string; issuedAt: string | null; returnedAt: string | null }[]; overdue: boolean;
    }>`
      SELECT sb.id, s.name AS service, sb.status, lower(sb.period) AS "startsAt", upper(sb.period) AS "endsAt", sb.quantity,
             sb.amount_minor AS amount, g.last_name, g.first_name, g.phone_e164, u.name AS unit,
             coalesce(json_agg(json_build_object('inventoryNo', eu.inventory_no, 'status', r.status, 'issuedAt', r.issued_at, 'returnedAt', r.returned_at))
                      FILTER (WHERE r.id IS NOT NULL), '[]') AS units,
             (sb.status = 'in_use' AND upper(sb.period) < now()) AS overdue
        FROM service_booking sb
        JOIN service s ON s.id = sb.service_id
        JOIN property p ON p.id = s.property_id
        JOIN guest g ON g.id = sb.guest_id
        LEFT JOIN LATERAL (SELECT unit_id FROM booking_stay WHERE booking_id = sb.booking_id AND is_active LIMIT 1) st ON true
        LEFT JOIN accommodation_unit u ON u.id = st.unit_id
        LEFT JOIN equipment_reservation r ON r.service_booking_id = sb.id
        LEFT JOIN equipment_unit eu ON eu.id = r.equipment_unit_id
       WHERE s.property_id = ${user.propertyId}
         AND (((lower(sb.period) AT TIME ZONE p.timezone)::date = ${date}::date AND sb.status NOT IN ('expired'))
              OR sb.status = 'in_use')
       GROUP BY sb.id, s.name, g.id, u.name
       ORDER BY lower(sb.period)`.execute(this.db);
    const contacts = user.permissions.has('guest.contacts.read');
    return rows.rows.map(({ last_name, first_name, phone_e164, ...x }) => ({
      ...x,
      guestName: [last_name, first_name].filter(Boolean).join(' '),
      guestPhone: contacts ? phone_e164 : null,
    }));
  }

  async transition(propertyId: string, id: string, action: Action, actor: Actor) {
    await this.db.transaction().execute(async (trx) => {
      const own = await trx
        .selectFrom('service_booking as sb')
        .innerJoin('service as s', 's.id', 'sb.service_id')
        .select('sb.id')
        .where('sb.id', '=', id)
        .where('s.property_id', '=', propertyId)
        .executeTakeFirst();
      if (!own) throw new NotFoundException({ message: 'Бронирование услуги не найдено', code: 'not_found' });
      const sb = await trx.selectFrom('service_booking').select(['status', 'payment_status']).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      const now = new Date();
      const current = sb.status;
      if (!ALLOWED[action].includes(current)) {
        throw new ConflictException({ message: 'Это действие сейчас недоступно', code: 'invalid_transition', status: guestStatus(current) });
      }
      const to = { confirm: 'confirmed', issue: 'in_use', return: 'done', cancel: 'cancelled' }[action];
      await trx
        .updateTable('service_booking')
        .set({ status: to, ...(action === 'cancel' ? { cancelled_at: now } : {}), ...(action === 'confirm' ? {} : { hold_expires_at: null }) })
        .where('id', '=', id)
        .execute();
      const res = trx.updateTable('equipment_reservation').where('service_booking_id', '=', id);
      const staffId = actor.type === 'user' ? actor.id : null;
      if (action === 'cancel') await res.set({ status: 'cancelled' }).where('status', '=', 'reserved').execute();
      if (action === 'issue') await res.set({ status: 'issued', issued_at: now, issued_by: staffId }).where('status', '=', 'reserved').execute();
      // Возвращённое оборудование сразу свободно: ограничение на пересечение учитывает только брони и выдачи
      if (action === 'return') await res.set({ status: 'returned', returned_at: now, returned_by: staffId }).where('status', '=', 'issued').execute();
      // Возврат денег за оплаченную услугу оформляет сотрудник: создаём задачу
      if (action === 'cancel' && sb.payment_status === 'paid') {
        await trx
          .insertInto('staff_task')
          .values({ property_id: propertyId, kind: 'refund_service', title: 'Вернуть оплату за отменённую услугу', source_ref: id, priority: 1, dedupe_key: `refund_service:${id}` })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      }
      await this.audit.write(
        { propertyId, actorType: actor.type, actorId: actor.id, action: `service_booking.${action}`, entity: 'service_booking', entityId: id, before: { status: current }, after: { status: to } },
        trx,
      );
    });
    return { id, ok: true };
  }

  // ── Каталог: услуги, типы оборудования, единицы ──

  async save(user: StaffUser, input: ServiceInput, id?: string) {
    const values = {
      category: input.category,
      name: input.name,
      description: input.description ?? null,
      pricing: input.pricing ?? 'per_item',
      price_minor: input.priceMinor,
      duration_minutes: input.durationMinutes ?? null,
      min_age: input.minAge ?? null,
      rules: input.rules ?? null,
      cancellation_text: input.cancellationText ?? null,
      open_time: input.openTime ?? '09:00',
      close_time: input.closeTime ?? '21:00',
      slot_step_minutes: input.slotStepMinutes ?? 60,
      max_quantity: input.maxQuantity ?? 1,
      requires_confirmation: input.requiresConfirmation ?? false,
      hold_minutes: input.holdMinutes ?? 15,
      equipment_type_id: input.equipmentTypeId ?? null,
      requires_slot: !!input.equipmentTypeId && !!input.durationMinutes,
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
    };
    if (values.equipment_type_id) await this.equipmentType(user.propertyId, values.equipment_type_id);
    return this.db.transaction().execute(async (trx) => {
      let sid: string;
      if (id) {
        const r = await trx.updateTable('service').set(values).where('id', '=', id).where('property_id', '=', user.propertyId).returning('id').executeTakeFirst();
        if (!r) throw new NotFoundException({ message: 'Услуга не найдена', code: 'not_found' });
        sid = r.id;
      } else {
        sid = (await trx.insertInto('service').values({ property_id: user.propertyId, ...values }).returning('id').executeTakeFirstOrThrow()).id;
      }
      await this.audit.write({ propertyId: user.propertyId, actorId: user.id, action: id ? 'service.update' : 'service.create', entity: 'service', entityId: sid, after: input }, trx);
      return { id: sid };
    });
  }

  private async equipmentType(propertyId: string, id: string) {
    const t = await this.db.selectFrom('equipment_type').selectAll().where('id', '=', id).where('property_id', '=', propertyId).executeTakeFirst();
    if (!t) throw new NotFoundException({ message: 'Тип оборудования не найден', code: 'not_found' });
    return t;
  }

  async equipment(user: StaffUser) {
    const types = await this.db.selectFrom('equipment_type').selectAll().where('property_id', '=', user.propertyId).orderBy('name').execute();
    const units = types.length
      ? await this.db.selectFrom('equipment_unit').selectAll().where('equipment_type_id', 'in', types.map((t) => t.id)).orderBy('inventory_no').execute()
      : [];
    return types.map((t) => ({
      id: t.id, name: t.name, depositMinor: t.deposit_minor, bufferMinutes: t.buffer_minutes, isActive: t.is_active,
      units: units.filter((u) => u.equipment_type_id === t.id).map((u) => ({ id: u.id, inventoryNo: u.inventory_no, condition: u.condition, notes: u.notes })),
    }));
  }

  async addEquipmentType(user: StaffUser, input: { name: string; depositMinor?: number; bufferMinutes?: number }) {
    const t = await this.db
      .insertInto('equipment_type')
      .values({ property_id: user.propertyId, name: input.name, deposit_minor: input.depositMinor ?? 0, buffer_minutes: input.bufferMinutes ?? 0 })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit.write({ propertyId: user.propertyId, actorId: user.id, action: 'equipment_type.create', entity: 'equipment_type', entityId: t.id, after: input });
    return t;
  }

  async addUnit(user: StaffUser, typeId: string, input: { inventoryNo: string; notes?: string | null }) {
    await this.equipmentType(user.propertyId, typeId);
    const taken = await this.db.selectFrom('equipment_unit').select('id').where('inventory_no', '=', input.inventoryNo).executeTakeFirst();
    if (taken) throw new ConflictException({ message: 'Такой инвентарный номер уже есть', code: 'inventory_no_taken' });
    return this.db
      .insertInto('equipment_unit')
      .values({ equipment_type_id: typeId, inventory_no: input.inventoryNo, notes: input.notes ?? null })
      .returning(['id', 'inventory_no as inventoryNo', 'condition'])
      .executeTakeFirstOrThrow();
  }

  /** Единица на осмотре или в ремонте не выдаётся; уже оформленные брони остаются, их видно в списке дня */
  async setUnitCondition(user: StaffUser, unitId: string, condition: 'ok' | 'needs_check' | 'damaged' | 'retired', note?: string) {
    const u = await this.db
      .selectFrom('equipment_unit as u')
      .innerJoin('equipment_type as t', 't.id', 'u.equipment_type_id')
      .select(['u.id', 'u.condition'])
      .where('u.id', '=', unitId)
      .where('t.property_id', '=', user.propertyId)
      .executeTakeFirst();
    if (!u) throw new NotFoundException({ message: 'Единица оборудования не найдена', code: 'not_found' });
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('equipment_unit').set({ condition }).where('id', '=', unitId).execute();
      await trx.insertInto('equipment_condition_log').values({ equipment_unit_id: unitId, condition, damage_note: note ?? null, recorded_by: user.id }).execute();
      await this.audit.write(
        { propertyId: user.propertyId, actorId: user.id, action: 'equipment_unit.condition', entity: 'equipment_unit', entityId: unitId, before: { condition: u.condition }, after: { condition } },
        trx,
      );
    });
    return { id: unitId, condition };
  }
}

const rank = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
const slotMode = (s: { equipment_type_id: string | null; duration_minutes: number | null }) => !!s.equipment_type_id && !!s.duration_minutes;
