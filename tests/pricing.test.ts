import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PricingService } from '../apps/api/src/pricing/pricing.service';
import { parsePriceList } from '../apps/api/src/pricing/sources';
import { addDays, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup, type Session } from './helpers';

let app: INestApplication;
let db: Database;
let owner: Session;
const today = todayIn('Asia/Yekaterinburg');
const ids: Record<string, string> = {};

// Страница номеров соседа в том виде, как её отдаёт Tilda
const GOSTI_HTML = `<html><head><script>var x = "от 1'000 р.";</script></head><body>
<div class="t-card"><div class="t-name">Standart</div><div class="t-descr">Уютный номер для проживания 2 гостей</div><div class="t-price">от 8&#39;500 р. / ночь</div></div>
<div class="t-card"><div class="t-name">Standart comfort</div><div class="t-descr">Уютный номер для проживания 2 гостей</div><div class="t-price">от 9'000 р. / ночь</div></div>
<div class="t-card"><div class="t-name">Lux</div><div class="t-descr">Двухкомнатный номер для 4 человек</div><div class="t-price">от 20&nbsp;000 р. / ночь</div></div>
</body></html>`;
let page = { status: 200, body: GOSTI_HTML };

beforeAll(async () => {
  ({ app, db } = await setup());
  owner = await login(app, OWNER.email, OWNER.password);
  for (const [code, name] of [['standard', 'Стандарт'], ['comfort', 'Комфорт']]) {
    const t = await owner.post('/admin/v1/accommodation-types', { code, name, kind: 'room', areaM2: 18, baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3 });
    expect(t.status).toBe(201);
    ids[code] = t.body.id;
    for (const n of [1, 2]) expect((await owner.post('/admin/v1/units', { accommodationTypeId: t.body.id, name: `${name} ${n}` })).status).toBe(201);
  }
  const plan = await owner.post('/admin/v1/rate-plans', {
    code: 'bb', name: 'С завтраком', accommodationTypeIds: [ids.standard, ids.comfort],
    cancellationPolicy: [{ days_before: 3, penalty_pct: 0 }, { days_before: 0, penalty_pct: 50 }],
    prepaymentPolicy: { pct: 30, due: 'at_booking' },
  });
  expect(plan.status).toBe(201);
  ids.plan = plan.body.id;
  for (const t of [ids.standard, ids.comfort]) {
    expect((await owner.post('/admin/v1/rate-rules', { ratePlanId: ids.plan, accommodationTypeId: t, from: today, to: addDays(today, 400), priceMinor: 500_000, label: 'База' })).status).toBe(201);
  }
  app.get(PricingService).fetchFn = async () => ({ ok: page.status === 200, status: page.status, text: async () => page.body });
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

const settings = (over: object = {}) => ({
  autoApply: false, ratePlanId: ids.plan, minDiscountPct: 20, maxDiscountPct: 30, reference: 'min', horizonDays: 30,
  occupancyLowPct: 30, occupancyHighPct: 80, lastMinuteDays: 3, collectEveryHours: 12, roundToMinor: 10_000, ...over,
});
const gridPrice = async (typeId: string, night: string) => {
  const g = await owner.get(`/admin/v1/rate-grid?ratePlanId=${ids.plan}&from=${night}&to=${addDays(night, 1)}`);
  return g.body.rows.find((r: { accommodationType: { id: string } }) => r.accommodationType.id === typeId).days[0].priceMinor as number;
};
const proposed = async () => (await owner.get('/admin/v1/pricing/recommendations?status=proposed')).body as { id: string; accommodation_type_id: string; night: string; suggested_minor: number; reasons: { discountPct: number; floorApplied: boolean } }[];

describe('цены соседей', () => {
  it('по умолчанию цены только предлагаются', async () => {
    const s = await owner.get('/admin/v1/pricing/settings');
    expect(s.status).toBe(200);
    expect(s.body.auto_apply).toBe(false);
    expect(Number(s.body.min_discount_pct)).toBe(20);
    expect(Number(s.body.max_discount_pct)).toBe(30);
  });

  it('«Верт» и «Гости» добавляются с сопоставлением категорий, повторно не дублируются', async () => {
    const r = await owner.post('/admin/v1/pricing/competitors/presets');
    expect(r.status).toBe(201);
    expect(r.body.added.sort()).toEqual(['Верт', 'Гости']);
    expect((await owner.post('/admin/v1/pricing/competitors/presets')).body.added).toEqual([]);
    const list = (await owner.get('/admin/v1/pricing/competitors')).body;
    const gosti = list.find((c: { name: string }) => c.name === 'Гости');
    ids.gosti = gosti.id;
    ids.vert = list.find((c: { name: string }) => c.name === 'Верт').id;
    expect(gosti.categories.find((c: { external_ref: string }) => c.external_ref === 'Standart').accommodation_type_id).toBe(ids.standard);
    expect(gosti.categories.find((c: { external_ref: string }) => c.external_ref === 'Standart comfort').accommodation_type_id).toBe(ids.comfort);
  });

  it('цены со страницы соседа собираются по названиям категорий', async () => {
    const r = await owner.post(`/admin/v1/pricing/competitors/${ids.gosti}/collect`);
    expect(r.body.status).toBe('ok');
    const prices = (await owner.get(`/admin/v1/pricing/competitor-prices?from=${today}&to=${addDays(today, 1)}`)).body as { external_ref: string; price_minor: number }[];
    const by = Object.fromEntries(prices.map((p) => [p.external_ref, p.price_minor]));
    expect(by.Standart).toBe(850_000);
    expect(by['Standart comfort']).toBe(900_000);
    expect(by.Lux).toBe(2_000_000);
  });

  it('сбой сайта соседа попадает в журнал сбора', async () => {
    page = { status: 503, body: '' };
    const r = await owner.post(`/admin/v1/pricing/competitors/${ids.gosti}/collect`);
    expect(r.body.status).toBe('error');
    page = { status: 200, body: GOSTI_HTML };
    const j = (await owner.get('/admin/v1/pricing/journal')).body;
    expect(j.runs[0].status).toBe('error');
    expect(j.runs[0].error).toContain('503');
  });

  it('без минимальной цены цена не предлагается', async () => {
    expect((await owner.put('/admin/v1/pricing/settings', settings())).status).toBe(200);
    const r = await owner.post('/admin/v1/pricing/run');
    expect(r.status).toBe(200);
    expect(r.body.proposed).toBe(0);
    expect(r.body.skipped.no_floor).toBeGreaterThan(0);
  });

  it('предложение: на 30% дешевле самого дешёвого соседа при пустых номерах, тариф не меняется', async () => {
    for (const t of [ids.standard, ids.comfort]) {
      expect((await owner.post('/admin/v1/pricing/floors', { accommodationTypeId: t, from: today, to: addDays(today, 365), minPriceMinor: 400_000, label: 'Минимум' })).status).toBe(201);
    }
    // «Верт» вручную дешевле «Гостей» на ближайшие 10 ночей
    expect((await owner.post('/admin/v1/pricing/competitor-prices', { competitorId: ids.vert, externalRef: 'Standard', from: today, to: addDays(today, 10), priceMinor: 700_000 })).status).toBe(201);
    const r = await owner.post('/admin/v1/pricing/run');
    expect(r.body.proposed).toBeGreaterThan(0);
    expect(r.body.applied).toBe(0);
    const recs = await proposed();
    const std5 = recs.find((x) => x.accommodation_type_id === ids.standard && x.night === addDays(today, 5))!;
    expect(std5.suggested_minor).toBe(490_000);
    expect(std5.reasons.discountPct).toBe(30);
    const std20 = recs.find((x) => x.accommodation_type_id === ids.standard && x.night === addDays(today, 20))!;
    expect(std20.suggested_minor).toBe(600_000);
    const cmf = recs.find((x) => x.accommodation_type_id === ids.comfort && x.night === addDays(today, 5))!;
    expect(cmf.suggested_minor).toBe(630_000);
    expect(await gridPrice(ids.standard, addDays(today, 5))).toBe(500_000);
    // Повторный пересчёт без изменений не плодит предложения
    expect((await owner.post('/admin/v1/pricing/run')).body.proposed).toBe(0);
  });

  it('принятое предложение меняет цену ночи', async () => {
    const rec = (await proposed()).find((x) => x.accommodation_type_id === ids.standard && x.night === addDays(today, 5))!;
    const r = await owner.post('/admin/v1/pricing/recommendations/decide', { ids: [rec.id], accept: true });
    expect(r.status).toBe(200);
    expect(await gridPrice(ids.standard, addDays(today, 5))).toBe(490_000);
    expect(await gridPrice(ids.standard, addDays(today, 6))).toBe(500_000);
    const again = await owner.post('/admin/v1/pricing/recommendations/decide', { ids: [rec.id], accept: true });
    expect(again.status).toBe(422);
  });

  it('не ниже минимума на конкретные даты', async () => {
    await owner.post('/admin/v1/pricing/floors', { accommodationTypeId: ids.standard, from: addDays(today, 7), to: addDays(today, 8), minPriceMinor: 650_000, label: 'Праздник' });
    await owner.post('/admin/v1/pricing/run');
    const rec = (await proposed()).find((x) => x.accommodation_type_id === ids.standard && x.night === addDays(today, 7))!;
    expect(rec.suggested_minor).toBe(650_000);
    expect(rec.reasons.floorApplied).toBe(true);
  });

  it('высокая загрузка — скидка меньше', async () => {
    const night = addDays(today, 12);
    const g = { lastName: 'Петров', firstName: 'Пётр', phone: '+79001112233', email: 'p@example.com' };
    for (let i = 0; i < 2; i++) {
      const b = await owner.post('/admin/v1/bookings', { guest: g, accommodationTypeId: ids.comfort, ratePlanId: ids.plan, arrival: night, departure: addDays(night, 1), adults: 2 });
      expect(b.status).toBe(201);
    }
    await owner.post('/admin/v1/pricing/run');
    const recs = await proposed();
    // Мест в «Комфорте» нет — цену не трогаем; в «Стандарте» загрузка нулевая
    expect(recs.find((x) => x.accommodation_type_id === ids.comfort && x.night === night)).toBeUndefined();
  });

  it('с переключателем цены ставятся сами; снятие автоцен возвращает ручные', async () => {
    const on = await owner.put('/admin/v1/pricing/settings', settings({ autoApply: true }));
    expect(on.status).toBe(200);
    const r = await owner.post('/admin/v1/pricing/run');
    expect(r.body.applied).toBeGreaterThan(0);
    expect(await proposed()).toEqual([]);
    expect(await gridPrice(ids.standard, addDays(today, 6))).toBe(490_000);
    expect(await gridPrice(ids.standard, addDays(today, 20))).toBe(600_000);
    // Повторно та же цена не переставляется
    expect((await owner.post('/admin/v1/pricing/run')).body.applied).toBe(0);
    const rm = await owner.post('/admin/v1/pricing/auto-prices/remove');
    expect(rm.body.removed).toBeGreaterThan(0);
    expect(await gridPrice(ids.standard, addDays(today, 6))).toBe(500_000);
    const j = (await owner.get('/admin/v1/pricing/journal')).body;
    const actions = j.events.map((e: { action: string }) => e.action);
    expect(actions).toContain('pricing.auto_on');
    expect(actions).toContain('pricing.auto_apply');
    expect(actions).toContain('pricing.auto_remove');
  });

  it('по расписанию сбор запускается раз в заданное число часов', async () => {
    const svc = app.get(PricingService);
    await db.updateTable('pricing_settings').set({ last_run_at: null }).execute();
    expect(await svc.tick()).toBe(1);
    expect(await svc.tick()).toBe(0);
  });
});

describe('разбор страницы с ценами', () => {
  it('без заведённых категорий название берётся из строки над ценой', () => {
    const found = parsePriceList(GOSTI_HTML, []);
    expect(found.map((f) => [f.name, f.priceMinor])).toEqual([
      ['Standart', 850_000],
      ['Standart comfort', 900_000],
      ['Lux', 2_000_000],
    ]);
  });
});
