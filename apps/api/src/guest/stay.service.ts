import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../../../packages/db/src';
import { DB } from '../common/tokens';
import { CHECKIN_STATUS_LABELS, computeCheckinStatus, registrationCanComplete, type StayFacts } from './checkin-status';
import { guestInfo } from './content';
import type { GuestPrincipal } from './guest.guard';

export interface GuestBookingRow {
  id: string;
  number: string;
  status: string;
  property_id: string;
  property_name: string;
  currency: string;
  settings: Record<string, unknown>;
  arrival: string;
  departure: string;
  arrival_at: Date;
  departure_at: Date;
  adults: number;
  children_ages: number[];
  total_minor: number;
  paid_minor: number;
  stay_id: string;
  unit_id: string | null;
  unit_name: string | null;
  type_name: string;
  max_occupancy: number;
}

/** Настройки приложения гостя в property.settings.guestApp */
export interface GuestAppSettings {
  /** За сколько дней до заезда открывается онлайн-регистрация (по умолчанию 7) */
  registrationOpensDaysBefore?: number;
  /** Нужны ли паспортные данные гостей (по умолчанию да) */
  documentsRequired?: boolean;
  /** Код от двери только после полной оплаты (по умолчанию да) */
  paymentRequiredBeforeAccess?: boolean;
  /** Сколько дней после выезда хранить паспортные данные (по умолчанию 30) */
  documentsRetentionDays?: number;
}

export const settingsOf = (row: GuestBookingRow): GuestAppSettings => ((row.settings ?? {}) as { guestApp?: GuestAppSettings }).guestApp ?? {};

/**
 * Брони гостя и пересчёт статуса заселения.
 * Бронь принадлежит гостю, если телефон бронирующего совпадает с номером, подтверждённым по SMS.
 * Чужая бронь выглядит как отсутствующая.
 */
