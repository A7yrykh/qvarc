import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SberProvider } from '../apps/api/src/payments/sber.provider';
import { addDays, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup } from './helpers';

/**
 * Поддельный шлюз Сбера: принимает те же методы и отвечает в том же формате,
 * что и настоящий (register.do, getOrderStatusExtended.do, refund.do, decline.do).
 */
interface Order { orderNumber: string; amount: number; status: number; refunded: number }
const orders = new Map<string, Order>();
const calls: { method: string; params: Record<string, string> }[] = [];
let gateway: Server;
let gatewayUrl = '';

function startGateway() {
  gateway = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const method = req.url!.split('/').pop()!;
      const p = JSON.parse(raw) as Record<string, string>;
      calls.push({ method, params: p });
      const send = (o: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (p.userName !== 'qvarc-api' || p.password !== 'secret') return send({ errorCode: '5', errorMessage: 'Доступ запрещён' });
      if (method === 'register.do') {
        if ([...orders.values()].some((o) => o.orderNumber === p.orderNumber)) return send({ errorCode: '1', errorMessage: 'Заказ с таким номером уже обработан' });
        const id = randomUUID();
        orders.set(id, { orderNumber: p.orderNumber, amount: Number(p.amount), status: 0, refunded: 0 });
        return send({ orderId: id, formUrl: `https://ecomtest.sberbank.ru/payment/merchants/sbersafe/payment_ru.html?mdOrder=${id}` });
      }
      if (method === 'getOrderStatusExtended.do') {
        const entry = p.orderId ? [p.orderId, orders.get(p.orderId)] : [...orders.entries()].find(([, o]) => o.orderNumber === p.orderNumber) ?? [];
        const [id, o] = entry as [string, Order | undefined];
        if (!o) return send({ errorCode: '6', errorMessage: 'Заказ не найден' });
        return send({ errorCode: '0', orderId: id, orderNumber: o.orderNumber, orderStatus: o.status, amount: o.amount, paymentAmountInfo: { refundedAmount: o.refunded } });
      }
      if (method === 'refund.do') {
        const o = orders.get(p.orderId);
        if (!o || (o.status !== 2 && o.status !== 4) || o.refunded + Number(p.amount) > o.amount) return send({ errorCode: '7', errorMessage: 'Неверная сумма' });
        o.refunded += Number(p.amount);
        o.status = 4;
        return send({ errorCode: '0' });
      }
      if (method === 'decline.do') {
        const o = orders.get(p.orderId);
        if (o && o.status === 0) o.status = 6;
        return send({ errorCode: '0' });
      }
      send({ errorCode: '7', errorMessage: 'Неизвестный метод' });
    });
  });
  return new Promise<void>((r) => gateway.listen(0, '127.0.0.1', () => { gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}/ecomm/gw/partner/api/v1/`; r(); }));
}

/** Банк проводит оплату и шлёт уведомление, как настоящий шлюз: GET с контрольной суммой */
function bankPays(orderId: string, secret: string) {
  const o = orders.get(orderId)!;
  o.status = 2;
  const params = { mdOrder: orderId, orderNumber: o.orderNumber, operation: 'deposited', status: '1' };
  return new URLSearchParams({ ...params, checksum: SberProvider.checksum(params, secret) }).toString();
}

const SECRET = 'callback-key';
let app: INestApplication;
let db: Database;
let http: ReturnType<typeof request>;
const today = todayIn('Asia/Yekaterinburg');
const d = (n: number) => addDays(today, 40 + n);
const ids: Record<string, string> = {};
const P = '/public/v1/test';

beforeAll(async () => {
  await startGateway();
  ({ app, db } = await setup({
    provider: 'sber',
    sandboxSecret: 'unused',
    sber: { apiUrl: gatewayUrl, userName: 'qvarc-api', password: 'secret', format: 'json', callbackSecret: SECRET, sessionTimeoutSecs: 1200 },
  }));
  http = request(app.getHttpServer());
  const owner = await login(app, OWNER.email, OWNER.password);
  ids.std = (await owner.post('/admin/v1/accommodation-types', { code: 'std', name: 'Стандарт', kind: 'room', baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3 })).body.id;
  await owner.post('/admin/v1/units', { accommodationTypeId: ids.std, name: '1' });
  ids.plan = (await owner.post('/admin/v1/rate-plans', {
    code: 'flex', name: 'Гибкий', accommodationTypeIds: [ids.std],
    cancellationPolicy: [{ days_before: 7, penalty_pct: 0 }, { days_before: 0, penalty_pct: 50 }],
    prepaymentPolicy: { pct: 30, due: 'at_booking' },
  })).body.id;
  await owner.post('/admin/v1/rate-rules', { ratePlanId: ids.plan, accommodationTypeId: ids.std, from: today, to: addDays(today, 400), priceMinor: 500_000 });
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
  gateway?.close();
});

const book = () => http.post(`${P}/bookings`).send({
  accommodationTypeId: ids.std, ratePlanId: ids.plan, arrival: d(0), departure: d(2), adults: 2,
  guest: { lastName: 'Петров', firstName: 'Пётр', phone: '+79001112233', email: 'petrov@example.com' },
  consents: { pdProcessing: true, marketing: false }, idempotencyKey: randomUUID(),
});

describe('оплата через Сбер', () => {
  it('регистрирует заказ, ведёт гостя на страницу банка, уведомление подтверждает бронь, отмена возвращает деньги', async () => {
    const r = await book();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.confirmationUrl).toContain('ecomtest.sberbank.ru');
    const reg = calls.find((c) => c.method === 'register.do')!;
    expect(reg.params).toMatchObject({ amount: '300000', currency: '643', phone: '79001112233', email: 'petrov@example.com', returnUrl: `http://book.test/b/${r.body.manageToken}` });
    const pay = await db.selectFrom('payment').selectAll().where('provider', '=', 'sber').executeTakeFirstOrThrow();
    expect(reg.params.orderNumber).toBe(pay.id);

    const qs = bankPays(pay.provider_payment_id!, SECRET);
    const hook = await http.get(`/public/v1/payments/webhook?${qs}`);
    expect(hook.status).toBe(200);
    const again = await http.get(`/public/v1/payments/webhook?${qs}`);
    expect(again.body.duplicate).toBe(true);
    const info = await http.get(`${P}/bookings/${r.body.manageToken}`);
    expect(info.body).toMatchObject({ status: 'confirmed', paidMinor: 300_000 });

    const c = await http.post(`${P}/bookings/${r.body.manageToken}/cancel`);
    expect(c.body.status).toBe('cancelled');
    const refund = calls.filter((x) => x.method === 'refund.do');
    expect(refund).toHaveLength(1);
    expect(refund[0].params).toMatchObject({ orderId: pay.provider_payment_id, amount: '300000' });
    expect(orders.get(pay.provider_payment_id!)!.refunded).toBe(300_000);
  });

  it('уведомление с чужой контрольной суммой отклоняется и ничего не меняет', async () => {
    const r = await book();
    const pay = await db.selectFrom('payment').selectAll().where('booking_id', '=', (await db.selectFrom('booking').select('id').where('number', '=', r.body.number).executeTakeFirstOrThrow()).id).executeTakeFirstOrThrow();
    const qs = bankPays(pay.provider_payment_id!, 'wrong-key');
    const hook = await http.get(`/public/v1/payments/webhook?${qs}`);
    expect(hook.status).toBe(422);
    const b = await db.selectFrom('booking').select('status').where('number', '=', r.body.number).executeTakeFirstOrThrow();
    expect(b.status).toBe('pending_payment');
    // Гость вернулся со страницы банка: сверка по запросу статуса подтверждает бронь и без уведомления
    const info = await http.get(`${P}/bookings/${r.body.manageToken}`);
    expect(info.body.status).toBe('confirmed');
    await http.post(`${P}/bookings/${r.body.manageToken}/cancel`);
  });
});

