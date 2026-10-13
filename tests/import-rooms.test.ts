import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRooms } from '../apps/api/src/cli/import-rooms';
import { addDays, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup } from './helpers';

let app: INestApplication;
let db: Database;
let http: ReturnType<typeof request>;
const data = JSON.parse(readFileSync('data/kvarc-rooms.json', 'utf8'));
const today = todayIn('Asia/Yekaterinburg');
const P = '/public/v1/test';

beforeAll(async () => {
  ({ app, db } = await setup());
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('загрузка номеров с сайта', () => {
  it('создаёт 4 категории, 12 номеров и тариф с завтраком; повтор ничего не дублирует', async () => {
    const first = await importRooms(db, 'test', data);
    expect(first.join('\n')).toContain('Комфорт: создана, фото 5, номеров добавлено 4');
    const again = await importRooms(db, 'test', data);
    expect(again.join('\n')).toContain('Комфорт: обновлена, фото 5, номеров добавлено 0');
    expect(again.join('\n')).toContain('условия отмены и оплаты обновлены');
    const units = await db.selectFrom('accommodation_unit').select('id').execute();
    expect(units).toHaveLength(12);
    const p = await db.selectFrom('property').select(['check_in_time', 'check_out_time']).where('code', '=', 'test').executeTakeFirstOrThrow();
    expect([p.check_in_time.slice(0, 5), p.check_out_time.slice(0, 5)]).toEqual(['17:00', '14:00']);
  });

  it('модуль бронирования показывает фото и описание, поздняя отмена удерживает одни сутки', async () => {
    const owner = await login(app, OWNER.email, OWNER.password);
    const types = (await owner.get('/admin/v1/accommodation-types')).body as { id: string; code: string }[];
    const plan = ((await owner.get('/admin/v1/rate-plans')).body as { id: string }[])[0];
    const comfort = types.find((t) => t.code === 'comfort')!;
    await owner.post('/admin/v1/rate-rules', { ratePlanId: plan.id, accommodationTypeId: comfort.id, from: today, to: addDays(today, 30), priceMinor: 600_000 });
    await owner.post('/admin/v1/rate-rules', { ratePlanId: plan.id, accommodationTypeId: comfort.id, from: addDays(today, 1), to: addDays(today, 2), priority: 5, priceMinor: 800_000 });

    const offers = await http.get(`${P}/offers?arrival=${addDays(today, 1)}&departure=${addDays(today, 3)}&adults=2`);
    const room = offers.body.find((r: { accommodationType: { id: string } }) => r.accommodationType.id === comfort.id);
    expect(room.accommodationType.photos[0]).toEqual({ url: '/rooms/comfort/1.webp', alt: 'Номер Комфорт с собственной террасой, база отдыха Кварц' });
    expect(room.accommodationType.description).toContain('собственной террасой');
    expect(room.offers[0].ratePlan).toMatchObject({ mealPlan: 'breakfast' });

    // Заезд сегодня: отмена в день заезда удерживает стоимость первой ночи (6 000 ₽), а не процент
    const late = await http.post(`${P}/bookings`).send({
      accommodationTypeId: comfort.id, ratePlanId: plan.id, arrival: today, departure: addDays(today, 3), adults: 2,
      guest: { lastName: 'Орлова', firstName: 'Анна', phone: '+79001112234', email: 'orlova@example.com' },
      consents: { pdProcessing: true }, idempotencyKey: randomUUID(),
    });
    expect(late.status).toBe(201);
    await http.post(`/public/v1/sandbox/pay/${late.body.confirmationUrl.split('/').pop()}?outcome=succeeded`);
    const info = await http.get(`${P}/bookings/${late.body.manageToken}`);
    expect(info.body.status).toBe('confirmed');
    expect(info.body.cancellation.penaltyMinor).toBe(600_000);
  });

  it('отмена в сезон менее чем за 2 недели оставляет оплату на депозите гостя (оферта п.5)', async () => {
    const owner = await login(app, OWNER.email, OWNER.password);
    const plan = ((await owner.get('/admin/v1/rate-plans')).body as { id: string; deposit_policy: unknown }[])[0];
    expect(plan.deposit_policy).toEqual(data.ratePlan.depositPolicy);
    const comfort = ((await owner.get('/admin/v1/accommodation-types')).body as { id: string; code: string }[]).find((t) => t.code === 'comfort')!;
    // Сезон, в который попадает ближайший заезд, чтобы проверить правило в любой день года
    const arrival = addDays(today, 5);
    const md = (d: string) => d.slice(5);
    const terms = await owner.put(`/admin/v1/rate-plans/${plan.id}/terms`, {
      cancellationPolicy: data.ratePlan.cancellationPolicy,
      prepaymentPolicy: data.ratePlan.prepaymentPolicy,
      depositPolicy: { days_before: 14, seasons: [{ name: 'Тестовый сезон', from: md(addDays(today, 1)), to: md(addDays(today, 10)) }] },
    });
    expect(terms.status).toBe(200);
    const bad = await owner.put(`/admin/v1/rate-plans/${plan.id}/terms`, {
      cancellationPolicy: data.ratePlan.cancellationPolicy,
      prepaymentPolicy: data.ratePlan.prepaymentPolicy,
      depositPolicy: { days_before: 14, seasons: [{ name: 'x', from: '6-1', to: '08-31' }] },
    });
    expect(bad.status).toBe(422);

    const offers = await http.get(`${P}/offers?arrival=${arrival}&departure=${addDays(arrival, 2)}&adults=2`);
    const room = offers.body.find((r: { accommodationType: { id: string } }) => r.accommodationType.id === comfort.id);
    expect(room.offers[0].depositRule).toEqual({ season: 'Тестовый сезон', daysBefore: 14 });

    const r = await http.post(`${P}/bookings`).send({
      accommodationTypeId: comfort.id, ratePlanId: plan.id, arrival, departure: addDays(arrival, 2), adults: 2,
      guest: { lastName: 'Лето', firstName: 'Ольга', phone: '+79001112299', email: 'leto@example.com' },
      consents: { pdProcessing: true }, idempotencyKey: randomUUID(),
    });
    expect(r.status).toBe(201);
    await http.post(`/public/v1/sandbox/pay/${r.body.confirmationUrl.split('/').pop()}?outcome=succeeded`);
    const info = await http.get(`${P}/bookings/${r.body.manageToken}`);
    const paid = info.body.paidMinor;
    expect(paid).toBeGreaterThan(0);
    expect(info.body.cancellation).toEqual({ penaltyMinor: 0, refundMinor: 0, depositMinor: paid });

    const c = await http.post(`${P}/bookings/${r.body.manageToken}/cancel`);
    expect(c.body).toMatchObject({ status: 'cancelled', paidMinor: paid, depositMinor: paid });
    const booking = await db.selectFrom('booking').select('id').where('number', '=', info.body.number).executeTakeFirstOrThrow();
    const card = await owner.get(`/admin/v1/bookings/${booking.id}`);
    expect(card.body.deposit).toMatchObject({ amount_minor: paid, balance_minor: paid, season: 'Тестовый сезон' });

    // Депозит зачитывается в новую бронь того же гостя
    const guestId = card.body.booker_guest_id;
    const next = await owner.post('/admin/v1/bookings', {
      accommodationTypeId: comfort.id, ratePlanId: plan.id, arrival: addDays(today, 20), departure: addDays(today, 22), adults: 2, childrenAges: [],
      status: 'pending_payment', channelCode: 'phone', idempotencyKey: randomUUID(), guestId,
    });
    expect(next.status).toBe(201);
    const nb = await owner.get(`/admin/v1/bookings/${next.body.id}`);
    expect(nb.body.available_deposits).toHaveLength(1);
    const dep = nb.body.available_deposits[0];
    const tooMuch = await owner.post(`/admin/v1/bookings/${next.body.id}/deposit-offsets`, { depositId: dep.id, amountMinor: paid + 1 });
    expect(tooMuch.status).toBe(422);
    const off = await owner.post(`/admin/v1/bookings/${next.body.id}/deposit-offsets`, { depositId: dep.id, amountMinor: paid });
    expect(off.status).toBe(201);
    const after = await owner.get(`/admin/v1/bookings/${next.body.id}`);
    expect(after.body).toMatchObject({ paid_minor: paid, status: 'confirmed', payment_state: 'partially_paid' });
    expect(after.body.available_deposits).toHaveLength(0);
    const pays = await owner.get(`/admin/v1/bookings/${next.body.id}/payments`);
    expect(pays.body[0]).toMatchObject({ method: 'guest_deposit', status: 'succeeded', amount_minor: paid });

    // Возвращаем условия из файла для остальных проверок
    await importRooms(db, 'test', data);
  });

  it('администратор меняет тариф целиком: название, условия, категории; выключенный тариф не продаётся на сайте', async () => {
    const owner = await login(app, OWNER.email, OWNER.password);
    const plan = ((await owner.get('/admin/v1/rate-plans')).body as { id: string; code: string; name: string }[])[0];
    const types = (await owner.get('/admin/v1/accommodation-types')).body as { id: string; code: string }[];
    const comfort = types.find((t) => t.code === 'comfort')!;
    const body = {
      code: plan.code, name: 'Летний с завтраком', mealPlan: 'breakfast', isRefundable: true, isPublic: true, isActive: true,
      cancellationPolicy: [{ days_before: 7, penalty_pct: 0 }, { days_before: 0, penalty_pct: 50 }],
      prepaymentPolicy: { pct: 50, due: 'at_booking' },
      depositPolicy: { days_before: 10, seasons: [{ name: 'Лето', from: '06-01', to: '08-31' }] },
      accommodationTypeIds: [comfort.id],
    };
    const r = await owner.put(`/admin/v1/rate-plans/${plan.id}`, body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ name: 'Летний с завтраком', prepayment_policy: { pct: 50 }, deposit_policy: { days_before: 10 }, accommodation_type_ids: [comfort.id] });
    const listed = ((await owner.get('/admin/v1/rate-plans')).body as { id: string; accommodation_type_ids: string[] }[]).find((p) => p.id === plan.id)!;
    expect(listed.accommodation_type_ids).toEqual([comfort.id]);

    const bad = await owner.put(`/admin/v1/rate-plans/${plan.id}`, { ...body, depositPolicy: { days_before: 10, seasons: [{ name: 'Лето', from: '1.6', to: '31.8' }] } });
    expect(bad.status).toBe(422);

    const arrival = addDays(today, 40);
    const offers = async () => (await http.get(`/public/v1/test/offers?arrival=${arrival}&departure=${addDays(arrival, 2)}&adults=2`)).body;
    await owner.post('/admin/v1/rate-rules', { ratePlanId: plan.id, accommodationTypeId: comfort.id, from: arrival, to: addDays(arrival, 2), priceMinor: 500_000 });
    expect(JSON.stringify(await offers())).toContain('Летний с завтраком');
    await owner.put(`/admin/v1/rate-plans/${plan.id}`, { ...body, isActive: false }).then((x) => expect(x.status).toBe(200));
    expect(JSON.stringify(await offers())).not.toContain('Летний с завтраком');

    // Возвращаем тариф как был для остальных проверок
    await owner.put(`/admin/v1/rate-plans/${plan.id}`, { ...body, name: plan.name, isActive: true, accommodationTypeIds: types.map((t) => t.id) });
    await importRooms(db, 'test', data);
  });
});