@Injectable()
export class GuestStayService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private query(trx: Database, where: ReturnType<typeof sql>) {
    return sql<GuestBookingRow>`
      SELECT b.id, b.number, b.status::text AS status, b.property_id, p.name AS property_name, p.currency, p.settings,
             b.arrival, b.departure,
             ((b.arrival + p.check_in_time) AT TIME ZONE p.timezone) AS arrival_at,
             ((b.departure + p.check_out_time) AT TIME ZONE p.timezone) AS departure_at,
             b.adults, b.children_ages, b.total_minor, coalesce(pay.paid, 0)::bigint AS paid_minor,
             s.id AS stay_id, s.unit_id, u.name AS unit_name, t.name AS type_name, t.max_occupancy
        FROM booking b
        JOIN property p ON p.id = b.property_id
        JOIN guest g ON g.id = b.booker_guest_id
        JOIN LATERAL (SELECT * FROM booking_stay WHERE booking_id = b.id ORDER BY is_active DESC, id LIMIT 1) s ON true
        JOIN accommodation_type t ON t.id = s.accommodation_type_id
        LEFT JOIN accommodation_unit u ON u.id = s.unit_id
        LEFT JOIN LATERAL (
          SELECT sum(pm.amount_minor) - coalesce(sum(rf.refunded), 0) AS paid
            FROM payment pm
            LEFT JOIN LATERAL (SELECT sum(amount_minor) AS refunded FROM refund
                                WHERE payment_id = pm.id AND status = 'succeeded') rf ON true
           WHERE pm.booking_id = b.id AND pm.status = 'succeeded' AND pm.purpose IN ('prepayment', 'balance')
        ) pay ON true
       WHERE b.status NOT IN ('draft', 'expired') AND ${where}
       ORDER BY b.arrival DESC`.execute(trx);
  }

  async listOwn(g: GuestPrincipal, trx: Database = this.db) {
    const r = await this.query(trx, sql`b.property_id = ${g.propertyId} AND g.phone_e164 = ${g.phone}`);
    return r.rows;
  }

  async getOwn(g: GuestPrincipal, bookingId: string, trx: Database = this.db, lock = false) {
    if (lock) await trx.selectFrom('booking').select('id').where('id', '=', bookingId).forUpdate().execute();
    const r = await this.query(trx, sql`b.id = ${bookingId} AND b.property_id = ${g.propertyId} AND g.phone_e164 = ${g.phone}`);
    if (!r.rows[0]) throw new NotFoundException({ message: 'Бронирование не найдено', code: 'not_found' });
    return r.rows[0];
  }

  /** Та же бронь для сотрудника: без проверки телефона, только в пределах объекта сотрудника. */
  async getForStaff(propertyId: string, bookingId: string, trx: Database = this.db, lock = false) {
    if (lock) await trx.selectFrom('booking').select('id').where('id', '=', bookingId).forUpdate().execute();
    const r = await this.query(trx, sql`b.id = ${bookingId} AND b.property_id = ${propertyId}`);
    if (!r.rows[0]) throw new NotFoundException('Бронь не найдена');
    return r.rows[0];
  }

  async facts(b: GuestBookingRow, trx: Database = this.db): Promise<StayFacts> {
    const rec = await trx.selectFrom('checkin_record').selectAll().where('booking_id', '=', b.id).executeTakeFirst();
    const access = await sql<{ active: boolean; device: boolean }>`
      SELECT EXISTS (SELECT 1 FROM access_grant WHERE booking_stay_id = ${b.stay_id} AND status = 'active' AND valid @> now()) AS active,
             EXISTS (SELECT 1 FROM lock_device WHERE unit_id = ${b.unit_id}) AS device`.execute(trx);
    const s = settingsOf(b);
    const now = new Date();
    const days = s.registrationOpensDaysBefore ?? 7;
    const checkedOut = await trx.selectFrom('booking_stay').select(['actual_check_in', 'actual_check_out']).where('id', '=', b.stay_id).executeTakeFirstOrThrow();
    const state: StayFacts['bookingState'] =
      b.status === 'confirmed' || b.status === 'checked_in' ? 'active'
        : b.status === 'checked_out' ? 'finished'
          : b.status === 'pending_payment' || b.status === 'pending_confirmation' ? 'pending'
            : 'cancelled';
    return {
      now,
      bookingState: state,
      arrivalAt: b.arrival_at,
      departureAt: b.departure_at,
      registrationOpensAt: new Date(b.arrival_at.getTime() - days * 86_400_000),
      balanceDue: Math.max(0, b.total_minor - b.paid_minor),
      paymentRequiredBeforeAccess: s.paymentRequiredBeforeAccess ?? true,
      documentsRequired: s.documentsRequired ?? true,
      unitId: b.unit_id,
      checkedInAt: checkedOut.actual_check_in ?? (b.status === 'checked_in' || b.status === 'checked_out' ? b.arrival_at : null),
      checkedOutAt: checkedOut.actual_check_out ?? (b.status === 'checked_out' ? b.departure_at : null),
      hasActiveAccess: access.rows[0].active,
      hasAccessDevice: access.rows[0].device,
      record: rec
        ? {
            guestsSubmittedAt: rec.guests_submitted_at,
            documentsSubmittedAt: rec.documents_submitted_at,
            rulesAcceptedAt: rec.rules_accepted_at,
            consentAt: rec.consent_at,
            adminApprovalRequired: rec.admin_approval_required,
            adminApprovedAt: rec.admin_approved_at,
            completedAt: rec.completed_at,
            unitReadyAt: rec.unit_ready_at,
          }
        : null,
    };
  }

  /** Отмечает регистрацию завершённой, когда выполнены все условия (в том числе оплата). */
  async refresh(trx: Database, b: GuestBookingRow): Promise<StayFacts> {
    const f = await this.facts(b, trx);
    if (f.record && !f.record.completedAt && f.bookingState === 'active' && registrationCanComplete(f)) {
      await trx.updateTable('checkin_record').set({ completed_at: f.now }).where('booking_id', '=', b.id).where('completed_at', 'is', null).execute();
      return { ...f, record: { ...f.record, completedAt: f.now } };
    }
    return f;
  }

  view(b: GuestBookingRow, f: StayFacts) {
    const status = computeCheckinStatus(f);
    return {
      id: b.id,
      number: b.number,
      status: b.status,
      checkinStatus: status,
      checkinStatusLabel: CHECKIN_STATUS_LABELS[status],
      arrivalAt: b.arrival_at,
      departureAt: b.departure_at,
      adults: b.adults,
      children: b.children_ages.length,
      totalAmount: b.total_minor,
      paidAmount: b.paid_minor,
      balanceDue: f.balanceDue,
      currency: b.currency,
      // «Стандарт 2»: название категории не повторяем, если оно уже есть в названии номера
      unit: b.unit_id ? { id: b.unit_id, code: b.unit_name ?? '', name: b.unit_name?.startsWith(b.type_name) ? '' : b.type_name } : null,
      property: { id: b.property_id, name: b.property_name, phone: guestInfo.phones[0] ?? null },
      checkedInAt: f.checkedInAt,
      checkedOutAt: f.checkedOutAt,
    };
  }
}
