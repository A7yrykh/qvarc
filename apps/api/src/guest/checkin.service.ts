import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import { addDays } from '../../../../packages/domain/src';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import type { StaffUser } from '../iam/auth.decorators';
import { PD_CONSENT_VERSION } from '../public/public.service';
import { ACCESS_BLOCKER_LABELS, accessBlockers, CHECKIN_STATUS_LABELS, computeCheckinStatus, type StayFacts } from './checkin-status';
import { RULES_VERSION } from './content';
import { decrypt, deriveKey, encrypt } from './guest-crypto';
import type { GuestPrincipal } from './guest.guard';
import { GuestStayService, settingsOf, type GuestBookingRow } from './stay.service';

export interface CheckinGuestInput {
  firstName: string;
  lastName: string;
  middleName?: string;
  birthDate?: string;
  isChild: boolean;
}

export interface DocumentInput {
  bookingGuestId: string;
  docType: 'ru_passport' | 'foreign_passport' | 'birth_certificate';
  number: string;
  [field: string]: unknown;
}

/** Гости, добавленные через приложение, помечаются, чтобы их можно было убрать при изменении состава */
const APP_TAG = 'guest_app';
const conflict = (code: string, message: string, extra?: object) => new ConflictException({ message, code, ...extra });

/**
 * Онлайн-регистрация из приложения гостя: состав гостей, паспортные данные, правила и согласие.
 * Паспортные данные шифруются AES-256-GCM. Гость видит только «•••• 1234», сотрудник — с правом
 * guest.documents.read, каждый просмотр пишется в журнал. Данные удаляются после срока хранения.
 */
