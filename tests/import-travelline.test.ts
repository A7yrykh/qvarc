import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRooms } from '../apps/api/src/cli/import-rooms';
import { importTravelline, paymentMethod, readTravelline } from '../apps/api/src/cli/import-travelline';
import { importTravellineRates, readTravellineRates } from '../apps/api/src/cli/import-travelline-rates';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup } from './helpers';

let app: INestApplication;
let db: Database;
// Выгрузка в tests/fixtures выдуманная, «сегодня» для неё — 13.10.2026
const TODAY = '2026-10-13';

beforeAll(async () => {
  ({ app, db } = await setup());
  await importRooms(db, 'test', JSON.parse(readFileSync('data/kvarc-rooms.json', 'utf8')));
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('перенос из TravelLine', () => {
  it('цены и ограничения: тарифы TravelLine становятся тарифами с правилами по дням', async () => {
    const data = await readTravellineRates('tests/fixtures/travelline-rates.xlsx');
    expect([data.from, data.to]).toEqual(['2026-12-30', '2027-01-02']);
    const report = await importTravellineRates(db, 'test', data);
    expect(report).toEqual([
      { plan: 'Новый год 2027', created: true, rules: 2 },
      { plan: 'Проживание с завтраком', created: false, rules: 3 },
    ]);
    // Повторный запуск заменяет свои правила, а не дублирует
    await importTravellineRates(db, 'test', data);
    const owner = await login(app, OWNER.email, OWNER.password);
    const plans = (await owner.get('/admin/v1/rate-plans')).body as { id: string; code: string; cancellation_policy: unknown; deposit_policy: unknown }[];
    const ny = plans.find((p) => p.code === 'new_year_2027')!;
    const main = plans.find((p) => p.code === 'main')!;
    expect(ny.cancellation_policy).toEqual(main.cancellation_policy);
    expect(ny.deposit_policy).toEqual(main.deposit_policy);
    const cottage = ((await owner.get('/admin/v1/accommodation-types')).body as { id: string; code: string }[]).find((t) => t.code === 'cottage')!;
    const rules = (await owner.get(`/admin/v1/rate-rules?ratePlanId=${main.id}`)).body as { accommodation_type_id: string; period: string; price_minor: number; extra_adult_minor: number | null; closed: boolean; min_stay: number | null }[];
    const c = rules.filter((r) => r.accommodation_type_id === cottage.id).sort((a, b) => a.period.localeCompare(b.period));
    expect(c.map((r) => [r.period, r.price_minor, r.extra_adult_minor, r.closed, r.min_stay])).toEqual([
      ['[2026-12-30,2026-12-31)', 1_590_000, 500_000, true, null],
      ['[2026-12-31,2027-01-01)', 1_800_000, null, false, 2],
      ['[2027-01-01,2027-01-02)', 1_800_000, 500_000, false, 2],
    ]);
  });

  it('брони: статусы, гости, предоплаты и раскладка по номерам; повтор ничего не дублирует', async () => {
    const rows = await readTravelline('tests/fixtures/travelline-bookings.xlsx');
    expect(rows).toHaveLength(8);
    const r = await importTravelline(db, 'test', rows, TODAY);
    expect(r).toMatchObject({ created: 8, skipped: 0, cancelled: 2, upcoming: 5, guests: 7, paymentsMinor: (6900 + 17250 + 6900 + 32000 + 72000) * 100 });
    // Второй коттедж на те же даты: номер не назначается, администратор разместит сам
    expect(r.unassigned).toEqual(['20261231-1-8 (Семейный коттедж, 2026-12-31–2027-01-02)']);
    expect((await importTravelline(db, 'test', rows, TODAY)).skipped).toBe(8);

    const owner = await login(app, OWNER.email, OWNER.password);
    const list = (await owner.get('/admin/v1/bookings?limit=50')).body;
    const items = (Array.isArray(list) ? list : list.items) as { id: string; number: string; status: string }[];
    const by = (n: string) => items.find((b) => b.number === n)!;
    expect(by('20250801-1-1').status).toBe('checked_out');
    expect(by('20251010-1-2').status).toBe('cancelled');
    expect(by('20261011-1-4').status).toBe('checked_in');
    // Заезд сегодня — ещё не заселён
    expect(by('20261013-1-5').status).toBe('confirmed');

    const group = (await owner.get(`/admin/v1/bookings/${by('20261231-1-6').id}`)).body;
    expect(group).toMatchObject({ total_minor: 12_800_000, prepayment_due_minor: 6_400_000, payment_state: 'partially_paid' });
    expect(group.special_requests).toContain('Скидка в TravelLine: Скидка «Другое»');
    const pays = (await owner.get(`/admin/v1/bookings/${by('20261231-1-6').id}/payments`)).body;
    expect(pays).toMatchObject([{ method: 'bank_transfer', provider: 'travelline', status: 'succeeded', amount_minor: 3_200_000 }]);
    // Деньги принимал TravelLine: вернуть их отсюда нельзя
    const refund = await owner.post(`/admin/v1/payments/${pays[0].id}/refunds`, { amountMinor: 100, reason: 'тест' });
    expect(refund.status).toBe(409);

    // Две брони одного гостя с телефоном в разной записи — один гость
    const anna = await db.selectFrom('guest').select(['id', 'last_name', 'first_name', 'middle_name', 'phone_e164', 'email']).where('phone_e164', '=', '+79001110001').execute();
    expect(anna).toMatchObject([{ last_name: 'Тестова', first_name: 'Анна', middle_name: 'Петровна', email: 'anna@example.com' }]);
    const cancelled = (await owner.get(`/admin/v1/bookings/${by('20251010-1-2').id}`)).body;
    expect(cancelled.special_requests).toBe('Отменена в TravelLine 05.09.2025: Отказ от бронирования');
    const dayUse = (await owner.get(`/admin/v1/bookings/${by('20251102-1-3').id}`)).body;
    expect([dayUse.arrival, dayUse.departure]).toEqual(['2025-11-02', '2025-11-03']);

    // Занятые номера видны в продаже: на Новый год оба коттеджа из TravelLine занимают единственный коттедж и очередь
    const stays = await db
      .selectFrom('booking_stay as s')
      .innerJoin('booking as b', 'b.id', 's.booking_id')
      .innerJoin('rate_plan as p', 'p.id', 's.rate_plan_id')
      .select(['b.number', 's.unit_id', 's.is_active', 'p.code'])
      .where('b.number', 'in', ['20261231-1-6', '20261011-1-4', '20251010-1-2'])
      .execute();
    expect(stays.filter((s) => s.number === '20261231-1-6').map((s) => s.code)).toEqual(['new_year_2027', 'new_year_2027']);
    expect(stays.find((s) => s.number === '20261011-1-4')!.code).toBe('main');
    expect(stays.find((s) => s.number === '20251010-1-2')!.is_active).toBe(false);
  });

  it('способы оплаты TravelLine', () => {
    expect(paymentMethod('Система быстрых платежей: Эквайринг ComfortBooking (Система быстрых платежей) (СБП)')).toBe('sbp');
    expect(paymentMethod('Банк. карта: Эквайринг ComfortBooking (Банк. карта) (СБП)')).toBe('sbp');
    expect(paymentMethod('Банк. карта: Эквайринг ComfortBooking (Банк. карта) (T-Pay)')).toBe('online_card');
    expect(paymentMethod('Безнал для юр.лиц')).toBe('bank_transfer');
    expect(paymentMethod('При заселении')).toBe('on_site');
  });
});
