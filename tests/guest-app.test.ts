import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGuestApp } from '../apps/api/src/cli/import-guest-app';
import { importRooms } from '../apps/api/src/cli/import-rooms';
import { MAIL_SENDER, type LogMailSender } from '../apps/api/src/common/mail';
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

const lastCode = (email: string) => {
  const mail = (app.get(MAIL_SENDER) as LogMailSender).sent.filter((m) => m.to === email).pop();
  return mail!.text.match(/\d{6}/)![0];
};

async function signIn(email: string) {
  await http.post(`${G}/auth/otp/request`).send({ email }).expect(200);
  const r = await http.post(`${G}/auth/otp/verify`).send({ email, code: lastCode(email.trim().toLowerCase()) });
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
    expect((await http.get(`${G}/documents/privacy`).expect(200)).body.sections).toHaveLength(10);
    // Те же документы открываются из формы брони на сайте
    const offer = await http.get('/public/v1/test/documents/offer').expect(200);
    expect(offer.body.title).toBe('Договор-оферта на оказание услуг проживания');
    const missing = await http.get(`${G}/documents/offer-x`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 'not_found', message: 'Документ не найден' });
  });

  it('вход по коду из письма: неверный код не пускает, повторный запрос кода не раньше чем через минуту', async () => {
    const no = await http.get(`${G}/bookings/my`);
    expect(no.status).toBe(401);
    expect(no.body.error.code).toBe('unauthorized');

    await http.post(`${G}/auth/otp/request`).send({ email: ' Guest1@Example.com ' }).expect(200);
    const again = await http.post(`${G}/auth/otp/request`).send({ email: 'guest1@example.com' });
    expect(again.status).toBe(429);
    const mail = (app.get(MAIL_SENDER) as LogMailSender).sent.filter((m) => m.to === 'guest1@example.com').pop()!;
    expect(mail.subject).toMatch(/^Код для входа: \d{6}$/);
    const code = lastCode('guest1@example.com');
    const wrong = await http.post(`${G}/auth/otp/verify`).send({ email: 'guest1@example.com', code: code === '000000' ? '111111' : '000000' });
    expect(wrong.body.error.code).toBe('invalid_code');
    const ok = await http.post(`${G}/auth/otp/verify`).send({ email: 'GUEST1@example.com', code });
    expect(ok.status).toBe(200);
    // Код одноразовый
    const reuse = await http.post(`${G}/auth/otp/verify`).send({ email: 'guest1@example.com', code });
    expect(reuse.body.error.code).toBe('invalid_code');

    const bad = await http.post(`${G}/auth/otp/request`).send({ email: 'не почта' });
    expect(bad.body.error.code).toBe('validation_error');
  });

  it('гость видит свою бронь по e-mail, оплачивает предоплату и остаток через страницу банка', async () => {
    const b = await http.post('/public/v1/test/bookings').send({
      accommodationTypeId: ids.comfort, ratePlanId: ids.plan, arrival: addDays(today, 10), departure: addDays(today, 12), adults: 2,
      guest: { lastName: 'Орлова', firstName: 'Анна', phone: '+79001112233', email: 'orlova@example.com' },
      consents: { pdProcessing: true }, idempotencyKey: randomUUID(),
    });
    expect(b.status).toBe(201);

    const other = await signIn('other@example.com');
    expect((await http.get(`${G}/bookings/my`).set('authorization', `Bearer ${other.accessToken}`)).body).toEqual([]);

    const t = await signIn('Orlova@Example.com');
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
    expect(service.body.error.code).toBe('not_found'); // услуги оплачиваются по брони услуги, а не по брони проживания

    expect((await http.get(`${G}/services`).set(auth)).body).toEqual([]);
    const back = await http.get('/guest/v1/payment-return');
    expect(back.status).toBe(302);
    expect(back.headers.location).toBe('qvarc://payment-return');
  });

  it('тестовый код входа работает без почты', async () => {
    const { createApp } = await import('../apps/api/src/main');
    const { TEST_DB } = await import('./helpers');
    const t = await createApp({ databaseUrl: TEST_DB, cookieSecure: false, sessionHours: 1, bookingSiteUrl: 'http://book.test', apiPublicUrl: 'http://api.test', payments: { provider: 'sandbox', sandboxSecret: 's' }, jobs: false, rateLimitFactor: 100, mail: { mode: 'off', from: 'x' }, guestTestCode: '246810' });
    await t.init();
    const h = request(t.getHttpServer());
    await h.post(`${G}/auth/otp/request`).send({ email: 'test@example.com' }).expect(200);
    const r = await h.post(`${G}/auth/otp/verify`).send({ email: 'test@example.com', code: '246810' });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    await t.close();
  });

  it('токен обновления одноразовый: повтор старого закрывает все сессии гостя', async () => {
    const t = await signIn('refresh1@example.com');
    const r1 = await http.post(`${G}/auth/refresh`).send({ refreshToken: t.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(t.refreshToken);
    await http.get(`${G}/bookings/my`).set('authorization', `Bearer ${t.accessToken}`).expect(401);
    await http.get(`${G}/bookings/my`).set('authorization', `Bearer ${r1.body.accessToken}`).expect(200);

    const stolen = await http.post(`${G}/auth/refresh`).send({ refreshToken: t.refreshToken });
    expect(stolen.status).toBe(401);
    await http.post(`${G}/auth/refresh`).send({ refreshToken: r1.body.refreshToken }).expect(401);

    const t2 = await signIn('refresh2@example.com');
    await http.post(`${G}/auth/logout`).set('authorization', `Bearer ${t2.accessToken}`).send({ refreshToken: t2.refreshToken }).expect(200);
    await http.post(`${G}/auth/refresh`).send({ refreshToken: t2.refreshToken }).expect(401);
  });
});

