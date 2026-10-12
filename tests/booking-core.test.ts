import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup, type Session } from './helpers';

let app: INestApplication;
let db: Database;
let owner: Session;
const today = todayIn('Asia/Yekaterinburg');
// Опорная дата: ближайший понедельник не раньше чем через 60 дней
let monday = addDays(today, 60);
while (isoWeekday(monday) !== 1) monday = addDays(monday, 1);
const d = (n: number) => addDays(monday, n);

const ids: Record<string, string> = {};
const guest = { lastName: 'Иванов', firstName: 'Иван', phone: '+79001234567', email: 'ivanov@example.com' };

beforeAll(async () => {
  ({ app, db } = await setup());
  owner = await login(app, OWNER.email, OWNER.password);

  const std = await owner.post('/admin/v1/accommodation-types', {
    code: 'standard', name: 'Стандарт', kind: 'room', areaM2: 18, baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3,
  });
  expect(std.status).toBe(201);
  ids.std = std.body.id;
  for (const name of ['Номер 1', 'Номер 2']) {
    const u = await owner.post('/admin/v1/units', { accommodationTypeId: ids.std, name });
    expect(u.status).toBe(201);
    ids[name] = u.body.id;
  }
  const plan = await owner.post('/admin/v1/rate-plans', {
    code: 'flex', name: 'Гибкий', accommodationTypeIds: [ids.std],
    cancellationPolicy: [{ days_before: 7, penalty_pct: 0 }, { days_before: 0, penalty_pct: 50 }],
    prepaymentPolicy: { pct: 30, due: 'at_booking' },
  });
  expect(plan.status).toBe(201);
  ids.plan = plan.body.id;
  const base = await owner.post('/admin/v1/rate-rules', {
    ratePlanId: ids.plan, accommodationTypeId: ids.std, from: today, to: addDays(today, 730),
    priceMinor: 500_000, extraChildMinor: 100_000, label: 'База',
  });
  expect(base.status).toBe(201);
  const weekend = await owner.post('/admin/v1/rate-rules', {
    ratePlanId: ids.plan, accommodationTypeId: ids.std, from: today, to: addDays(today, 730),
    weekdays: [5, 6], priority: 10, priceMinor: 700_000, label: 'Выходные',
  });
  expect(weekend.status).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

const booking = (over: object = {}) => ({
  guest, accommodationTypeId: ids.std, ratePlanId: ids.plan, arrival: d(0), departure: d(3), adults: 2, ...over,
});

describe('доступ', () => {
  it('без входа API закрыт', async () => {
    const r = await request(app.getHttpServer()).get('/admin/v1/accommodation-types');
    expect(r.status).toBe(401);
  });
  it('изменяющий запрос без CSRF-токена отклоняется', async () => {
    const r = await owner.raw.post('/admin/v1/units').send({ accommodationTypeId: ids.std, name: 'X' });
    expect(r.status).toBe(403);
  });
  it('неверный пароль не пускает, пятая ошибка подряд блокирует попытки', async () => {
    const http = request(app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      expect((await http.post('/admin/v1/auth/login').send({ email: 'nobody@test.local', password: 'wrong' })).status).toBe(401);
    }
    expect((await http.post('/admin/v1/auth/login').send({ email: 'nobody@test.local', password: 'wrong' })).status).toBe(429);
  });
});

describe('расчёт цены', () => {
  it('пн–чт по базе, пт–сб по цене выходных, предоплата 30%', async () => {
    const r = await owner.post('/admin/v1/quotes', {
      accommodationTypeId: ids.std, ratePlanId: ids.plan, arrival: d(3), departure: d(6), adults: 2,
    });
    expect(r.status).toBe(200);
    expect(r.body.nights.map((n: { amountMinor: number }) => n.amountMinor)).toEqual([500_000, 700_000, 700_000]);
    expect(r.body.totalMinor).toBe(1_900_000);
    expect(r.body.prepaymentDueMinor).toBe(570_000);
  });
  it('гостей больше вместимости — бронь невозможна', async () => {
    const r = await owner.post('/admin/v1/bookings', booking({ adults: 3 }));
    expect(r.status).toBe(422);
  });
});

describe('бронирование (тесты ТЗ 1, 2, 3, 9, 10)', () => {
  it('успешная бронь: номер назначен, цены ночей сохранены, история и журнал записаны', async () => {
    const r = await owner.post('/admin/v1/bookings', booking());
    expect(r.status).toBe(201);
    expect(r.body.number).toMatch(/^QV-\d{4}-\d{6}$/);
    expect(r.body.total_minor).toBe(1_500_000);
    expect(r.body.stays[0].unit_name).toBe('Номер 1');
    expect(r.body.nights).toHaveLength(3);
    expect(r.body.history.map((h: { to_status: string }) => h.to_status)).toEqual(['confirmed']);
    expect(r.body.history[0].changed_by).toBeTruthy();
    ids.b1 = r.body.id;
    const audit = await db.selectFrom('audit_log').select('action').where('entity_id', '=', ids.b1).execute();
    expect(audit.map((a) => a.action)).toContain('booking.create');
  });

  it('вторая бронь на те же даты получает другой номер, третья — отказ «нет мест»', async () => {
    const r2 = await owner.post('/admin/v1/bookings', booking());
    expect(r2.status).toBe(201);
    expect(r2.body.stays[0].unit_name).toBe('Номер 2');
    ids.b2 = r2.body.id;
    const r3 = await owner.post('/admin/v1/bookings', booking({ arrival: d(2), departure: d(4) }));
    expect(r3.status).toBe(409);
    expect(r3.body.code).toBe('sold_out');
  });

  it('повтор запроса с тем же ключом не создаёт вторую бронь', async () => {
    const body = booking({ arrival: d(10), departure: d(11), idempotencyKey: 'form-submit-0001' });
    const a = await owner.post('/admin/v1/bookings', body);
    const b = await owner.post('/admin/v1/bookings', body);
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.duplicate).toBe(true);
    await owner.post(`/admin/v1/bookings/${a.body.id}/status`, { status: 'cancelled', reason: 'тест' });
  });

  it('из 10 одновременных броней на 2 свободных номера проходят ровно 2', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        owner.post('/admin/v1/bookings', booking({ arrival: d(14), departure: d(16), guest: { ...guest, lastName: `Гость${i}` } })),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(8);
    expect(new Set(ok.map((r) => r.body.stays[0].unit_id)).size).toBe(2);
  });

  it('перенос на занятый номер отклоняется, на свободный проходит', async () => {
    const busy = await owner.patch(`/admin/v1/bookings/${ids.b1}/unit`, { unitId: ids['Номер 2'] });
    expect(busy.status).toBe(409);
    const add = await owner.post('/admin/v1/units', { accommodationTypeId: ids.std, name: 'Номер 3' });
    ids['Номер 3'] = add.body.id;
    const ok = await owner.patch(`/admin/v1/bookings/${ids.b1}/unit`, { unitId: ids['Номер 3'], reason: 'просьба гостя' });
    expect(ok.status).toBe(200);
    expect(ok.body.stays[0].unit_name).toBe('Номер 3');
    expect(ok.body.total_minor).toBe(1_500_000);
  });

  it('продление: старые ночи сохраняют цену, новые считаются по текущему тарифу', async () => {
    // Поднимаем цену после подтверждения брони
    await owner.post('/admin/v1/rate-rules', {
      ratePlanId: ids.plan, accommodationTypeId: ids.std, from: d(0), to: d(7), priority: 50, priceMinor: 600_000, label: 'Повышение',
    });
    const r = await owner.patch(`/admin/v1/bookings/${ids.b1}/dates`, { arrival: d(0), departure: d(4) });
    expect(r.status).toBe(200);
    expect(r.body.nights.map((n: { amount_minor: number }) => n.amount_minor)).toEqual([500_000, 500_000, 500_000, 600_000]);
    expect(r.body.total_minor).toBe(2_100_000);
  });

  it('сокращение убирает лишние ночи и пересчитывает сумму', async () => {
    const r = await owner.patch(`/admin/v1/bookings/${ids.b1}/dates`, { arrival: d(1), departure: d(3) });
    expect(r.status).toBe(200);
    expect(r.body.nights).toHaveLength(2);
    expect(r.body.total_minor).toBe(1_000_000);
    expect(r.body.arrival).toBe(d(1));
  });

  it('изменение дат на занятые ночи отклоняется', async () => {
    // Номер 2 занят d0–d3 бронью b2; переносим b1 в Номер 2 на свободные даты и пробуем расширить на занятые
    const free = await owner.patch(`/admin/v1/bookings/${ids.b1}/dates`, { arrival: d(20), departure: d(22) });
    expect(free.status).toBe(200);
    const moved = await owner.patch(`/admin/v1/bookings/${ids.b1}/unit`, { unitId: ids['Номер 2'] });
    expect(moved.status).toBe(200);
    const clash = await owner.patch(`/admin/v1/bookings/${ids.b1}/dates`, { arrival: d(1), departure: d(22) });
    expect(clash.status).toBe(409);
  });

  it('закрытый на ремонт номер не продаётся', async () => {
    await owner.post('/admin/v1/availability-blocks', { unitId: ids['Номер 3'], from: d(30), to: d(32), reason: 'out_of_order' });
    const s = await owner.get(`/admin/v1/availability?arrival=${d(30)}&departure=${d(31)}&adults=2`);
    expect(s.status).toBe(200);
    expect(s.body[0].freeUnits).toBe(2);
    const m = await owner.patch(`/admin/v1/bookings/${ids.b1}/unit`, { unitId: ids['Номер 3'] });
    expect(m.status).toBe(200); // b1 сейчас на d20–d22, ремонт не мешает
  });
});