describe('SberProvider', () => {
  const provider = () => new SberProvider({ apiUrl: gatewayUrl, userName: 'qvarc-api', password: 'secret', format: 'json', sessionTimeoutSecs: 1200 });
  const receipt = { customer: { email: null, phone: null }, items: [], totalMinor: 100 };

  it('повторная регистрация того же платежа возвращает уже созданный заказ', async () => {
    const id = randomUUID();
    const a = await provider().createPayment({ paymentId: id, amountMinor: 100, description: 'x', idempotencyKey: id, returnUrl: 'http://book.test/b/x', receipt });
    const b = await provider().createPayment({ paymentId: id, amountMinor: 100, description: 'x', idempotencyKey: id, returnUrl: 'http://book.test/b/x', receipt });
    expect(b.providerPaymentId).toBe(a.providerPaymentId);
  });

  it('переводит коды статусов банка', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(SberProvider.mapStatus)).toEqual(['pending', 'pending', 'succeeded', 'cancelled', 'succeeded', 'pending', 'failed']);
  });

  it('ошибка доступа к шлюзу не выдаётся за успех', async () => {
    const bad = new SberProvider({ apiUrl: gatewayUrl, userName: 'qvarc-api', password: 'wrong', format: 'json', sessionTimeoutSecs: 1200 });
    await expect(bad.createPayment({ paymentId: randomUUID(), amountMinor: 100, description: 'x', idempotencyKey: 'k', returnUrl: 'http://x', receipt })).rejects.toThrow(/register\.do: 5/);
  });

  it('контрольная сумма: параметры по алфавиту, «имя;значение;», HMAC-SHA256', () => {
    const sum = SberProvider.checksum({ status: '1', mdOrder: 'abc', operation: 'deposited', orderNumber: '42', checksum: 'ignored' }, 'k');
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    expect(sum).toBe(createHmac('sha256', 'k').update('mdOrder;abc;operation;deposited;orderNumber;42;status;1;').digest('hex').toUpperCase());
  });
});
