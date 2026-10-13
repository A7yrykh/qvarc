import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { addDays } from '../../../../packages/domain/src';
import { setActor, type Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import { PaymentsService } from '../payments/payments.service';
import { PD_CONSENT_VERSION } from '../public/public.service';
import type { GuestAccount } from './guest-auth.service';

const name = z.string().trim().min(1).max(100);
export const GuestsBody = z.object({
  guests: z
    .array(z.object({ firstName: name, lastName: name, middleName: z.string().trim().max(100).optional(), isChild: z.boolean().default(false) }))
    .min(1)
    .max(12),
});

const opt = (max: number) => z.string().trim().max(max).optional();
const DocumentInput = z.object({
  bookingGuestId: z.uuid(),
  docType: z.enum(['ru_passport', 'foreign_passport', 'birth_certificate']),
  series: opt(20),
  number: z.string().trim().min(1).max(30),
  issuedBy: opt(300),
  issueDate: z.iso.date().optional(),
  divisionCode: opt(10),
  birthPlace: opt(300),
  registrationAddress: opt(500),
  citizenship: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
});
type DocumentInput = z.infer<typeof DocumentInput>;
export const DocumentsBody = z.object({ documents: z.array(DocumentInput).min(1).max(12) });
export const RulesBody = z.object({ rulesVersion: z.string().min(1).max(40), rulesAccepted: z.literal(true), personalDataConsent: z.literal(true) });

/** Те же правила, что проверяет приложение перед отправкой. Текст ошибки показывается гостю. */
function documentProblem(d: DocumentInput): string | null {
  const digits = (s = '') => s.replace(/\D/g, '');
  switch (d.docType) {
    case 'ru_passport':
      if (!/^\d{4}$/.test(d.series ?? '')) return 'Серия паспорта: 4 цифры';
      if (!/^\d{6}$/.test(d.number)) return 'Номер паспорта: 6 цифр';
      if ((d.issuedBy ?? '').length < 3) return 'Укажите, кем выдан паспорт';
      if (!d.issueDate) return 'Укажите дату выдачи';
      if (!/^\d{3}-\d{3}$/.test(d.divisionCode ?? '')) return 'Код подразделения: 000-000';
      if ((d.birthPlace ?? '').length < 2) return 'Укажите место рождения';
      if ((d.registrationAddress ?? '').length < 5) return 'Укажите адрес регистрации';
      return null;
    case 'foreign_passport':
      if (d.number.length < 4) return 'Номер паспорта: не меньше 4 символов';
      if (!d.citizenship) return 'Гражданство: код страны из двух латинских букв, например KZ';
      return null;
    case 'birth_certificate':
      if ((d.series ?? '').length < 2) return 'Укажите серию свидетельства';
      if (digits(d.number).length !== 6 || d.number.length !== 6) return 'Номер свидетельства: 6 цифр';
      return null;
  }
}

const DOC_TYPE: Record<DocumentInput['docType'], string> = { ru_passport: 'passport_rf', foreign_passport: 'foreign_passport', birth_certificate: 'birth_certificate' };
const DOC_TYPE_BACK: Record<string, string> = { passport_rf: 'ru_passport', foreign_passport: 'foreign_passport', birth_certificate: 'birth_certificate' };

const STATUS_LABEL: Record<string, string> = {
  registration_not_started: 'Регистрация не начата',
  registration_in_progress: 'Регистрация в процессе',
  registration_complete: 'Регистрация завершена',
  checked_in: 'Вы заселены',
  checked_out: 'Выезд оформлен',
  cancelled: 'Бронь отменена',
};

/** Срок хранения документов: год после выезда, затем удаляются (настройка по согласованию с владельцем). */
const DOCUMENT_RETENTION_DAYS = 365;

/** Онлайн-регистрация гостя в приложении: состав гостей, документы (зашифрованы), правила и согласие. */
@Injectable()
export class CheckinService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  /** Бронь гостя: он заказчик или проживающий с тем же телефоном. Отменённые и прошедшие изменить нельзя. */
  private async booking(guest: GuestAccount, bookingId: string, trx: Database = this.db) {
    const b = await trx
      .selectFrom('booking as b')
      .select(['b.id', 'b.status', 'b.adults', 'b.children_ages', 'b.total_minor', 'b.booker_guest_id', 'b.departure', 'b.property_id'])
      .where('b.id', '=', bookingId)
      .where('b.property_id', '=', guest.propertyId)
      .where('b.status', 'not in', ['draft', 'expired'])
      .where((eb) =>
        eb.or([
          eb.exists(eb.selectFrom('guest as g').select('g.id').whereRef('g.id', '=', 'b.booker_guest_id').where('g.email', '=', guest.email)),
          eb.exists(eb.selectFrom('booking_guest as bg').innerJoin('guest as g2', 'g2.id', 'bg.guest_id').select('g2.id').whereRef('bg.booking_id', '=', 'b.id').where('g2.email', '=', guest.email)),
        ]),
      )
      .executeTakeFirst();
    if (!b) throw new NotFoundException('Бронь не найдена');
    return b;
  }

  private editable(status: string) {
    if (!['pending_payment', 'confirmed', 'pending_confirmation'].includes(status)) throw new ConflictException('Регистрацию по этой брони изменить уже нельзя');
  }

  private async rulesVersion(propertyId: string) {
    const d = await this.db.selectFrom('legal_document').select('version').where('property_id', '=', propertyId).where('code', '=', 'rules').executeTakeFirst();
    return d?.version ?? null;
  }

  /** Гости брони с последним документом каждого. Используется и в приложении, и в карточке брони. */
  async guestsOf(bookingId: string, trx: Database = this.db) {
    const rows = await trx
      .selectFrom('booking_guest as bg')
      .innerJoin('guest as g', 'g.id', 'bg.guest_id')
      .select((eb) => [
        'g.id', 'g.first_name', 'g.last_name', 'g.middle_name', 'g.birth_date', 'bg.is_child', 'bg.is_primary',
        eb.selectFrom('guest_document as d').select('d.doc_type').whereRef('d.guest_id', '=', 'g.id').orderBy('d.created_at', 'desc').limit(1).as('doc_type'),
        eb.selectFrom('guest_document as d').select('d.number_masked').whereRef('d.guest_id', '=', 'g.id').orderBy('d.created_at', 'desc').limit(1).as('number_masked'),
      ])
      .where('bg.booking_id', '=', bookingId)
      .orderBy('bg.is_primary', 'desc')
      .orderBy('bg.sort_order')
      .execute();
    return rows.map((g) => ({
      id: g.id,
      firstName: g.first_name,
      lastName: g.last_name,
      middleName: g.middle_name,
      birthDate: g.birth_date,
      isChild: g.is_child,
      isPrimary: g.is_primary,
      document: g.doc_type ? { docType: DOC_TYPE_BACK[g.doc_type] ?? g.doc_type, numberMasked: g.number_masked ?? '••••' } : null,
    }));
  }

  async state(guest: GuestAccount, bookingId: string) {
    const b = await this.booking(guest, bookingId);
    const c = await this.db.selectFrom('booking_checkin').selectAll().where('booking_id', '=', b.id).executeTakeFirst();
    const guests = await this.guestsOf(b.id);
    const rulesVersion = await this.rulesVersion(b.property_id);
    const paid = await this.payments.paidMinor(this.db, b.id);
    const balanceDue = Math.max(0, b.total_minor - paid);
    const steps = {
      guests: !!c?.guests_submitted_at,
      documents: !!c?.guests_submitted_at && guests.length > 0 && guests.every((g) => g.document),
      rules: !!c?.rules_accepted_at && c.rules_version === rulesVersion,
      consent: !!c?.pd_consent_at,
      adminApproval: null,
      payment: balanceDue === 0,
      // Готовность номера отмечает администратор; появится вместе с доступом в номер
      unitReady: false,
    };
    const registered = steps.guests && steps.documents && steps.rules && steps.consent;
    const status =
      b.status === 'cancelled' || b.status === 'no_show' ? 'cancelled'
      : b.status === 'checked_in' ? 'checked_in'
      : b.status === 'checked_out' ? 'checked_out'
      : registered ? 'registration_complete'
      : c ? 'registration_in_progress'
      : 'registration_not_started';
    const blockers = [
      ...(registered ? [] : [{ code: 'registration_incomplete', message: 'Завершите онлайн-регистрацию' }]),
      ...(balanceDue > 0 ? [{ code: 'payment_required', message: 'Оплатите остаток стоимости проживания' }] : []),
      { code: 'unit_not_ready', message: 'Номер готовится к заселению' },
    ];
    return {
      bookingId: b.id,
      status,
      statusLabel: STATUS_LABEL[status],
      registrationOpensAt: null,
      rulesVersion: rulesVersion ?? '',
      expectedGuests: { adults: b.adults, children: b.children_ages.length },
      balanceDue,
      steps,
      guests,
      accessBlockers: blockers,
    };
  }

  /** Состав гостей. Первый — заказчик брони (его карточка обновляется), остальные заменяют прежний список. */
  async submitGuests(guest: GuestAccount, bookingId: string, input: z.infer<typeof GuestsBody>, ip: string | null) {
    await this.db.transaction().execute(async (trx) => {
      await setActor(trx, null, 'guest', 'Онлайн-регистрация');
      const b = await this.booking(guest, bookingId, trx);
      this.editable(b.status);
      const adults = input.guests.filter((g) => !g.isChild).length;
      if (adults < 1) throw new ConflictException('Укажите хотя бы одного взрослого');
      if (input.guests.length > b.adults + b.children_ages.length) {
        throw new ConflictException(`По брони гостей ${b.adults + b.children_ages.length}, указано ${input.guests.length}. Чтобы добавить гостей, позвоните администратору.`);
      }
      const [first, ...rest] = input.guests;
      await trx
        .updateTable('guest')
        .set({ first_name: first.firstName, last_name: first.lastName, middle_name: first.middleName || null, updated_at: new Date() })
        .where('id', '=', b.booker_guest_id)
        .execute();
      await trx.updateTable('booking_guest').set({ is_child: first.isChild, sort_order: 0 }).where('booking_id', '=', b.id).where('guest_id', '=', b.booker_guest_id).execute();
      await trx.deleteFrom('booking_guest').where('booking_id', '=', b.id).where('guest_id', '!=', b.booker_guest_id).execute();
      const stay = await trx.selectFrom('booking_stay').select('id').where('booking_id', '=', b.id).executeTakeFirst();
      for (const [i, g] of rest.entries()) {
        const row = await trx
          .insertInto('guest')
          .values({ property_id: b.property_id, first_name: g.firstName, last_name: g.lastName, middle_name: g.middleName || null })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx.insertInto('booking_guest').values({ booking_id: b.id, guest_id: row.id, stay_id: stay?.id ?? null, is_primary: false, is_child: g.isChild, sort_order: i + 1 }).execute();
      }
      await trx
        .insertInto('booking_checkin')
        .values({ booking_id: b.id, guests_submitted_at: new Date() })
        .onConflict((oc) => oc.column('booking_id').doUpdateSet({ guests_submitted_at: new Date(), updated_at: new Date() }))
        .execute();
      await this.audit.write({ propertyId: b.property_id, actorType: 'guest', actorId: null, action: 'checkin.guests', entity: 'booking', entityId: b.id, after: { count: input.guests.length }, ip }, trx);
    });
    return { ok: true };
  }

  private encrypt(data: object) {
    const key = this.config.documentsKey!;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
    // Формат: версия (1 байт) | iv (12) | тег (16) | шифртекст
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]);
  }

  /** Документы гостей. Хранятся зашифрованными, наружу отдаются только тип и последние цифры номера. */
  async submitDocuments(guest: GuestAccount, bookingId: string, input: z.infer<typeof DocumentsBody>, ip: string | null) {
    if (!this.config.documentsKey) throw new ServiceUnavailableException({ message: 'Приём паспортных данных пока не настроен. Документы проверят при заезде.', code: 'documents_unavailable' });
    for (const d of input.documents) {
      const problem = documentProblem(d);
      if (problem) throw new BadRequestException({ message: problem, code: 'validation_error' });
    }
    await this.db.transaction().execute(async (trx) => {
      await setActor(trx, null, 'guest', 'Онлайн-регистрация');
      const b = await this.booking(guest, bookingId, trx);
      this.editable(b.status);
      const linked = new Set((await trx.selectFrom('booking_guest').select('guest_id').where('booking_id', '=', b.id).execute()).map((r) => r.guest_id));
      const retainUntil = addDays(b.departure, DOCUMENT_RETENTION_DAYS);
      for (const d of input.documents) {
        if (!linked.has(d.bookingGuestId)) throw new NotFoundException('Гость не найден в этой брони');
        const { bookingGuestId, docType, ...fields } = d;
        await trx
          .insertInto('guest_document')
          .values({
            guest_id: bookingGuestId,
            doc_type: DOC_TYPE[docType],
            payload_enc: this.encrypt({ ...fields, citizenship: docType === 'ru_passport' ? 'RU' : fields.citizenship?.toUpperCase() }),
            number_masked: `•••• ${d.number.replace(/\s/g, '').slice(-4)}`,
            retain_until: retainUntil,
          })
          .execute();
      }
      await this.audit.write({ propertyId: b.property_id, actorType: 'guest', actorId: null, action: 'checkin.documents', entity: 'booking', entityId: b.id, after: { count: input.documents.length }, ip }, trx);
    });
    return { ok: true };
  }

  async acceptRules(guest: GuestAccount, bookingId: string, input: z.infer<typeof RulesBody>, ip: string | null) {
    await this.db.transaction().execute(async (trx) => {
      const b = await this.booking(guest, bookingId, trx);
      this.editable(b.status);
      const current = await this.rulesVersion(b.property_id);
      if (!current || current !== input.rulesVersion) throw new ConflictException({ message: 'Правила обновились. Откройте их ещё раз.', code: 'rules_outdated' });
      const now = new Date();
      await trx
        .insertInto('booking_checkin')
        .values({ booking_id: b.id, rules_version: current, rules_accepted_at: now, pd_consent_at: now })
        .onConflict((oc) => oc.column('booking_id').doUpdateSet({ rules_version: current, rules_accepted_at: now, pd_consent_at: now, updated_at: now }))
        .execute();
      await trx.insertInto('guest_consent').values({ guest_id: b.booker_guest_id, kind: 'pd_processing', text_version: PD_CONSENT_VERSION, granted_at: now, source: 'guest_app', ip }).execute();
      await this.audit.write({ propertyId: b.property_id, actorType: 'guest', actorId: null, action: 'checkin.rules', entity: 'booking', entityId: b.id, after: { rulesVersion: current }, ip }, trx);
    });
    return { ok: true };
  }

  /** Для карточки брони в админке. */
  async summary(bookingId: string, trx: Database = this.db) {
    const c = await trx.selectFrom('booking_checkin').selectAll().where('booking_id', '=', bookingId).executeTakeFirst();
    return {
      guestsSubmittedAt: c?.guests_submitted_at ?? null,
      rulesVersion: c?.rules_version ?? null,
      rulesAcceptedAt: c?.rules_accepted_at ?? null,
      guests: await this.guestsOf(bookingId, trx),
    };
  }
}