@Injectable()
export class CheckinService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly stay: GuestStayService,
    private readonly audit: AuditService,
  ) {}

  private docKey() {
    if (!this.config.guest.dataKey) throw new ServiceUnavailableException({ message: 'Шифрование данных не настроено', code: 'not_configured' });
    return deriveKey(this.config.guest.dataKey, 'documents');
  }

  private ensureOpen(f: StayFacts) {
    if (f.bookingState === 'cancelled') throw conflict('booking_cancelled', 'Бронирование отменено');
    if (f.bookingState === 'pending') throw conflict('booking_not_confirmed', 'Бронирование ещё не подтверждено');
    if (f.bookingState === 'finished' || f.checkedOutAt || f.now >= f.departureAt) throw conflict('stay_finished', 'Проживание уже завершено');
    if (f.now < f.registrationOpensAt) {
      throw conflict('registration_not_open', 'Регистрация откроется ближе к дате заезда', { opensAt: f.registrationOpensAt });
    }
    if (f.record?.completedAt) {
      throw conflict('registration_completed', 'Регистрация уже завершена. Чтобы изменить данные, свяжитесь с администратором.');
    }
  }

  private ensureRecord(trx: Database, bookingId: string) {
    return trx.insertInto('checkin_record').values({ booking_id: bookingId }).onConflict((oc) => oc.column('booking_id').doNothing()).execute();
  }

  private async guests(trx: Database, bookingId: string) {
    return trx
      .selectFrom('booking_guest as bg')
      .innerJoin('guest as g', 'g.id', 'bg.guest_id')
      .leftJoin('guest_document as d', (j) => j.onRef('d.guest_id', '=', 'g.id').onRef('d.booking_id', '=', 'bg.booking_id'))
      .select(['g.id', 'g.first_name', 'g.last_name', 'g.middle_name', 'g.birth_date', 'bg.is_child', 'bg.is_primary', 'd.doc_type', 'd.number_last4'])
      .where('bg.booking_id', '=', bookingId)
      .orderBy('bg.is_primary', 'desc')
      .orderBy('bg.position')
      .execute();
  }

  private async state(trx: Database, b: GuestBookingRow, f: StayFacts) {
    const r = f.record;
    const status = computeCheckinStatus(f);
    const guests = await this.guests(trx, b.id);
    return {
      bookingId: b.id,
      status,
      statusLabel: CHECKIN_STATUS_LABELS[status],
      registrationOpensAt: f.registrationOpensAt,
      rulesVersion: RULES_VERSION,
      expectedGuests: { adults: b.adults, children: b.children_ages.length },
      balanceDue: f.balanceDue,
      steps: {
        guests: !!r?.guestsSubmittedAt,
        documents: f.documentsRequired ? !!r?.documentsSubmittedAt : null,
        rules: !!r?.rulesAcceptedAt,
        consent: !!r?.consentAt,
        adminApproval: r?.adminApprovalRequired ? !!r.adminApprovedAt : null,
        payment: f.balanceDue <= 0,
        unitReady: !!r?.unitReadyAt,
      },
      guests: guests.map((g) => ({
        id: g.id,
        firstName: g.first_name,
        lastName: g.last_name,
        middleName: g.middle_name,
        birthDate: g.birth_date,
        isChild: g.is_child,
        isPrimary: g.is_primary,
        document: g.doc_type ? { docType: g.doc_type, numberMasked: `•••• ${g.number_last4 ?? ''}` } : null,
      })),
      accessBlockers: accessBlockers(f).map((code) => ({ code, message: ACCESS_BLOCKER_LABELS[code] })),
    };
  }

  /** Изменение регистрации: бронь блокируется на время транзакции, статус пересчитывается в конце. */
  private change(g: GuestPrincipal, bookingId: string, fn: (trx: Database, b: GuestBookingRow, f: StayFacts) => Promise<void>) {
    return this.db.transaction().execute(async (trx) => {
      const b = await this.stay.getOwn(g, bookingId, trx, true);
      const f = await this.stay.facts(b, trx);
      this.ensureOpen(f);
      await this.ensureRecord(trx, b.id);
      await fn(trx, b, f);
      return this.state(trx, b, await this.stay.refresh(trx, b));
    });
  }

  async get(g: GuestPrincipal, bookingId: string) {
    return this.db.transaction().execute(async (trx) => {
      const b = await this.stay.getOwn(g, bookingId, trx);
      return this.state(trx, b, await this.stay.refresh(trx, b));
    });
  }

  start(g: GuestPrincipal, bookingId: string) {
    return this.change(g, bookingId, async () => undefined);
  }

  submitGuests(g: GuestPrincipal, bookingId: string, input: CheckinGuestInput[]) {
    return this.change(g, bookingId, async (trx, b) => {
      if (!input.some((x) => !x.isChild)) throw new UnprocessableEntityException({ message: 'Укажите хотя бы одного взрослого гостя', code: 'adult_required' });
      if (input.length > b.max_occupancy) {
        throw new UnprocessableEntityException({ message: `В этом номере можно разместить не больше ${b.max_occupancy} гостей`, code: 'over_capacity' });
      }
      // Гостей больше, чем в брони: нужна проверка администратора (может понадобиться доплата)
      const needsApproval = input.length > b.adults + b.children_ages.length;
      const current = await trx.selectFrom('booking_guest').selectAll().where('booking_id', '=', b.id).orderBy('position').execute();
      const primary = current.find((x) => x.is_primary);
      if (!primary) throw new ConflictException({ message: 'У брони нет основного гостя', code: 'no_primary_guest' });
      const companions = current.filter((x) => !x.is_primary);

      // Состав меняется: введённые ранее документы больше не соответствуют гостям
      await trx.deleteFrom('guest_document').where('booking_id', '=', b.id).execute();
      const person = (x: CheckinGuestInput) => ({
        first_name: x.firstName,
        last_name: x.lastName,
        middle_name: x.middleName ?? null,
        birth_date: x.birthDate ?? null,
        updated_at: new Date(),
      });
      const before = await trx.selectFrom('guest').select(['last_name', 'first_name', 'middle_name']).where('id', '=', primary.guest_id).executeTakeFirstOrThrow();
      await trx.updateTable('guest').set(person(input[0])).where('id', '=', primary.guest_id).execute();
      await trx.updateTable('booking_guest').set({ is_child: input[0].isChild, position: 0 }).where('booking_id', '=', b.id).where('guest_id', '=', primary.guest_id).execute();

      for (const [i, x] of input.slice(1).entries()) {
        const existing = companions[i];
        if (existing) {
          await trx.updateTable('guest').set(person(x)).where('id', '=', existing.guest_id).execute();
          await trx.updateTable('booking_guest').set({ is_child: x.isChild, position: i + 1 }).where('booking_id', '=', b.id).where('guest_id', '=', existing.guest_id).execute();
        } else {
          const guest = await trx
            .insertInto('guest')
            .values({ property_id: b.property_id, ...person(x), tags: [APP_TAG] })
            .returning('id')
            .executeTakeFirstOrThrow();
          await trx.insertInto('booking_guest').values({ booking_id: b.id, guest_id: guest.id, stay_id: b.stay_id, is_child: x.isChild, position: i + 1 }).execute();
        }
      }
      for (const extra of companions.slice(input.length - 1)) {
        await trx.deleteFrom('booking_guest').where('booking_id', '=', b.id).where('guest_id', '=', extra.guest_id).execute();
        await this.dropAppGuest(trx, extra.guest_id);
      }

      await trx
        .updateTable('checkin_record')
        .set((eb) => ({
          guests_submitted_at: new Date(),
          documents_submitted_at: null,
          admin_approval_required: needsApproval ? true : eb.ref('admin_approval_required'),
          admin_approval_reason: needsApproval ? 'Гостей больше, чем указано в бронировании' : eb.ref('admin_approval_reason'),
        }))
        .where('booking_id', '=', b.id)
        .execute();
      await this.audit.write(
        {
          propertyId: b.property_id, actorType: 'guest', actorId: g.accountId, action: 'checkin.guests_submitted', entity: 'booking', entityId: b.id,
          before: { primaryName: before }, after: { count: input.length, needsApproval },
        },
        trx,
      );
    });
  }

  /** Убирает гостя, добавленного через приложение, если на него больше ничего не ссылается. */
  private async dropAppGuest(trx: Database, guestId: string) {
    await sql`SAVEPOINT drop_guest`.execute(trx);
    try {
      await trx.deleteFrom('guest').where('id', '=', guestId).where(sql<boolean>`${APP_TAG} = ANY(tags)`).execute();
      await sql`RELEASE SAVEPOINT drop_guest`.execute(trx);
    } catch {
      await sql`ROLLBACK TO SAVEPOINT drop_guest`.execute(trx);
    }
  }

  /** Паспортные данные всех гостей брони. Повторная отправка заменяет документы целиком. */
  submitDocuments(g: GuestPrincipal, bookingId: string, docs: DocumentInput[]) {
    const key = this.docKey();
    return this.change(g, bookingId, async (trx, b, f) => {
      if (!f.record?.guestsSubmittedAt) throw conflict('guests_required', 'Сначала укажите состав гостей');
      const ids = new Set((await trx.selectFrom('booking_guest').select('guest_id').where('booking_id', '=', b.id).execute()).map((x) => x.guest_id));
      const given = new Set(docs.map((d) => d.bookingGuestId));
      if (docs.some((d) => !ids.has(d.bookingGuestId)) || given.size !== docs.length) {
        throw new UnprocessableEntityException({ message: 'Документ указан для гостя не из этой брони', code: 'unknown_guest' });
      }
      if (given.size !== ids.size) throw new UnprocessableEntityException({ message: 'Укажите документ для каждого гостя', code: 'documents_incomplete' });
      const retainUntil = addDays(b.departure, settingsOf(b).documentsRetentionDays ?? 30);
      await trx.deleteFrom('guest_document').where('booking_id', '=', b.id).execute();
      await trx
        .insertInto('guest_document')
        .values(
          docs.map(({ bookingGuestId, docType, ...payload }) => ({
            guest_id: bookingGuestId,
            booking_id: b.id,
            doc_type: docType,
            payload_enc: encrypt(key, JSON.stringify(payload)),
            number_last4: String(payload.number).replace(/\s/g, '').slice(-4),
            retain_until: retainUntil,
          })),
        )
        .execute();
      await trx.updateTable('checkin_record').set({ documents_submitted_at: new Date() }).where('booking_id', '=', b.id).execute();
      // В журнал попадает только факт и количество, без самих данных
      await this.audit.write(
        { propertyId: b.property_id, actorType: 'guest', actorId: g.accountId, action: 'checkin.documents_submitted', entity: 'booking', entityId: b.id, after: { count: docs.length } },
        trx,
      );
    });
  }

  acceptRules(g: GuestPrincipal, bookingId: string, rulesVersion: string, ip: string | null) {
    if (rulesVersion !== RULES_VERSION) throw conflict('rules_outdated', 'Правила обновились. Пожалуйста, ознакомьтесь с новой версией.');
    return this.change(g, bookingId, async (trx, b) => {
      const now = new Date();
      await trx.updateTable('checkin_record').set({ rules_accepted_at: now, rules_version: rulesVersion, consent_at: now }).where('booking_id', '=', b.id).execute();
      const booker = await trx.selectFrom('booking').select('booker_guest_id').where('id', '=', b.id).executeTakeFirstOrThrow();
      await trx
        .insertInto('guest_consent')
        .values([
          { guest_id: booker.booker_guest_id, kind: 'stay_rules', text_version: `rules-${rulesVersion}`, granted_at: now, source: 'guest_app', ip },
          { guest_id: booker.booker_guest_id, kind: 'pd_processing', text_version: PD_CONSENT_VERSION, granted_at: now, source: 'guest_app', ip },
        ])
        .execute();
      await this.audit.write(
        { propertyId: b.property_id, actorType: 'guest', actorId: g.accountId, action: 'checkin.rules_accepted', entity: 'booking', entityId: b.id, after: { rulesVersion }, ip },
        trx,
      );
    });
  }

  // ── Сотрудники ──

  private staffBooking(user: StaffUser, bookingId: string, trx: Database) {
    return this.stay.getForStaff(user.propertyId, bookingId, trx, true);
  }

  async staffView(user: StaffUser, bookingId: string) {
    return this.db.transaction().execute(async (trx) => {
      const b = await this.staffBooking(user, bookingId, trx);
      const f = await this.stay.refresh(trx, b);
      const rec = await trx.selectFrom('checkin_record').selectAll().where('booking_id', '=', b.id).executeTakeFirst();
      return { ...(await this.state(trx, b, f)), adminApprovalReason: rec?.admin_approval_reason ?? null, completedAt: rec?.completed_at ?? null };
    });
  }

  /** Расшифрованные документы для сотрудника. Каждый просмотр фиксируется в журнале. */
  async staffDocuments(user: StaffUser, bookingId: string, ip: string | null) {
    const key = this.docKey();
    const b = await this.db.selectFrom('booking').select('id').where('id', '=', bookingId).where('property_id', '=', user.propertyId).executeTakeFirst();
    if (!b) throw new NotFoundException('Бронь не найдена');
    const rows = await this.db
      .selectFrom('guest_document as d')
      .innerJoin('guest as g', 'g.id', 'd.guest_id')
      .leftJoin('booking_guest as bg', (j) => j.onRef('bg.guest_id', '=', 'd.guest_id').onRef('bg.booking_id', '=', 'd.booking_id'))
      .select(['d.guest_id', 'g.last_name', 'g.first_name', 'g.middle_name', 'g.birth_date', 'd.doc_type', 'd.payload_enc', 'd.retain_until'])
      .where('d.booking_id', '=', bookingId)
      .orderBy('bg.is_primary', 'desc')
      .orderBy('bg.position')
      .execute();
    await this.audit.write({ propertyId: user.propertyId, actorId: user.id, action: 'guest.documents.view', entity: 'booking', entityId: bookingId, after: { count: rows.length }, ip });
    return rows.map((r) => ({
      guestId: r.guest_id,
      fullName: [r.last_name, r.first_name, r.middle_name].filter(Boolean).join(' '),
      birthDate: r.birth_date,
      docType: r.doc_type,
      retainUntil: r.retain_until,
      ...JSON.parse(decrypt(key, r.payload_enc)),
    }));
  }

  private async staffChange(user: StaffUser, bookingId: string, action: string, set: (now: Date) => Record<string, unknown>) {
    await this.db.transaction().execute(async (trx) => {
      const b = await this.staffBooking(user, bookingId, trx);
      await this.ensureRecord(trx, b.id);
      await trx.updateTable('checkin_record').set(set(new Date())).where('booking_id', '=', b.id).execute();
      await this.audit.write({ propertyId: user.propertyId, actorId: user.id, action, entity: 'booking', entityId: b.id }, trx);
    });
    return this.staffView(user, bookingId);
  }

  approve(user: StaffUser, bookingId: string) {
    return this.staffChange(user, bookingId, 'checkin.approved', (now) => ({ admin_approved_at: now, admin_approved_by: user.id }));
  }

  unitReady(user: StaffUser, bookingId: string) {
    return this.staffChange(user, bookingId, 'checkin.unit_ready', (now) => ({ unit_ready_at: now, unit_ready_by: user.id }));
  }

  /** Удаляет паспортные данные с истёкшим сроком хранения (фоновая задача). */
  async purgeExpiredDocuments() {
    const rows = await sql<{ property_id: string; n: number }>`
      WITH gone AS (DELETE FROM guest_document WHERE retain_until < current_date AND booking_id IS NOT NULL RETURNING booking_id)
      SELECT b.property_id, count(*)::int AS n FROM gone JOIN booking b ON b.id = gone.booking_id GROUP BY b.property_id`.execute(this.db);
    for (const r of rows.rows) {
      await this.audit.write({ propertyId: r.property_id, actorType: 'system', actorId: null, action: 'guest.documents.purged', entity: 'guest_document', after: { count: r.n } });
    }
    return { purged: rows.rows.reduce((s, r) => s + r.n, 0) };
  }
}
