import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HoldsService } from '../apps/api/src/bookings/holds.service';
import { PAYMENT_PROVIDER } from '../apps/api/src/payments/provider';
import type { SandboxProvider } from '../apps/api/src/payments/sandbox.provider';
import { addDays, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup, type Session } from './helpers';

let app: INestApplication;
let db: Database;
let owner: Session;
let http: ReturnType<typeof request>;
const today = todayIn('Asia/Yekaterinburg');
const d = (n: number) => addDays(today, 30 + n);
const ids: Record<string, string> = {};
const P = '/public/v1/test';

beforeAll(async () => {
  ({ app, db } = await setup());
  http = request(app.getHttpServer());
  owner = await login(app, OWNER.email, OWNER.password);
  ids.std = (await owner.post('/admin/v1/accommodation-types', {
    code: 'std', name: 'Стандарт', kind: 'room', baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3,
  })).body.id;
  for (const name of ['1', '2']) ids[`u${name}`] = (await owner.post('/admin/v1/units', { accommodationTypeId: ids.std, name })).body.id;
  ids.plan = (await owner.post('/admin/v1/rate-plans', {
    code: 'flex', name: 'Гибкий', accommodationTypeIds: [ids.std],
    cancellationPolicy: [{ days_before: 7, penalty_pct: 0 }, { days_before: 0, penalty_pct: 50 }],
    prepaymentPolicy: { pct: 30, due: 'at_booking' },
  })).body.id;
  ids.hidden = (await owner.post('/admin/v1/rate-plans', {
    code: 'staff', name: 'Для своих', isPublic: false, accommodationTypeIds: [ids.std],
    cancellationPolicy: [{ days_before: 0, penalty_pct: 0 }], prepaymentPolicy: { pct: 0, due: 'at_booking' },
  })).body.id;
  for (const plan of [ids.plan, ids.hidden]) {
    const r = await owner.post('/admin/v1/rate-rules', { ratePlanId: plan, accommodationTypeId: ids.std, from: today, to: addDays(today, 400), priceMinor: 500_000 });
    expect(r.status).toBe(201);
  }
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

const body = (over: Record<string, unknown> = {}) => ({
  accommodationTypeId: ids.std, ratePlanId: ids.plan, arrival: d(0), departure: d(2), adults: 2,
  guest: { lastName: 'Петров', firstName: 'Пётр', phone: '+79001112233', email: 'petrov@example.com' },
  consents: { pdProcessing: true, marketing: false },
  idempotencyKey: randomUUID(),
  ...over,
});
const sandbox = () => app.get<SandboxProvider>(PAYMENT_PROVIDER);
const providerId = (url: string) => url.split('/').pop()!;
/** Нажатие кнопки на тестовой странице оплаты */
const payOnPage = (url: string, outcome: 'succeeded' | 'failed') => http.post(`/public/v1/sandbox/pay/${providerId(url)}?outcome=${outcome}`);
const bookingRow = (number: string) => db.selectFrom('booking').selectAll().where('number', '=', number).executeTakeFirstOrThrow();

describe('поиск на сайте', () => {
  it('показывает цену и предоплату только по публичным тарифам', async () => {
    const r = await http.get(`${P}/offers?arrival=${d(0)}&departure=${d(2)}&adults=2`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    const offers = r.body[0].offers;
    expect(offers.map((o: { ratePlan: { id: string } }) => o.ratePlan.id)).toEqual([ids.plan]);
    expect(offers[0]).toMatchObject({ bookable: true, totalMinor: 1_000_000, prepaymentDueMinor: 300_000 });
    expect(r.body[0]).not.toHaveProperty('freeUnits');
  });
  it('скрытый тариф нельзя забронировать с сайта', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ ratePlanId: ids.hidden }));
    expect(r.status).toBe(404);
  });
  it('без согласия на обработку ПДн бронь не создаётся', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ consents: { pdProcessing: false } }));
    expect(r.status).toBe(400);
  });
});

