import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../../../packages/db/src';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import { PaymentsService } from '../payments/payments.service';
import type { GuestAccount } from './guest-auth.service';

/** Сведения для приложения, которые не хранятся в отдельных таблицах: property.settings.guestApp */
export interface GuestAppInfo {
  address?: string;
  about?: string;
  phones?: string[];
  email?: string;
  facilities?: string[];
  faq?: { q: string; a: string }[];
}

const CHECKIN_LABELS: Record<string, string> = {
  registration_not_started: 'Регистрация не начата',
  checked_in: 'Вы заселены',
  checked_out: 'Выезд оформлен',
  cancelled: 'Бронь отменена',
};

const PAYMENT_STATUS: Record<string, string> = { created: 'pending', pending: 'pending', authorized: 'pending', succeeded: 'succeeded', failed: 'failed', cancelled: 'canceled' };

/** Гостевое приложение: объект, документы, брони гостя по телефону, оплата остатка. */
@Injectable()
export class GuestAppService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentsService,
  ) {}

  async propertyByCode(code: string) {
    const p = await this.db.selectFrom('property').select(['id', 'name', 'settings', 'check_in_time', 'check_out_time']).where('code', '=', code).executeTakeFirst();
    if (!p) throw new NotFoundException('Объект не найден');
    return p;
  }

  /** Фото категорий хранятся путями модуля бронирования (/rooms/...), приложению нужен полный адрес. */
  private absolute(url: string) {
    return url.startsWith('/') ? `${this.config.bookingSiteUrl}${url}` : url;
  }

  async property(code: string) {
    const p = await this.propertyByCode(code);
    const info = ((p.settings as Record<string, unknown>)?.guestApp ?? {}) as GuestAppInfo;
    const types = await this.db
      .selectFrom('accommodation_type')
      .select(['id', 'code', 'name', 'description', 'max_occupancy', 'amenities', 'photos'])
      .where('property_id', '=', p.id)
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .orderBy('name')
      .execute();
    return {
      name: p.name,
      address: info.address ?? null,
      about: info.about ?? null,
      phones: info.phones ?? [],
      email: info.email ?? null,
      bookingUrl: this.config.bookingSiteUrl,
      checkInTime: p.check_in_time.slice(0, 5),
      checkOutTime: p.check_out_time.slice(0, 5),
      facilities: info.facilities ?? [],
      faq: info.faq ?? [],
      unitTypes: types.map((t) => {
        const photos = (t.photos as unknown as { url: string; alt?: string }[] | null) ?? [];
        return {
          id: t.id,
          code: t.code,
          name: t.name,
          summary: t.description,
          capacity: t.max_occupancy,
          bedrooms: null,
          amenities: (t.amenities as unknown as string[] | null) ?? [],
          photos: photos.map((ph, i) => ({ file: ph.url.split('/').pop() ?? `${t.code}-${i + 1}`, caption: ph.alt || `${t.name} — фото ${i + 1}`, url: this.absolute(ph.url) })),
          externalId: null,
        };
      }),
    };
  }

  async document(propertyCode: string, docCode: string) {
    const p = await this.propertyByCode(propertyCode);
    const d = await this.db.selectFrom('legal_document').selectAll().where('property_id', '=', p.id).where('code', '=', docCode).executeTakeFirst();
    if (!d) throw new NotFoundException('Документ не найден');
    return { code: d.code, title: d.title, version: d.version, issuer: d.issuer, sections: d.sections };
  }

  /** Брони, где гость с этим телефоном — заказчик или проживающий. Прошедшие показываются 30 дней после выезда. */
  private bookingsQuery(guest: GuestAccount) {
    return this.db
      .selectFrom('booking as b')
      .innerJoin('property as p', 'p.id', 'b.property_id')
      .innerJoin('booking_stay as s', 's.booking_id', 'b.id')
      .leftJoin('accommodation_unit as u', 'u.id', 's.unit_id')
      .select([
        'b.id', 'b.number', 'b.status', 'b.adults', 'b.children_ages', 'b.total_minor', 'b.prepayment_due_minor', 'b.hold_expires_at', 'b.arrival', 'b.departure',
        'p.id as property_id', 'p.name as property_name', 'p.settings', 'u.id as unit_id', 'u.name as unit_name', 's.actual_check_in', 's.actual_check_out',
        sql<Date>`((b.arrival + p.check_in_time) AT TIME ZONE p.timezone)`.as('arrival_at'),
        sql<Date>`((b.departure + p.check_out_time) AT TIME ZONE p.timezone)`.as('departure_at'),
      ])
      .where('b.property_id', '=', guest.propertyId)
      .where('b.status', 'not in', ['draft', 'expired'])
      .where((eb) =>
        eb.or([
          eb.exists(eb.selectFrom('guest as g').select('g.id').whereRef('g.id', '=', 'b.booker_guest_id').where('g.email', '=', guest.email)),
          eb.exists(
            eb.selectFrom('booking_guest as bg').innerJoin('guest as g2', 'g2.id', 'bg.guest_id').select('g2.id').whereRef('bg.booking_id', '=', 'b.id').where('g2.email', '=', guest.email),
          ),
        ]),
      )
      .where(sql<boolean>`b.departure >= (now() AT TIME ZONE p.timezone)::date - 30`);
  }

  private async toBooking(b: Awaited<ReturnType<ReturnType<GuestAppService['bookingsQuery']>['executeTakeFirstOrThrow']>>) {
    const paid = await this.payments.paidMinor(this.db, b.id);
    const checkin = b.status === 'cancelled' || b.status === 'no_show' ? 'cancelled' : b.status === 'checked_out' ? 'checked_out' : b.status === 'checked_in' ? 'checked_in' : 'registration_not_started';
    const phones = (((b.settings as Record<string, unknown>)?.guestApp ?? {}) as GuestAppInfo).phones ?? [];
    return {
      id: b.id,
      number: b.number,
      status: b.status,
      checkinStatus: checkin,
      checkinStatusLabel: CHECKIN_LABELS[checkin],
      arrivalAt: new Date(b.arrival_at).toISOString(),
      departureAt: new Date(b.departure_at).toISOString(),
      adults: b.adults,
      children: b.children_ages.length,
      totalAmount: b.total_minor,
      paidAmount: paid,
      balanceDue: ['cancelled', 'no_show'].includes(b.status) ? 0 : Math.max(0, b.total_minor - paid),
      currency: 'RUB',
      unit: b.unit_id ? { id: b.unit_id, code: b.unit_name!, name: '' } : null,
      property: { id: b.property_id, name: b.property_name, phone: phones[0] ?? null },
      checkedInAt: b.actual_check_in ? new Date(b.actual_check_in).toISOString() : null,
      checkedOutAt: b.actual_check_out ? new Date(b.actual_check_out).toISOString() : null,
    };
  }

  async myBookings(guest: GuestAccount) {
    const rows = await this.bookingsQuery(guest).orderBy('b.arrival', 'desc').execute();
    // Незавершённые оплаты сверяем с банком, чтобы гость сразу видел актуальный статус
    const pending = rows.length
      ? await this.db.selectFrom('payment').select('id').where('booking_id', 'in', rows.map((r) => r.id)).where('status', '=', 'pending').execute()
      : [];
    for (const p of pending) await this.payments.syncPayment(p.id).catch(() => undefined);
    const fresh = pending.length ? await this.bookingsQuery(guest).orderBy('b.arrival', 'desc').execute() : rows;
    return Promise.all(fresh.map((b) => this.toBooking(b)));
  }

  private async ownBooking(guest: GuestAccount, bookingId: string) {
    const b = await this.bookingsQuery(guest).where('b.id', '=', bookingId).executeTakeFirst();
    if (!b) throw new NotFoundException('Бронь не найдена');
    return b;
  }

  /** Оплата из приложения. Пока только проживание: предоплата неоплаченной брони или остаток. */
  async createPayment(guest: GuestAccount, input: { purpose: string; targetId: string }, idempotencyKey: string) {
    if (input.purpose !== 'booking') throw new UnprocessableEntityException({ message: 'Оплата услуг в приложении пока не подключена', code: 'not_available' });
    const b = await this.ownBooking(guest, input.targetId);
    const paid = await this.payments.paidMinor(this.db, b.id);
    const isPrepayment = b.status === 'pending_payment';
    if (isPrepayment && (!b.hold_expires_at || new Date(b.hold_expires_at) < new Date())) throw new ConflictException('Время на оплату брони истекло');
    const amount = isPrepayment ? Math.max(0, b.prepayment_due_minor - paid) : Math.max(0, b.total_minor - paid);
    if (amount <= 0) throw new ConflictException({ message: 'По брони нечего оплачивать', code: 'nothing_to_pay' });
    const r = await this.payments.startBookingPayment({
      bookingId: b.id,
      amountMinor: amount,
      purpose: isPrepayment ? 'prepayment' : 'balance',
      idempotencyKey: `app:${guest.accountId}:${idempotencyKey}`,
      returnUrl: `${this.config.apiPublicUrl}/guest/v1/payment-return`,
    });
    return this.payment(guest, r.paymentId);
  }

  async payment(guest: GuestAccount, paymentId: string) {
    const ref = await this.db
      .selectFrom('payment')
      .select(['id', 'booking_id', 'status'])
      .where('id', '=', paymentId)
      .where('property_id', '=', guest.propertyId)
      .executeTakeFirst();
    if (!ref?.booking_id) throw new NotFoundException('Платёж не найден');
    await this.ownBooking(guest, ref.booking_id);
    if (ref.status === 'pending') await this.payments.syncPayment(ref.id).catch(() => undefined);
    const p = await this.db
      .selectFrom('payment as p')
      .select((eb) => [
        'p.id', 'p.status', 'p.amount_minor', 'p.confirmation_url', 'p.provider', 'p.paid_at',
        eb.selectFrom('refund as r').select(sql<number>`coalesce(sum(r.amount_minor), 0)::bigint`.as('x')).whereRef('r.payment_id', '=', 'p.id').where('r.status', '=', 'succeeded').as('refunded'),
      ])
      .where('p.id', '=', ref.id)
      .executeTakeFirstOrThrow();
    const refunded = Number(p.refunded ?? 0);
    let status = PAYMENT_STATUS[p.status] ?? p.status;
    if (status === 'succeeded' && refunded > 0) status = refunded >= p.amount_minor ? 'refunded' : 'partially_refunded';
    return {
      id: p.id,
      purpose: 'booking',
      amount: p.amount_minor,
      refundedAmount: refunded,
      status,
      confirmationUrl: status === 'pending' ? p.confirmation_url : null,
      demo: p.provider === 'sandbox',
      paidAt: p.paid_at ? new Date(p.paid_at).toISOString() : null,
    };
  }
}
