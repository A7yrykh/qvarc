// Перенос броней из TravelLine по выгрузке «Отчёт по бронированиям» (xlsx, лист с колонками «№ брони», «Заезд», «Выезд» и т.д.).
// Номер брони TravelLine становится номером брони в QVARC. Повторный запуск пропускает уже перенесённые брони.
// Номер комнаты в выгрузке нет: брони, которые ещё не закончились, раскладываются по свободным номерам своей категории.
// Внесённая предоплата записывается одним платежом «из TravelLine»; вернуть его можно только там, где его принимали.
//   DATABASE_URL=... npx tsx apps/api/src/cli/import-travelline.ts kvarc Report.xlsx
import readXlsxFile from 'read-excel-file/node';
import { sql } from 'kysely';
import { addDays, toDateRange, todayIn } from '../../../../packages/domain/src';
import { createDb, type Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';

/** Категории TravelLine → коды категорий QVARC (data/kvarc-rooms.json) */
export const TL_CATEGORIES: Record<string, string> = {
  'Стандарт (2 этаж)': 'standard',
  'Комфорт с террасой': 'comfort',
  'Апартамент': 'apartments',
  'Семейный коттедж': 'cottage',
};

/** Тарифы TravelLine → тарифы QVARC. Основной тариф уже создан из data/kvarc-rooms.json. */
export const TL_PLANS: Record<string, { code: string; name: string }> = {
  'Стандартный с завтраком': { code: 'main', name: 'Проживание с завтраком' },
  'Новый год 2027': { code: 'new_year_2027', name: 'Новый год 2027' },
  'Скидка 50% на вторую ночь!': { code: 'second_night_50', name: 'Скидка 50% на вторую ночь' },
};

const TL_CHANNEL = { code: 'travelline', name: 'TravelLine (перенос)' };

export interface TlBooking {
  ref: string;
  booker: string;
  totalMinor: number;
  prepayRequiredMinor: number;
  prepaidMinor: number;
  paymentMethod: string;
  bookedAt: Date;
  cancelledAt: Date | null;
  cancelReason: string;
  arrival: string;
  departure: string;
  source: string;
  status: 'active' | 'cancelled';
  categories: string[];
  guests: number;
  comment: string;
  phone: string;
  email: string;
  tariff: string;
  discount: string;
}

const minor = (v: unknown) => Math.round(Number(v || 0) * 100);
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
/** Даты в выгрузке — местное время базы без пояса; читаются как UTC с теми же цифрами */
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (v: unknown): Date | null => (v instanceof Date ? v : null);
/** «1. Апартамент\n2. Апартамент» → ['Апартамент', 'Апартамент'] */
const lines = (v: unknown) => text(v).split('\n').map((s) => s.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);

export async function readTravelline(file: string | Buffer): Promise<TlBooking[]> {
  const [rows] = (await readXlsxFile(file)).map((x) => x.data);
  const header = rows[0].map(text);
  const need = ['№ брони', 'Заказчик', 'Стоимость', 'Требуемая предоплата', 'Предоплата за вычетом частичного возврата', 'Способ оплаты', 'Дата бронирования', 'Заезд', 'Выезд', 'Статус брони', 'Категория номера', 'Гостей'];
  const missing = need.filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`В выгрузке нет колонок: ${missing.join(', ')}`);
  const col = (row: unknown[], name: string) => row[header.indexOf(name)];
  const out: TlBooking[] = [];
  rows.slice(1).forEach((row, i) => {
    const n = i + 2;
    if (!text(col(row, '№ брони'))) return;
    const arrival = asDate(col(row, 'Заезд'));
    const departure = asDate(col(row, 'Выезд'));
    const bookedAt = asDate(col(row, 'Дата бронирования'));
    if (!arrival || !departure || !bookedAt) throw new Error(`Строка ${n}: нет дат заезда, выезда или бронирования`);
    out.push({
      ref: text(col(row, '№ брони')),
      booker: text(col(row, 'Заказчик')) || text(col(row, 'Гость')),
      totalMinor: minor(col(row, 'Стоимость')),
      prepayRequiredMinor: minor(col(row, 'Требуемая предоплата')),
      prepaidMinor: minor(col(row, 'Предоплата за вычетом частичного возврата')),
      paymentMethod: text(col(row, 'Способ оплаты')),
      bookedAt,
      cancelledAt: asDate(col(row, 'Дата отмены')),
      cancelReason: header.includes('Причина отмены брони') ? text(col(row, 'Причина отмены брони')) : '',
      arrival: isoDay(arrival),
      departure: isoDay(departure),
      source: lines(col(row, 'Источник'))[0] ?? '',
      status: text(col(row, 'Статус брони')) === 'Отмена' ? 'cancelled' : 'active',
      categories: lines(col(row, 'Категория номера')),
      guests: Math.max(1, Number(col(row, 'Гостей') || 1)),
      comment: header.includes('Комментарий гостя') ? text(col(row, 'Комментарий гостя')) : '',
      phone: header.includes('Номер телефона') ? text(col(row, 'Номер телефона')) : '',
      email: header.includes('Email') ? text(col(row, 'Email')).toLowerCase() : '',
      tariff: header.includes('Тарифы') ? lines(col(row, 'Тарифы')).join(', ') : '',
      discount: header.includes('Скидки') ? lines(col(row, 'Скидки')).join(', ') : '',
    });
  });
  return out;
}