describe('бронь и оплата', () => {
  it('бронь удерживает номер до оплаты, оплата подтверждает её, чек и письмо в очереди', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ consents: { pdProcessing: true, marketing: true } }));
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending_payment');
    expect(r.body.confirmationUrl).toContain('/public/v1/sandbox/pay/');
    let b = await bookingRow(r.body.number);
    expect(b.hold_expires_at).not.toBeNull();

    const before = await http.get(`${P}/bookings/${r.body.manageToken}`);
    expect(before.body).toMatchObject({ status: 'pending_payment', canPay: true, paidMinor: 0 });

    const pay = await payOnPage(r.body.confirmationUrl, 'succeeded');
    expect(pay.status).toBe(303);
    expect(pay.headers.location).toBe(`http://book.test/b/${r.body.manageToken}`);

    b = await bookingRow(r.body.number);
    expect(b.status).toBe('confirmed');
    expect(b.payment_state).toBe('partially_paid');
    expect(b.hold_expires_at).toBeNull();
    const receipts = await db.selectFrom('fiscal_receipt as f').innerJoin('payment as p', 'p.id', 'f.payment_id').select(['f.receipt_type', 'f.status']).where('p.booking_id', '=', b.id).execute();
    expect(receipts).toEqual([{ receipt_type: 'prepayment', status: 'registered' }]);
    const note = await db.selectFrom('notification').select('template_code').where('booking_id', '=', b.id).execute();
    expect(note).toEqual([{ template_code: 'booking_confirmed' }]);
    const consents = await db.selectFrom('guest_consent').select('kind').where('guest_id', '=', b.booker_guest_id).orderBy('kind').execute();
    expect(consents.map((c) => c.kind)).toEqual(['marketing_email', 'pd_processing']);

    const after = await http.get(`${P}/bookings/${r.body.manageToken}`);
    expect(after.body).toMatchObject({ status: 'confirmed', paidMinor: 300_000, canPay: false });
  });

  it('повтор уведомления эквайера ничего не меняет, поддельное отклоняется', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ arrival: d(10), departure: d(11) }));
    const id = providerId(r.body.confirmationUrl);
    const ev = sandbox().complete(id, 'succeeded')!;
    const send = () => http.post('/public/v1/payments/webhook').set('content-type', 'application/json').set('x-sandbox-signature', ev.signature).send(ev.body.toString());
    expect((await send()).status).toBe(200);
    expect((await send()).body).toMatchObject({ duplicate: true });
    const fake = await http.post('/public/v1/payments/webhook').set('content-type', 'application/json').set('x-sandbox-signature', 'x'.repeat(64)).send(ev.body.toString());
    expect(fake.status).toBe(422);
    const b = await bookingRow(r.body.number);
    const payments = await db.selectFrom('payment').select(['status']).where('booking_id', '=', b.id).execute();
    expect(payments).toEqual([{ status: 'succeeded' }]);
    expect(b.status).toBe('confirmed');
  });

  it('отказ банка оставляет бронь неоплаченной, гость может оплатить ещё раз', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ arrival: d(20), departure: d(21) }));
    await payOnPage(r.body.confirmationUrl, 'failed');
    expect((await bookingRow(r.body.number)).status).toBe('pending_payment');
    const retry = await http.post(`${P}/bookings/${r.body.manageToken}/pay`).send({ attemptKey: randomUUID() });
    expect(retry.status).toBe(200);
    expect(retry.body.confirmationUrl).not.toBe(r.body.confirmationUrl);
    await payOnPage(retry.body.confirmationUrl, 'succeeded');
    expect((await bookingRow(r.body.number)).status).toBe('confirmed');
  });

  it('двойная отправка формы создаёт одну бронь и один платёж', async () => {
    const b = body({ arrival: d(30), departure: d(31) });
    const [a, c] = await Promise.all([http.post(`${P}/bookings`).send(b), http.post(`${P}/bookings`).send(b)]);
    expect([a.status, c.status].sort()).toEqual([201, 409]);
    const n = await db.selectFrom('booking').select((eb) => eb.fn.countAll<string>().as('n')).where('arrival', '=', d(30)).executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(1);
  });

  it('из пяти одновременных броней на два номера проходят две', async () => {
    const res = await Promise.all(Array.from({ length: 5 }, () => http.post(`${P}/bookings`).send(body({ arrival: d(40), departure: d(42) }))));
    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    expect(res.filter((r) => r.status === 409)).toHaveLength(3);
  });
});