describe('онлайн-регистрация', () => {
  it('гости, документы и правила: шаги отмечаются, паспорт хранится зашифрованным, админка видит регистрацию', async () => {
    const created = await http.post('/public/v1/test/bookings').send({
      accommodationTypeId: ids.comfort, ratePlanId: ids.plan, arrival: addDays(today, 20), departure: addDays(today, 22), adults: 2,
      guest: { lastName: 'Смирнов', firstName: 'Иван', phone: '+79001112244', email: 'smirnov@example.com' },
      consents: { pdProcessing: true }, idempotencyKey: randomUUID(),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const t = await signIn('smirnov@example.com');
    const auth = { authorization: `Bearer ${t.accessToken}` };
    const booking = (await http.get(`${G}/bookings/my`).set(auth)).body[0];
    const C = `${G}/checkin/${booking.id}`;

    let s = (await http.get(C).set(auth).expect(200)).body;
    expect(s).toMatchObject({ status: 'registration_not_started', expectedGuests: { adults: 2, children: 0 }, rulesVersion: '2026-10-12.2' });
    expect(s.steps).toMatchObject({ guests: false, documents: false, rules: false, payment: false, unitReady: false });

    // Чужой гость не видит регистрацию
    const other = await signIn('stranger@example.com');
    await http.get(C).set('authorization', `Bearer ${other.accessToken}`).expect(404);

    const tooMany = await http.put(`${C}/guests`).set(auth).send({ guests: [1, 2, 3].map((i) => ({ firstName: `Г${i}`, lastName: 'Смирнов', isChild: false })) });
    expect(tooMany.status).toBe(409);
    await http.put(`${C}/guests`).set(auth).send({ guests: [
      { firstName: 'Иван', lastName: 'Смирнов', middleName: 'Петрович', isChild: false },
      { firstName: 'Петя', lastName: 'Смирнов', isChild: true },
    ] }).expect(200);
    s = (await http.get(C).set(auth)).body;
    expect(s.status).toBe('registration_in_progress');
    expect(s.guests.map((g: { firstName: string; isPrimary: boolean; isChild: boolean }) => [g.firstName, g.isPrimary, g.isChild])).toEqual([['Иван', true, false], ['Петя', false, true]]);

    const [ivan, petya] = s.guests.map((g: { id: string }) => g.id);
    const passport = { docType: 'ru_passport', series: '7512', number: '345678', issuedBy: 'ГУ МВД России по Челябинской области', issueDate: '2015-04-01', divisionCode: '740-001', birthPlace: 'г. Челябинск', registrationAddress: 'г. Челябинск, ул. Ленина, 1' };
    const bad = await http.put(`${C}/documents`).set(auth).send({ documents: [{ ...passport, bookingGuestId: ivan, divisionCode: '740001' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'validation_error', message: 'Код подразделения: 000-000' });
    await http.put(`${C}/documents`).set(auth).send({ documents: [
      { ...passport, bookingGuestId: ivan },
      { docType: 'birth_certificate', series: 'IV-ИВ', number: '123456', bookingGuestId: petya },
    ] }).expect(200);
    s = (await http.get(C).set(auth)).body;
    expect(s.steps.documents).toBe(true);
    expect(s.guests[0].document).toEqual({ docType: 'ru_passport', numberMasked: '•••• 5678' });
    const stored = await db.selectFrom('guest_document').select(['payload_enc']).where('guest_id', '=', ivan).executeTakeFirstOrThrow();
    expect(Buffer.from(stored.payload_enc).toString('utf8')).not.toContain('345678');

    const old = await http.post(`${C}/rules`).set(auth).send({ rulesVersion: '2020-01-01', rulesAccepted: true, personalDataConsent: true });
    expect(old.body.error.code).toBe('rules_outdated');
    await http.post(`${C}/rules`).set(auth).send({ rulesVersion: '2026-10-12.2', rulesAccepted: true, personalDataConsent: true }).expect(200);
    s = (await http.get(C).set(auth)).body;
    expect(s).toMatchObject({ status: 'registration_complete', statusLabel: 'Регистрация завершена' });
    expect(s.accessBlockers.map((x: { code: string }) => x.code)).toEqual(['payment_required', 'unit_not_ready']);

    const owner = await login(app, OWNER.email, OWNER.password);
    const card = (await owner.get(`/admin/v1/bookings/${booking.id}`)).body;
    expect(card.registration.rulesVersion).toBe('2026-10-12.2');
    expect(card.registration.guests).toHaveLength(2);
    expect(JSON.stringify(card.registration)).not.toContain('345678');
  });
});