describe('статусы', () => {
  it('нельзя выселить, не заселив; отмена освобождает номер; отменённую нельзя вернуть', async () => {
    const card = await owner.get(`/admin/v1/bookings/${ids.b2}`);
    expect(card.body.allowed_transitions.sort()).toEqual(['cancelled', 'checked_in', 'no_show']);
    const bad = await owner.post(`/admin/v1/bookings/${ids.b2}/status`, { status: 'checked_out' });
    expect(bad.status).toBe(409);
    const cancel = await owner.post(`/admin/v1/bookings/${ids.b2}/status`, { status: 'cancelled', reason: 'гость отказался' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.stays[0].is_active).toBe(false);
    const again = await owner.post('/admin/v1/bookings', booking());
    expect(again.status).toBe(201);
    const back = await owner.post(`/admin/v1/bookings/${ids.b2}/status`, { status: 'confirmed' });
    expect(back.status).toBe(409);
  });

  it('заселение раньше даты заезда запрещено', async () => {
    const r = await owner.post(`/admin/v1/bookings/${ids.b1}/status`, { status: 'checked_in' });
    expect(r.status).toBe(409);
  });

  it('подтверждённую бронь нельзя удалить даже напрямую в базе', async () => {
    await expect(db.deleteFrom('booking').where('id', '=', ids.b1).execute()).rejects.toThrow(/удалить нельзя/);
  });
});

describe('цены и ограничения', () => {
  it('таблица показывает итоговую цену по дням и число свободных номеров', async () => {
    const r = await owner.get(`/admin/v1/rate-grid?ratePlanId=${ids.plan}&from=${d(28)}&to=${d(35)}`);
    expect(r.status).toBe(200);
    const days = r.body.rows[0].days;
    expect(days).toHaveLength(7);
    // d28 — понедельник: база; d32 — пятница: выходные
    expect(days[0].priceMinor).toBe(500_000);
    expect(days[4].priceMinor).toBe(700_000);
    // Номер 3 закрыт на ремонт d30–d31
    expect(days[2].free).toBe(2);
    expect(days[0].free).toBe(3);
  });
});

describe('шахматка и поиск', () => {
  it('шахматка показывает номера и брони периода с долгом', async () => {
    const r = await owner.get(`/admin/v1/calendar?from=${d(0)}&to=${d(31)}`);
    expect(r.status).toBe(200);
    expect(r.body.units).toHaveLength(3);
    expect(r.body.stays.length).toBeGreaterThanOrEqual(3);
    expect(r.body.stays.every((s: { balance_minor: number; total_minor: number }) => s.balance_minor === s.total_minor)).toBe(true);
    expect(r.body.blocks).toHaveLength(1);
  });
  it('поиск по фамилии и номеру брони', async () => {
    const r = await owner.get('/admin/v1/bookings?q=гость3');
    expect(r.body.length).toBeLessThanOrEqual(1);
    const byName = await owner.get('/admin/v1/bookings?q=иванов');
    expect(byName.body.length).toBeGreaterThan(0);
  });
});

describe('роли (тесты ТЗ 20, 21)', () => {
  let maid: Session;
  beforeAll(async () => {
    const r = await owner.post('/admin/v1/users', { email: 'maid@test.local', fullName: 'Горничная', password: 'maid-password-123', roles: ['housekeeping'] });
    expect(r.status).toBe(201);
    maid = await login(app, 'maid@test.local', 'maid-password-123');
  });

  it('уборка видит шахматку, но не карточки гостей, не брони и не может создавать брони', async () => {
    expect((await maid.get(`/admin/v1/calendar?from=${d(0)}&to=${d(7)}`)).status).toBe(200);
    expect((await maid.get('/admin/v1/guests?q=иванов')).status).toBe(403);
    expect((await maid.get(`/admin/v1/bookings/${ids.b1}`)).status).toBe(403);
    expect((await maid.post('/admin/v1/bookings', booking({ arrival: d(40), departure: d(41) }))).status).toBe(403);
    expect((await maid.post('/admin/v1/rate-rules', {})).status).toBe(403);
  });

  it('отказ в доступе записан в журнал', async () => {
    const rows = await db.selectFrom('audit_log').select(['action', 'entity_id']).where('action', '=', 'access.denied').execute();
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it('владелец видит контакты гостя, просмотр ПДн журналируется', async () => {
    const list = await owner.get('/admin/v1/guests?q=иванов');
    const g = await owner.get(`/admin/v1/guests/${list.body[0].id}`);
    expect(g.body.phone_e164).toBe('+79001234567');
    const audit = await db.selectFrom('audit_log').select('action').where('action', '=', 'guest.pii.view').execute();
    expect(audit.length).toBe(1);
  });

  it('журнал аудита нельзя изменить', async () => {
    await expect(db.updateTable('audit_log').set({ action: 'x' }).execute()).rejects.toThrow(/запрещена/);
  });
});
