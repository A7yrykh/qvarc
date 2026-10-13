// Перенос цен и ограничений из TravelLine по выгрузке шахматки тарифов (ID_<объект>_rate_plans_<дата>.xlsx).
// Лист называется периодом «2026-10-13 – 2027-01-13», первая строка — дни, ниже блоки «<тариф>, RUB» → категория → строки цен.
// Каждый тариф TravelLine становится тарифом QVARC с теми же условиями отмены и оплаты, что у основного тарифа.
// Подряд идущие дни с одинаковыми ценами и ограничениями сводятся в одно правило «Из TravelLine».
// Повторный запуск заменяет правила «Из TravelLine» этих тарифов, правила администратора не трогает.
//   DATABASE_URL=... npx tsx apps/api/src/cli/import-travelline-rates.ts kvarc rate_plans.xlsx
import readXlsxFile from 'read-excel-file/node';
import { addDays, toDateRange } from '../../../../packages/domain/src';
import { createDb, type Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { TL_CATEGORIES, TL_PLANS } from './import-travelline';

export const TL_LABEL = 'Из TravelLine';

export interface TlDay {
  priceMinor: number | null;
  extraAdultMinor: number | null;
  extraChildMinor: number | null;
  minStay: number | null;
  closed: boolean;
  closedToArrival: boolean;
}
/** Тариф → категория → дата → день */
export type TlRates = Map<string, Map<string, Map<string, TlDay>>>;

const MONTHS = ['янв', 'февр', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const X = (v: unknown) => text(v).toUpperCase() === 'X';

export async function readTravellineRates(file: string | Buffer): Promise<{ from: string; to: string; rates: TlRates }> {
  const [{ sheet, data: rows }] = await readXlsxFile(file);
  const period = sheet.match(/(\d{4}-\d\d-\d\d)\s*[–-]\s*(\d{4}-\d\d-\d\d)/);
  if (!period) throw new Error(`Лист «${sheet}»: ожидается период вида 2026-10-13 – 2027-01-13`);
  const [, from, last] = period;

  // Колонка → дата. Колонки с одним годом («2027») — разделители, их пропускаем
  const header = rows[0];
  const dates = new Map<number, string>();
  let day = from;
  for (let c = 1; c < header.length; c++) {
    const h = text(header[c]);
    if (/^\d{4}$/.test(h) || !h) continue;
    const [d, mon] = h.split(/\s+/);
    if (Number(d) !== Number(day.slice(8, 10)) || MONTHS.indexOf(mon) !== Number(day.slice(5, 7)) - 1)
      throw new Error(`Колонка ${c + 1}: «${h}» не совпадает с датой ${day}`);
    dates.set(c, day);
    day = addDays(day, 1);
  }
  if (addDays(day, -1) !== last) throw new Error(`Дни в первой строке заканчиваются ${addDays(day, -1)}, а не ${last}`);

  const rates: TlRates = new Map();
  let plan: Map<string, Map<string, TlDay>> | null = null;
  let cat: Map<string, TlDay> | null = null;
  rows.slice(1).forEach((row, i) => {
    const n = i + 2;
    const name = text(row[0]);
    const planMatch = name.match(/^(.*), RUB$/);
    if (planMatch) {
      plan = new Map();
      rates.set(planMatch[1], plan);
      cat = null;
      return;
    }
    if (TL_CATEGORIES[name]) {
      if (!plan) throw new Error(`Строка ${n}: категория «${name}» вне тарифа`);
      cat = new Map([...dates.values()].map((d) => [d, { priceMinor: null, extraAdultMinor: null, extraChildMinor: null, minStay: null, closed: false, closedToArrival: false }]));
      plan.set(name, cat);
      return;
    }
    if (!cat) throw new Error(`Строка ${n}: «${name}» вне категории`);
    for (const [c, d] of dates) {
      const v = row[c];
      const t = cat.get(d)!;
      // Цена за номер одинакова при любом числе основных гостей: берём цену за 1 гостя
      if (name === 'Цена 1 осн.' && num(v) !== null) t.priceMinor = Math.round(num(v)! * 100);
      else if (name === 'Цена доп. место' && num(v) !== null) t.extraAdultMinor = Math.round(num(v)! * 100);
      else if (name === 'Цена реб. (0-7 лет)' && num(v) !== null) t.extraChildMinor = Math.round(num(v)! * 100);
      else if (name === 'MinLOS' && num(v) !== null) t.minStay = num(v);
      else if (name === 'Close/Open') t.closed = X(v);
      else if (name === 'CTA') t.closedToArrival = X(v);
    }
  });
  return { from, to: addDays(last, 1), rates };
}

const same = (a: TlDay, b: TlDay) => JSON.stringify(a) === JSON.stringify(b);
const empty = (d: TlDay) => d.priceMinor === null && !d.closed && !d.closedToArrival && d.minStay === null;

export async function importTravellineRates(db: Database, propertyCode: string, data: { from: string; to: string; rates: TlRates }) {
  const property = await db.selectFrom('property').select('id').where('code', '=', propertyCode).executeTakeFirstOrThrow();
  const types = await db.selectFrom('accommodation_type').select(['id', 'code']).where('property_id', '=', property.id).execute();
  const unknownPlans = [...data.rates.keys()].filter((p) => !TL_PLANS[p]);
  if (unknownPlans.length) throw new Error(`Нет соответствия тарифам TravelLine: ${unknownPlans.join(', ')}`);
  const report: { plan: string; created: boolean; rules: number }[] = [];

  await db.transaction().execute(async (trx) => {
    const main = await trx.selectFrom('rate_plan').selectAll().where('property_id', '=', property.id).where('code', '=', 'main').executeTakeFirst();
    if (!main) throw new Error('Нет основного тарифа main. Сначала загрузите номера (import-rooms).');
    for (const [tlName, cats] of data.rates) {
      const target = TL_PLANS[tlName];
      let plan = await trx.selectFrom('rate_plan').select('id').where('property_id', '=', property.id).where('code', '=', target.code).executeTakeFirst();
      const created = !plan;
      if (!plan) {
        // Условия отмены, предоплаты и депозита как у основного тарифа (по оферте)
        plan = await trx
          .insertInto('rate_plan')
          .values({
            property_id: property.id,
            code: target.code,
            name: target.name,
            meal_plan: main.meal_plan,
            is_refundable: main.is_refundable,
            cancellation_policy: JSON.stringify(main.cancellation_policy),
            prepayment_policy: JSON.stringify(main.prepayment_policy),
            deposit_policy: main.deposit_policy ? JSON.stringify(main.deposit_policy) : null,
            is_public: true,
            is_active: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      }
      await trx.deleteFrom('rate_rule').where('rate_plan_id', '=', plan.id).where('label', '=', TL_LABEL).execute();
      let rules = 0;
      for (const [tlCat, days] of cats) {
        const type = types.find((t) => t.code === TL_CATEGORIES[tlCat]);
        if (!type) throw new Error(`Нет категории ${TL_CATEGORIES[tlCat]}. Сначала загрузите номера (import-rooms).`);
        await trx.insertInto('rate_plan_type').values({ rate_plan_id: plan.id, accommodation_type_id: type.id }).onConflict((oc) => oc.doNothing()).execute();
        // Подряд идущие одинаковые дни → одно правило
        const list = [...days.entries()];
        for (let i = 0; i < list.length; ) {
          let j = i + 1;
          while (j < list.length && same(list[j][1], list[i][1])) j++;
          const d = list[i][1];
          if (!empty(d)) {
            await trx
              .insertInto('rate_rule')
              .values({
                rate_plan_id: plan.id,
                accommodation_type_id: type.id,
                period: toDateRange(list[i][0], addDays(list[j - 1][0], 1)),
                priority: 10,
                price_minor: d.priceMinor,
                extra_adult_minor: d.priceMinor === null ? null : d.extraAdultMinor,
                extra_child_minor: d.priceMinor === null ? null : d.extraChildMinor,
                min_stay: d.minStay,
                closed: d.closed,
                closed_to_arrival: d.closedToArrival,
                label: TL_LABEL,
              })
              .execute();
            rules++;
          }
          i = j;
        }
      }
      report.push({ plan: target.name, created, rules });
    }
    await new AuditService(db).write(
      { propertyId: property.id, actorType: 'system', actorId: null, action: 'rates.import_travelline', entity: 'rate_plan', entityId: null, after: { from: data.from, to: data.to, report } },
      trx,
    );
  });
  return report;
}

if (require.main === module) {
  const [code, file] = process.argv.slice(2);
  if (!process.env.DATABASE_URL || !code || !file) {
    console.error('Запуск: DATABASE_URL=... npx tsx apps/api/src/cli/import-travelline-rates.ts <код объекта> <rate_plans.xlsx>');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL);
  readTravellineRates(file)
    .then(async (data) => {
      const r = await importTravellineRates(db, code, data);
      console.log(`Цены и ограничения TravelLine за ${data.from} – ${data.to}:`);
      for (const p of r) console.log(`  ${p.plan}: ${p.created ? 'тариф создан' : 'тариф уже был'}, правил ${p.rules}`);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