function phoneE164(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length === 11 && d.startsWith('7') ? '+' + d : null;
}

/** Способ оплаты TravelLine → способ оплаты QVARC */
export function paymentMethod(tl: string): 'sbp' | 'online_card' | 'bank_transfer' | 'on_site' {
  const s = tl.toLowerCase();
  if (s.startsWith('система быстрых платежей') || s.endsWith('(сбп)')) return 'sbp';
  if (s.startsWith('банк. карта')) return 'online_card';
  if (s.includes('перевод') || s.includes('безнал')) return 'bank_transfer';
  return 'on_site';
}

/** Сумма поровну по номерам и ночам; остаток копеек на последнюю ночь первого номера */
function splitNights(totalMinor: number, rooms: number, arrival: string, nights: number) {
  const per = Math.floor(totalMinor / (rooms * nights));
  const rest = totalMinor - per * rooms * nights;
  return Array.from({ length: rooms }, (_, r) =>
    Array.from({ length: nights }, (_, i) => ({ night: addDays(arrival, i), amountMinor: per + (r === 0 && i === nights - 1 ? rest : 0) })),
  );
}

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export async function importTravelline(db: Database, propertyCode: string, rows: TlBooking[], today?: string) {
  const property = await db.selectFrom('property').select(['id', 'timezone']).where('code', '=', propertyCode).executeTakeFirstOrThrow();
  const day = today ?? todayIn(property.timezone);
  const types = await db.selectFrom('accommodation_type').select(['id', 'code', 'name']).where('property_id', '=', property.id).execute();
  const typeByTl = new Map<string, { id: string; name: string }>();
  for (const [tl, code] of Object.entries(TL_CATEGORIES)) {
    const t = types.find((x) => x.code === code);
    if (t) typeByTl.set(tl, t);
  }
  const unknown = [...new Set(rows.flatMap((r) => r.categories).filter((c) => !typeByTl.has(c)))];
  if (unknown.length) throw new Error(`Нет соответствия категориям TravelLine: ${unknown.join(', ')}. Сначала загрузите номера (import-rooms).`);
  const units = await db
    .selectFrom('accommodation_unit')
    .select(['id', 'accommodation_type_id', 'name'])
    .where('accommodation_type_id', 'in', types.map((t) => t.id))
    .where('is_active', '=', true)
    .orderBy('name')
    .execute();
  // Тариф брони по названию тарифа TravelLine, остальные — в основной
  const plans = await db.selectFrom('rate_plan').select(['id', 'code']).where('property_id', '=', property.id).execute();
  const planFor = (tariff: string) => plans.find((p) => p.code === (TL_PLANS[tariff]?.code ?? 'main'))?.id ?? plans.find((p) => p.code === 'main')?.id ?? null;

  const audit = new AuditService(db);
  const report = { created: 0, skipped: 0, cancelled: 0, upcoming: 0, unassigned: [] as string[], guests: 0, paymentsMinor: 0 };

  await db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('qvarc.source', 'travelline_import', true)`.execute(trx);
    const channel =
      (await trx.selectFrom('channel').select('id').where('property_id', '=', property.id).where('code', '=', TL_CHANNEL.code).executeTakeFirst()) ??
      (await trx.insertInto('channel').values({ property_id: property.id, code: TL_CHANNEL.code, name: TL_CHANNEL.name }).returning('id').executeTakeFirstOrThrow());
    const done = new Set(
      (await trx.selectFrom('booking').select('external_ref').where('channel_id', '=', channel.id).execute()).map((b) => b.external_ref),
    );

    // Занятость номеров уже идущими и будущими бронями, включая брони, созданные в QVARC
    const busy = await trx
      .selectFrom('booking_stay')
      .select(['unit_id', sql<string>`lower(stay)::text`.as('from'), sql<string>`upper(stay)::text`.as('to')])
      .where('is_active', '=', true)
      .where('unit_id', 'is not', null)
      .where(sql<boolean>`upper(stay) >= ${day}::date`)
      .execute();
    const taken = busy.map((b) => ({ unit: b.unit_id!, from: b.from, to: b.to }));
    const freeUnit = (typeId: string, from: string, to: string) =>
      units.find((u) => u.accommodation_type_id === typeId && !taken.some((t) => t.unit === u.id && t.from < to && from < t.to));

    const guestIds = new Map<string, string>();
    const findGuest = async (r: TlBooking) => {
      const phone = phoneE164(r.phone);
      const email = r.email.includes('@') ? r.email : null;
      const key = phone ?? email ?? `name:${r.booker.toLowerCase()}`;
      const cached = guestIds.get(key);
      if (cached) return cached;
      let existing: { id: string } | undefined;
      if (phone) existing = await trx.selectFrom('guest').select('id').where('property_id', '=', property.id).where('phone_e164', '=', phone).where('merged_into_id', 'is', null).executeTakeFirst();
      if (!existing && email) existing = await trx.selectFrom('guest').select('id').where('property_id', '=', property.id).where('email', '=', email).where('merged_into_id', 'is', null).executeTakeFirst();
      if (!existing) {
        const [last = r.booker || 'Гость', first = '', ...middle] = r.booker.split(/\s+/).filter(Boolean);
        existing = await trx
          .insertInto('guest')
          .values({ property_id: property.id, last_name: last, first_name: first, middle_name: middle.join(' ') || null, phone_e164: phone, email, tags: ['travelline'] })
          .returning('id')
          .executeTakeFirstOrThrow();
        report.guests++;
      }
      guestIds.set(key, existing.id);
      return existing.id;
    };

    // Сначала ранние заезды: так раскладка по номерам ближе к реальной
    const sorted = [...rows].sort((a, b) => a.arrival.localeCompare(b.arrival) || a.bookedAt.getTime() - b.bookedAt.getTime());
    for (let r of sorted) {
      if (done.has(r.ref)) {
        report.skipped++;
        continue;
      }
      // Дневное пребывание (заезд и выезд в один день) в QVARC — одна ночь с пометкой
      const dayUse = r.departure <= r.arrival;
      if (dayUse) r = { ...r, departure: addDays(r.arrival, 1), comment: [r.comment, 'В TravelLine дневное пребывание без ночёвки'].filter(Boolean).join('\n') };
      const nights = nightsBetween(r.arrival, r.departure);
      // Заезд сегодня — ещё не заселён, выезд сегодня — ещё живёт: заселяет и выселяет администратор
      const status = r.status === 'cancelled' ? 'cancelled' : r.departure < day ? 'checked_out' : r.arrival < day ? 'checked_in' : 'confirmed';
      const guestId = await findGuest(r);
      const rooms = r.categories.length;
      // Гостей поровну по номерам, детей в выгрузке нет — все взрослые
      const adultsPer = Array.from({ length: rooms }, (_, i) => Math.max(1, Math.floor(r.guests / rooms) + (i < r.guests % rooms ? 1 : 0)));
      // История статусов только дополняется, поэтому дата и причина отмены в TravelLine — в примечании брони
      const cancelNote = r.status === 'cancelled' ? `Отменена в TravelLine${r.cancelledAt ? ` ${r.cancelledAt.toISOString().slice(0, 10).split('-').reverse().join('.')}` : ''}${r.cancelReason ? `: ${r.cancelReason}` : ''}` : '';
      const note = [r.comment, r.discount && `Скидка в TravelLine: ${r.discount}`, cancelNote].filter(Boolean).join('\n');

      const b = await trx
        .insertInto('booking')
        .values({
          property_id: property.id,
          number: r.ref,
          status,
          channel_id: channel.id,
          external_ref: r.ref,
          booker_guest_id: guestId,
          arrival: r.arrival,
          departure: r.departure,
          adults: r.guests,
          special_requests: note || null,
          total_minor: r.totalMinor,
          prepayment_due_minor: r.prepayRequiredMinor,
          utm: JSON.stringify({ travelline: { source: r.source, tariff: r.tariff, paymentMethod: r.paymentMethod, cancelledAt: r.cancelledAt, cancelReason: r.cancelReason || null } }),
          created_at: r.bookedAt,
          updated_at: r.cancelledAt ?? r.bookedAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const prices = splitNights(r.totalMinor, rooms, r.arrival, nights);
      let firstStay: string | null = null;
      for (const [i, cat] of r.categories.entries()) {
        const type = typeByTl.get(cat)!;
        const active = status !== 'cancelled';
        let unitId: string | null = null;
        if (active && r.departure >= day) {
          const u = freeUnit(type.id, r.arrival, r.departure);
          if (u) {
            unitId = u.id;
            taken.push({ unit: u.id, from: r.arrival, to: r.departure });
          } else report.unassigned.push(`${r.ref} (${type.name}, ${r.arrival}–${r.departure})`);
        }
        const stay = await trx
          .insertInto('booking_stay')
          .values({
            booking_id: b.id,
            accommodation_type_id: type.id,
            unit_id: unitId,
            rate_plan_id: planFor(r.tariff),
            stay: toDateRange(r.arrival, r.departure),
            adults: adultsPer[i],
            children: 0,
            is_active: active,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        firstStay ??= stay.id;
        await trx.insertInto('booking_night_price').values(prices[i].map((n) => ({ booking_stay_id: stay.id, night: n.night, amount_minor: n.amountMinor }))).execute();
        await trx
          .insertInto('booking_item')
          .values({ booking_id: b.id, kind: 'accommodation', ref_id: stay.id, title: `${type.name}, ${nights} ноч.`, quantity: nights, amount_minor: prices[i].reduce((s, n) => s + n.amountMinor, 0) })
          .execute();
      }
      await trx.insertInto('booking_guest').values({ booking_id: b.id, guest_id: guestId, stay_id: firstStay, is_primary: true }).execute();
      await trx.insertInto('folio').values({ booking_id: b.id, payer_guest_id: guestId }).execute();

      if (r.prepaidMinor > 0) {
        await trx
          .insertInto('payment')
          .values({
            property_id: property.id,
            booking_id: b.id,
            purpose: 'prepayment',
            method: paymentMethod(r.paymentMethod),
            provider: 'travelline',
            status: 'succeeded',
            amount_minor: r.prepaidMinor,
            idempotency_key: `travelline:${r.ref}`,
            paid_at: r.bookedAt,
            created_at: r.bookedAt,
          })
          .execute();
        report.paymentsMinor += r.prepaidMinor;
      }
      const paid = r.prepaidMinor;
      const state = paid === 0 ? 'unpaid' : paid < r.totalMinor ? 'partially_paid' : paid === r.totalMinor ? 'paid' : 'overpaid';
      await trx.updateTable('booking').set({ payment_state: state }).where('id', '=', b.id).execute();

      report.created++;
      if (status === 'cancelled') report.cancelled++;
      if (status === 'confirmed' || status === 'checked_in') report.upcoming++;
    }
    await audit.write(
      { propertyId: property.id, actorType: 'system', actorId: null, action: 'booking.import_travelline', entity: 'booking', entityId: null, after: { created: report.created, skipped: report.skipped } },
      trx,
    );
  });
  return report;
}

if (require.main === module) {
  const [code, file] = process.argv.slice(2);
  if (!process.env.DATABASE_URL || !code || !file) {
    console.error('Запуск: DATABASE_URL=... npx tsx apps/api/src/cli/import-travelline.ts <код объекта> <выгрузка.xlsx>');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL);
  readTravelline(file)
    .then((rows) => importTravelline(db, code, rows))
    .then((r) => {
      const rub = (m: number) => `${(m / 100).toLocaleString('ru-RU')} ₽`;
      console.log(`Перенесено броней: ${r.created} (отменённых ${r.cancelled}, предстоящих и текущих ${r.upcoming}), уже были: ${r.skipped}`);
      console.log(`Новых гостей: ${r.guests}. Внесённые предоплаты: ${rub(r.paymentsMinor)}`);
      if (r.unassigned.length) console.log(`Без номера (нет свободного в категории), разместите вручную в шахматке:\n  ${r.unassigned.join('\n  ')}`);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
