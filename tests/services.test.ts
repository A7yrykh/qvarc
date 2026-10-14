import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAIL_SENDER, type LogMailSender } from '../apps/api/src/common/mail';
import { addDays, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup, type Session } from './helpers';

let app: INestApplication;
let db: Database;
let owner: Session;
let http: ReturnType<typeof request>;
const today = todayIn('Asia/Yekaterinburg');
const d = (n: number) => addDays(today, 30 + n);
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:00`;
const ids: Record<string, string> = {};
const P = '/public/v1/test';
const G = '/guest/v1/test';
const EMAIL = 'sidorov@example.com';

beforeAll(async () => {
  ({ app, db } = await setup());
  http = request(app.getHttpServer());
  owner = await login(app, OWNER.email, OWNER.password);
  ids.std = (await owner.post('/admin/v1/accommodation-types', {
    code: 'std', name: 'Стандарт', kind: 'room', baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3,
  })).body.id;
  for (const name of ['1', '2', '3']) await owner.post('/admin/v1/units', { accommodationTypeId: ids.std, name });
  ids.plan = (await owner.post('/admin/v1/rate-plans', {
    code: 'flex', name: 'Гибкий', accommodationTypeIds: [ids.std],
    cancellationPolicy: [{ days_before: 0, penalty_pct: 50 }],
    prepaymentPolicy: { pct: 30, due: 'at_booking' },
  })).body.id;
  await owner.post('/admin/v1/rate-rules', { ratePlanId: ids.plan, accommodationTypeId: ids.std, from: today, to: addDays(today, 400), priceMinor: 500_000 });
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

/** Бронь на сайте на 2 ночи с оплаченной предоплатой; возвращает ссылку гостя */
async function paidBooking(arrival = d(0), email = EMAIL) {
  const r = await http.post(`${P}/bookings`).send({
    accommodationTypeId: ids.std, ratePlanId: ids.plan, arrival, departure: addDays(arrival, 2), adults: 2,
    guest: { lastName: 'Сидоров', firstName: 'Иван', phone: '+79003334455', email },
    consents: { pdProcessing: true, marketing: false },
    idempotencyKey: randomUUID(),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await http.post(`/public/v1/sandbox/pay/${r.body.confirmationUrl.split('/').pop()}?outcome=succeeded`).expect(303);
  const b = await db.selectFrom('booking').select(['id', 'total_minor']).where('number', '=', r.body.number).executeTakeFirstOrThrow();
  return { token: r.body.manageToken as string, id: b.id };
}

describe('каталог в админке', () => {
  it('прокат: тип оборудования, единицы и услуга с записью на время; заявка без оборудования', async () => {
    const sup = await owner.post('/admin/v1/equipment-types', { name: 'Сап-борд', depositMinor: 0, bufferMinutes: 15 });
    expect(sup.status, JSON.stringify(sup.body)).toBe(201);
    ids.sup = sup.body.id;
    for (const no of ['SUP-1', 'SUP-2']) expect((await owner.post(`/admin/v1/equipment-types/${ids.sup}/units`, { inventoryNo: no })).status).toBe(201);

    const noDuration = await owner.post('/admin/v1/services', { category: 'rental', name: 'Сап', priceMinor: 150_000, equipmentTypeId: ids.sup });
    expect(noDuration.status).toBe(400);

    const rent = await owner.post('/admin/v1/services', {
      category: 'rental', name: 'Прокат сапа', pricing: 'per_hour', priceMinor: 150_000, durationMinutes: 60, equipmentTypeId: ids.sup,
      openTime: '09:00', closeTime: '20:00', maxQuantity: 2, cancellationText: 'Бесплатная отмена до начала',
    });
    expect(rent.status, JSON.stringify(rent.body)).toBe(201);
    ids.rent = rent.body.id;
    ids.sauna = (await owner.post('/admin/v1/services', { category: 'custom', name: 'Баня', priceMinor: 300_000, requiresConfirmation: true })).body.id;
    ids.hidden = (await owner.post('/admin/v1/services', { category: 'custom', name: 'Трансфер', priceMinor: 100_000, bookableOnline: false })).body.id;

    const eq = await owner.get('/admin/v1/equipment');
    expect(eq.body[0].units.map((u: { inventory_no: string }) => u.inventory_no)).toEqual(['SUP-1', 'SUP-2']);
    expect((await owner.get('/admin/v1/services')).body).toHaveLength(3);
  });

  it('гостю видны только услуги для онлайн-записи, по разделам', async () => {
    const r = await http.get(`${P}/services`).expect(200);
    expect(r.body.map((c: { name: string }) => c.name)).toEqual(['Прокат', 'Другое']);
    expect(r.body[0].services[0]).toMatchObject({ name: 'Прокат сапа', price: 150_000, bookingMode: 'slot', durationMinutes: 60, maxQuantity: 2 });
    expect(r.body[1].services.map((s: { name: string }) => s.name)).toEqual(['Баня']);
  });
});

describe('услуги к брони на сайте', () => {
  it('гость добавляет прокат к оплаченной брони, сумма брони растёт, оборудование занято', async () => {
    const { token, id } = await paidBooking();
    ids.token = token;
    ids.booking = id;
    const before = (await http.get(`${P}/bookings/${token}`)).body;
    expect(before).toMatchObject({ canAddServices: true, services: [], servicesDueMinor: 0, totalMinor: 1_000_000 });

    const slots = (await http.get(`${P}/services/${ids.rent}/slots?date=${d(1)}`)).body.slots;
    expect(slots[0]).toMatchObject({ available: 2 });
    expect(slots).toHaveLength(11); // 09:00 … 19:00

    const key = randomUUID();
    const add = () => http.post(`${P}/bookings/${token}/services`).send({ serviceId: ids.rent, startsAt: at(d(1), '10:00'), quantity: 2, idempotencyKey: key });
    const r = await add();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ totalMinor: 1_300_000, servicesDueMinor: 300_000 });
    expect(r.body.services).toHaveLength(1);
    expect(r.body.services[0]).toMatchObject({ name: 'Прокат сапа', status: 'confirmed', quantity: 2, amountMinor: 300_000, canCancel: true });
    // Повтор с тем же ключом не создаёт вторую бронь
    expect((await add()).body.services).toHaveLength(1);

    const busy = await http.post(`${P}/bookings/${token}/services`).send({ serviceId: ids.rent, startsAt: at(d(1), '10:30'), quantity: 1, idempotencyKey: randomUUID() });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('not_available');
    const slot = (await http.get(`${P}/services/${ids.rent}/slots?date=${d(1)}`)).body.slots.find((s: { startsAt: string }) => new Date(s.startsAt).getTime() === new Date(at(d(1), '10:00')).getTime());
    expect(slot.available).toBe(0);

    const outside = await http.post(`${P}/bookings/${token}/services`).send({ serviceId: ids.rent, startsAt: at(d(1), '20:00'), quantity: 1, idempotencyKey: randomUUID() });
    expect(outside.body.code).toBe('outside_hours');
    const afterStay = await http.post(`${P}/bookings/${token}/services`).send({ serviceId: ids.rent, startsAt: at(d(5), '10:00'), quantity: 1, idempotencyKey: randomUUID() });
    expect(afterStay.body.code).toBe('outside_stay');
    const hidden = await http.post(`${P}/bookings/${token}/services`).send({ serviceId: ids.hidden, idempotencyKey: randomUUID() });
    expect(hidden.body.code).toBe('not_online');
  });

  it('заявка на баню ждёт подтверждения администратора', async () => {
    const r = await http.post(`${P}/bookings/${ids.token}/services`).send({ serviceId: ids.sauna, startsAt: at(d(1), '18:00'), comment: 'на четверых', idempotencyKey: randomUUID() });
    expect(r.status).toBe(201);
    const sauna = r.body.services.find((s: { name: string }) => s.name === 'Баня');
    expect(sauna).toMatchObject({ status: 'requested', amountMinor: 300_000 });
    // В приложении заявке тоже предлагается время в часы работы
    const times = (await http.get(`${P}/services/${ids.sauna}/slots?date=${d(1)}`)).body.slots;
    expect(times).toHaveLength(12); // 09:00 … 20:00
    ids.saunaBooking = sauna.id;

    const day = (await owner.get(`/admin/v1/service-bookings?date=${d(1)}`)).body;
    expect(day.map((x: { service_name: string }) => x.service_name)).toEqual(['Прокат сапа', 'Баня']);
    expect(day[0].units).toBe('SUP-1, SUP-2');
    const ok = await owner.post(`/admin/v1/service-bookings/${ids.saunaBooking}/confirm`, {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('confirmed');
    expect((await owner.post(`/admin/v1/service-bookings/${ids.saunaBooking}/confirm`, {})).status).toBe(409);
  });

  it('гость отменяет услугу: строка уходит из брони, оборудование освобождается', async () => {
    const before = (await http.get(`${P}/bookings/${ids.token}`)).body;
    const rent = before.services.find((s: { name: string }) => s.name === 'Прокат сапа');
    const r = await http.post(`${P}/bookings/${ids.token}/services/${rent.id}/cancel`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.totalMinor).toBe(1_300_000);
    expect(r.body.services.find((s: { id: string }) => s.id === rent.id).status).toBe('cancelled');
    const slots = (await http.get(`${P}/services/${ids.rent}/slots?date=${d(1)}`)).body.slots;
    expect(Math.min(...slots.map((s: { available: number }) => s.available))).toBe(2);
  });

  it('услуги оплачиваются онлайн отдельно от проживания', async () => {
    const info = (await http.get(`${P}/bookings/${ids.token}`)).body;
    expect(info.servicesDueMinor).toBe(300_000);
    const r = await http.post(`${P}/bookings/${ids.token}/pay-services`).send({ attemptKey: randomUUID() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await http.post(`/public/v1/sandbox/pay/${r.body.confirmationUrl.split('/').pop()}?outcome=succeeded`).expect(303);
    const after = (await http.get(`${P}/bookings/${ids.token}`)).body;
    expect(after).toMatchObject({ paidMinor: 600_000, servicesDueMinor: 300_000 });
  });

  it('при отмене брони услуги отменяются, удержание считается только с проживания', async () => {
    const { token } = await paidBooking(addDays(today, 0));
    await http.post(`${P}/bookings/${token}/services`).send({ serviceId: ids.sauna, idempotencyKey: randomUUID() }).expect(201);
    const info = (await http.get(`${P}/bookings/${token}`)).body;
    expect(info.totalMinor).toBe(1_300_000);
    // Заезд сегодня: удержание 50% от проживания (1 000 000), а не от всей суммы с баней
    expect(info.cancellation).toMatchObject({ penaltyMinor: 500_000 });
    const r = await http.post(`${P}/bookings/${token}/cancel`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.services[0].status).toBe('cancelled');
  });
});

describe('услуги в приложении гостя', () => {
  const lastCode = () => (app.get(MAIL_SENDER) as LogMailSender).sent.filter((m) => m.to === EMAIL).pop()!.text.match(/\d{6}/)![0];
  let auth: { authorization: string };

  beforeAll(async () => {
    await http.post(`${G}/auth/otp/request`).send({ email: EMAIL }).expect(200);
    const r = await http.post(`${G}/auth/otp/verify`).send({ email: EMAIL, code: lastCode() }).expect(200);
    auth = { authorization: `Bearer ${r.body.accessToken}` };
  });

  it('каталог, свободное время и бронь проката к своей брони', async () => {
    const cats = (await http.get(`${G}/services`).set(auth)).body;
    expect(cats[0].services[0]).toMatchObject({ id: ids.rent, bookingMode: 'slot' });
    const slots = (await http.get(`${G}/services/${ids.rent}/slots?date=${d(1)}`).set(auth)).body;
    expect(slots).toMatchObject({ serviceId: ids.rent, date: d(1) });

    const key = randomUUID();
    const send = () => http.post(`${G}/service-bookings`).set(auth).set('idempotency-key', key).send({ serviceId: ids.rent, bookingId: ids.booking, startsAt: at(d(1), '12:00'), quantity: 1 });
    const r = await send();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'confirmed', quantity: 1, amount: 150_000, service: 'Прокат сапа', cancellationPolicy: 'Бесплатная отмена до начала', holdExpiresAt: null });
    expect(new Date(r.body.startsAt).getTime()).toBe(new Date(at(d(1), '12:00')).getTime());
    expect((await send()).body.id).toBe(r.body.id);
    ids.appBooking = r.body.id;

    const my = (await http.get(`${G}/service-bookings/my`).set(auth)).body;
    expect(my.map((x: { id: string }) => x.id)).toContain(r.body.id);
  });

  it('чужую бронь проживания указать нельзя', async () => {
    const other = await paidBooking(d(20), 'other@example.com');
    const r = await http.post(`${G}/service-bookings`).set(auth).set('idempotency-key', randomUUID()).send({ serviceId: ids.rent, bookingId: other.id, startsAt: at(d(21), '12:00'), quantity: 1 });
    expect(r.status).toBe(404);
  });

  it('оплата и отмена проката из приложения', async () => {
    const pay = await http.post(`${G}/payments`).set(auth).set('idempotency-key', randomUUID()).send({ purpose: 'service_booking', targetId: ids.appBooking });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    expect(pay.body.amount).toBe(150_000);

    const c = await http.post(`${G}/service-bookings/${ids.appBooking}/cancel`).set(auth);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.status).toBe('canceled');
  });
});
