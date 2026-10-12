import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGuestApp } from '../apps/api/src/cli/import-guest-app';
import { importRooms } from '../apps/api/src/cli/import-rooms';
import { SMS_SENDER, type LogSmsSender } from '../apps/api/src/guest-app/sms';
import { addDays, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup } from './helpers';

let app: INestApplication;
let db: Database;
let http: ReturnType<typeof request>;
const today = todayIn('Asia/Yekaterinburg');
const G = '/guest/v1/test';
const ids: Record<string, string> = {};

beforeAll(async () => {
  ({ app, db } = await setup());
  http = request(app.getHttpServer());
  await importRooms(db, 'test', JSON.parse(readFileSync('data/kvarc-rooms.json', 'utf8')));
  await importGuestApp(db, 'test', JSON.parse(readFileSync('data/kvarc-guest-app.json', 'utf8')));
  const owner = await login(app, OWNER.email, OWNER.password);
  const types = (await owner.get('/admin/v1/accommodation-types')).body as { id: string; code: string }[];
  ids.comfort = types.find((t) => t.code === 'comfort')!.id;
  ids.plan = ((await owner.get('/admin/v1/rate-plans')).body as { id: string }[])[0].id;
  await owner.post('/admin/v1/rate-rules', { ratePlanId: ids.plan, accommodationTypeId: ids.comfort, from: today, to: addDays(today, 60), priceMinor: 600_000 });
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

const lastCode = (phone: string) => {
  const sms = (app.get(SMS_SENDER) as LogSmsSender).sent.filter((s) => s.phone === phone).pop();
  return sms!.text.match(/\d{6}/)![0];
};

async function signIn(phone: string) {
  await http.post(`${G}/auth/otp/request`).send({ phone }).expect(200);
  const r = await http.post(`${G}/auth/otp/verify`).send({ phone, code: lastCode('+7' + phone.replace(/\D/g, '').slice(-10)) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { guestId: string; accessToken: string; refreshToken: string; expiresInSeconds: number };
}

describe('гостевое приложение', () => {
  it('без входа отдаёт сведения о базе с фото кварц.рус и правила проживания', async () => {
    const p = await http.get(`${G}/property`).expect(200);
    expect(p.body).toMatchObject({ checkInTime: '17:00', checkOutTime: '14:00', phones: ['+79085870030', '+73512150030'], bookingUrl: 'http://book.test' });
    expect(p.body.unitTypes.map((t: { name: string }) => t.name)).toEqual(['Стандарт', 'Комфорт', 'Двухэтажные апартаменты', 'Семейный коттедж']);
    expect(p.body.unitTypes[1].photos[0]).toMatchObject({ url: 'http://book.test/rooms/comfort/1.webp', file: '1.webp' });
    expect(JSON.stringify(p.body)).not.toMatch(/uvildy\.ru/);

    const rules = await http.get(`${G}/documents/rules`).expect(200);
    expect(rules.body.sections).toHaveLength(10);
    const missing = await http.get(`${G}/documents/offer-x`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 'not_found', message: 'Документ не найден' });
  });

  it('вход по коду из SMS: неверный код не пускает, повторный запрос кода не раньше чем через минуту', async () => {
    const no = await http.get(`${G}/bookings/my`);
    expect(no.status).toBe(401);
    expect(no.body.error.code).toBe('unauthorized');

    await http.post(`${G}/auth/otp/request`).send({ phone: '8 (900) 555-00-01' }).expect(200);
    const again = await http.post(`${G}/auth/otp/request`).send({ phone: '+79005550001' });
    expect(again.status).toBe(429);
    const code = lastCode('+79005550001');
    const wrong = await http.post(`${G}/auth/otp/verify`).send({ phone: '+79005550001', code: code === '000000' ? '111111' : '000000' });
    expect(wrong.body.error.code).toBe('invalid_code');
    const ok = await http.post(`${G}/auth/otp/verify`).send({ phone: '89005550001', code });
    expect(ok.status).toBe(200);
    // Код одноразовый
    const reuse = await http.post(`${G}/auth/otp/verify`).send({ phone: '+79005550001', code });
    expect(reuse.body.error.code).toBe('invalid_code');

    const bad = await http.post(`${G}/auth/otp/request`).send({ phone: '12345' });
    expect(bad.body.error.code).toBe('validation_error');
  });

  it('гость видит свою бронь по телефону, оплачивает предоплату и остаток через страницу банка', async () => {
    const b = await http.post('/public/v1/test/bookings').send({
      accommodationTypeId: ids.comfort, ratePlanId: ids.plan, arrival: addDays(today, 10), departure: addDays(today, 12), adults: 2,
      guest: { lastName: 'Орлова', firstName: 'Анна', phone: '+79001112233', email: 'orlova@example.com' },
      consents: { pdProcessing: true }, idempotencyKey: randomUUID(),
    });
    expect(b.status).toBe(201);

    const other = await signIn('+79009998877');
    expect((await http.get(`${G}/bookings/my`).set('authorization', `Bearer ${other.accessToken}`)).body).toEqual([]);

    const t = await signIn('8 900 111 22 33');
    const auth = { authorization: `Bearer ${t.accessToken}` };
    const list = await http.get(`${G}/bookings/my`).set(auth).expect(200);
    expect(list.body).toHaveLength(1);
    const my = list.body[0];
    expect(my).toMatchObject({ number: b.body.number, status: 'pending_payment', totalAmount: 1_200_000, paidAmount: 0, balanceDue: 1_200_000, checkinStatusLabel: 'Регистрация не начата', currency: 'RUB' });
    // Заезд в 17:00 по Екатеринбургу = 12:00 UTC
    expect(my.arrivalAt).toBe(`${addDays(today, 10)}T12:00:00.000Z`);
    expect(my.property.phone).toBe('+79085870030');

    // Чужая бронь недоступна
    const foreign = await http.post(`${G}/payments`).set('authorization', `Bearer ${other.accessToken}`).set('idempotency-key', randomUUID()).send({ purpose: 'booking', targetId: my.id });
    expect(foreign.status).toBe(404);

    const key = randomUUID();
    const pay = await http.post(`${G}/payments`).set(auth).set('idempotency-key', key).send({ purpose: 'booking', targetId: my.id });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    expect(pay.body).toMatchObject({ amount: 360_000, status: 'pending', demo: true });
    const same = await http.post(`${G}/payments`).set(auth).set('idempotency-key', key).send({ purpose: 'booking', targetId: my.id });
    expect(same.body.id).toBe(pay.body.id);

    await http.post(`/public/v1/sandbox/pay/${pay.body.confirmationUrl.split('/').pop()}?outcome=succeeded`);
    const done = await http.get(`${G}/payments/${pay.body.id}`).set(auth).expect(200);
    expect(done.body).toMatchObject({ status: 'succeeded', confirmationUrl: null });
    const after = (await http.get(`${G}/bookings/my`).set(auth)).body[0];
    expect(after).toMatchObject({ status: 'confirmed', paidAmount: 360_000, balanceDue: 840_000 });

    const rest = await http.post(`${G}/payments`).set(auth).set('idempotency-key', randomUUID()).send({ purpose: 'booking', targetId: my.id });
    expect(rest.body.amount).toBe(840_000);

    const service = await http.post(`${G}/payments`).set(auth).set('idempotency-key', randomUUID()).send({ purpose: 'service_booking', targetId: my.id });
    expect(service.body.error.code).toBe('not_available');

    expect((await http.get(`${G}/services`).set(auth)).body).toEqual([]);
    const back = await http.get('/guest/v1/payment-return');
    expect(back.status).toBe(302);
    expect(back.headers.location).toBe('qvarc://payment-return');
  });

  it('токен обновления одноразовый: повтор старого закрывает все сессии гостя', async () => {
    const t = await signIn('+79004443322');
    const r1 = await http.post(`${G}/auth/refresh`).send({ refreshToken: t.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(t.refreshToken);
    await http.get(`${G}/bookings/my`).set('authorization', `Bearer ${t.accessToken}`).expect(401);
    await http.get(`${G}/bookings/my`).set('authorization', `Bearer ${r1.body.accessToken}`).expect(200);

    const stolen = await http.post(`${G}/auth/refresh`).send({ refreshToken: t.refreshToken });
    expect(stolen.status).toBe(401);
    await http.post(`${G}/auth/refresh`).send({ refreshToken: r1.body.refreshToken }).expect(401);

    const t2 = await signIn('+79004443300');
    await http.post(`${G}/auth/logout`).set('authorization', `Bearer ${t2.accessToken}`).send({ refreshToken: t2.refreshToken }).expect(200);
    await http.post(`${G}/auth/refresh`).send({ refreshToken: t2.refreshToken }).expect(401);
  });
});