describe('удержание и поздняя оплата', () => {
  it('просроченное удержание снимается и освобождает номер', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ arrival: d(50), departure: d(51) }));
    await db.updateTable('booking').set({ hold_expires_at: new Date(Date.now() - 1000) }).where('number', '=', r.body.number).execute();
    expect(await app.get(HoldsService).expireDue()).toBe(1);
    const b = await bookingRow(r.body.number);
    expect(b.status).toBe('expired');
    const stay = await db.selectFrom('booking_stay').select('is_active').where('booking_id', '=', b.id).executeTakeFirstOrThrow();
    expect(stay.is_active).toBe(false);
    const pay = await db.selectFrom('payment').select('status').where('booking_id', '=', b.id).execute();
    expect(pay).toEqual([{ status: 'cancelled' }]);
  });

  it('оплата, прошедшая до снятия удержания, подтверждает бронь, а не снимает её', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ arrival: d(52), departure: d(53) }));
    sandbox().complete(providerId(r.body.confirmationUrl), 'succeeded'); // уведомление потерялось
    await db.updateTable('booking').set({ hold_expires_at: new Date(Date.now() - 1000) }).where('number', '=', r.body.number).execute();
    expect(await app.get(HoldsService).expireDue()).toBe(0);
    expect((await bookingRow(r.body.number)).status).toBe('confirmed');
  });

  it('поздняя оплата: номер занят — деньги возвращаются полностью', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ arrival: d(60), departure: d(61) }));
    const b0 = await bookingRow(r.body.number);
    // Удержание снято вручную (как будто задача отработала), а эквайер оплату ещё не закрыл
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('booking').set({ status: 'expired' }).where('id', '=', b0.id).execute();
    });
    // Оба номера заняли
    for (const unitId of [ids.u1, ids.u2]) {
      const x = await owner.post('/admin/v1/bookings', {
        guest: { lastName: 'Другой', firstName: 'Гость' }, accommodationTypeId: ids.std, ratePlanId: ids.plan, unitId, arrival: d(60), departure: d(61), adults: 1,
      });
      expect(x.status).toBe(201);
    }
    await payOnPage(r.body.confirmationUrl, 'succeeded');
    const b = await bookingRow(r.body.number);
    expect(b.status).toBe('expired');
    expect(b.payment_state).toBe('refunded');
    const refunds = await db.selectFrom('refund as r').innerJoin('payment as p', 'p.id', 'r.payment_id').select(['r.status', 'r.amount_minor']).where('p.booking_id', '=', b.id).execute();
    expect(refunds).toEqual([{ status: 'succeeded', amount_minor: 150_000 }]);
  });
});

describe('отмена гостем', () => {
  it('ранняя отмена: удержания нет, предоплата возвращается полностью', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ arrival: d(70), departure: d(72) }));
    await payOnPage(r.body.confirmationUrl, 'succeeded');
    const info = await http.get(`${P}/bookings/${r.body.manageToken}`);
    expect(info.body.cancellation).toEqual({ penaltyMinor: 0, refundMinor: 300_000, depositMinor: 0 });
    const c = await http.post(`${P}/bookings/${r.body.manageToken}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: 'cancelled', paidMinor: 0, paymentState: 'refunded' });
    const audit = await db.selectFrom('audit_log').select('action').where('action', 'like', 'refund.%').execute();
    expect(audit.length).toBeGreaterThan(0);
  });

  it('поздняя отмена: удерживается 50%, предоплата 30% не возвращается', async () => {
    const r = await http.post(`${P}/bookings`).send(body({ arrival: d(80), departure: d(82) }));
    await payOnPage(r.body.confirmationUrl, 'succeeded');
    const b = await bookingRow(r.body.number);
    // Переносим заезд на сегодня, чтобы сработала ступень «в день заезда»
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('booking').set({ arrival: today, departure: addDays(today, 2) }).where('id', '=', b.id).execute();
    });
    const info = await http.get(`${P}/bookings/${r.body.manageToken}`);
    expect(info.body.cancellation).toEqual({ penaltyMinor: 500_000, refundMinor: 0, depositMinor: 0 });
    const c = await http.post(`${P}/bookings/${r.body.manageToken}/cancel`);
    expect(c.body).toMatchObject({ status: 'cancelled', paidMinor: 300_000 });
  });

  it('чужая или выдуманная ссылка не открывает бронь', async () => {
    const r = await http.get(`${P}/bookings/${'A'.repeat(43)}`);
    expect(r.status).toBe(404);
  });
});
