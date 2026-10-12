import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { RULES_VERSION } from '../apps/api/src/guest/content';
import { SMS_PROVIDER, TestSmsProvider } from '../apps/api/src/guest/sms.provider';
import { login, OWNER, setup, type Session } from './helpers';

let app: INestApplication;
let db: Database;
let owner: Session;
let sms: TestSmsProvider;
const today = todayIn('Asia/Yekaterinburg');
const ids: Record<string, string> = {};
const PHONE = '+79085550011';
const http = () => request(app.getHttpServer());

/** Гость входит по SMS-коду; возвращает функции запросов с его токеном. */
async function guestLogin(phone: string) {
  const r = await http().post('/guest/v1/auth/otp/request').send({ phone });
  expect(r.status).toBe(200);
  const code = sms.lastCodeFor(phone)!;
  const v = await http().post('/guest/v1/auth/otp/verify').send({ phone, code });
  expect(v.status).toBe(200);
  const auth = `Bearer ${v.body.accessToken}`;
  return {
    tokens: v.body as { accessToken: string; refreshToken: string; guestId: string },
    get: (url: string) => http().get(url).set('authorization', auth),
    post: (url: string, body?: object) => http().post(url).set('authorization', auth).send(body ?? {}),
    put: (url: string, body?: object) => http().put(url).set('authorization', auth).send(body ?? {}),
  };
}

async function createBooking(phone: string, arrival: string, departure: string, adults = 2, childrenAges: number[] = []) {
  const r = await owner.post('/admin/v1/bookings', {
    guest: { lastName: 'Петрова', firstName: 'Анна', phone },
    accommodationTypeId: ids.std, ratePlanId: ids.plan, arrival, departure, adults, childrenAges,
  });
  expect(r.status).toBe(201);
  return r.body as { id: string; number: string; total_minor: number };
}

const passport = (bookingGuestId: string, number = '123456') => ({
  bookingGuestId, docType: 'ru_passport', series: '7512', number, issuedBy: 'ГУ МВД России по Челябинской области',
  issueDate: '2015-03-01', divisionCode: '740-001', birthPlace: 'г. Челябинск', registrationAddress: 'г. Челябинск, ул. Ленина, 1',
});

beforeAll(async () => {
  ({ app, db } = await setup());
  sms = app.get(SMS_PROVIDER);
  owner = await login(app, OWNER.email, OWNER.password);
  const std = await owner.post('/admin/v1/accommodation-types', {
    code: 'standard', name: 'Стандарт', kind: 'room', baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3,
    description: 'Номер для двоих', amenities: ['Душ'], photos: [{ url: '/rooms/standard/1.webp', alt: 'Стандарт, фото 1' }],
  });
  expect(std.status).toBe(201);
  ids.std = std.body.id;
  for (const name of ['Стандарт 1', 'Стандарт 2', 'Стандарт 3']) {
    expect((await owner.post('/admin/v1/units', { accommodationTypeId: ids.std, name })).status).toBe(201);
  }
  const plan = await owner.post('/admin/v1/rate-plans', {
    code: 'main', name: 'С завтраком', accommodationTypeIds: [ids.std],
    cancellationPolicy: [{ days_before: 1, penalty_pct: 0 }, { days_before: 0, penalty_pct: 50 }], prepaymentPolicy: { pct: 30, due: 'at_booking' },
  });
  expect(plan.status).toBe(201);
  ids.plan = plan.body.id;
  expect((await owner.post('/admin/v1/rate-rules', {
    ratePlanId: ids.plan, accommodationTypeId: ids.std, from: today, to: addDays(today, 365), priceMinor: 500_000, extraChildMinor: 100_000,
  })).status).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('сведения о базе', () => {
  it('открыты без входа: время заезда как на сайте, фото с адресом сайта', async () => {
    const r = await http().get('/guest/v1/property');
    expect(r.status).toBe(200);
    expect(r.body.checkInTime).toBe('17:00');
    expect(r.body.checkOutTime).toBe('14:00');
    expect(r.body.unitTypes[0]).toMatchObject({ name: 'Стандарт', capacity: 3, summary: 'Номер для двоих' });
    expect(r.body.unitTypes[0].photos[0]).toEqual({ file: '1.webp', caption: 'Стандарт, фото 1', url: 'http://book.test/rooms/standard/1.webp' });
    expect(r.body.phones.length).toBeGreaterThan(0);
  });
  it('правила проживания: текст и версия, без служебных пометок', async () => {
    const r = await http().get('/guest/v1/documents/rules');
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(RULES_VERSION);
    expect(r.body.sections.length).toBeGreaterThan(3);
    expect(r.body.source).toBeUndefined();
    expect((await http().get('/guest/v1/documents/nope')).status).toBe(404);
  });
});

describe('вход по SMS', () => {
  it('неверный код не пускает, верный выдаёт токены', async () => {
    const phone = '+79085550022';
    expect((await http().post('/guest/v1/auth/otp/request').send({ phone: '8 908 555-00-22' })).body).toMatchObject({ sent: true, demo: true });
    expect((await http().post('/guest/v1/auth/otp/verify').send({ phone, code: '000000' === sms.lastCodeFor(phone) ? '111111' : '000000' })).status).toBe(422);
    const ok = await http().post('/guest/v1/auth/otp/verify').send({ phone, code: sms.lastCodeFor(phone) });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    // Код одноразовый
    expect((await http().post('/guest/v1/auth/otp/verify').send({ phone, code: sms.lastCodeFor(phone) })).status).toBe(422);
  });
  it('повторный код не раньше чем через минуту', async () => {
    const phone = '+79085550033';
    expect((await http().post('/guest/v1/auth/otp/request').send({ phone })).status).toBe(200);
    expect((await http().post('/guest/v1/auth/otp/request').send({ phone })).status).toBe(429);
  });
  it('после 5 неверных попыток код перестаёт действовать', async () => {
    const phone = '+79085550044';
    await http().post('/guest/v1/auth/otp/request').send({ phone });
    const code = sms.lastCodeFor(phone)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await http().post('/guest/v1/auth/otp/verify').send({ phone, code: wrong })).status).toBe(422);
    expect((await http().post('/guest/v1/auth/otp/verify').send({ phone, code })).status).toBe(422);
  });
  it('обновление токена: старый токен обновления больше не работает; выход закрывает сессию', async () => {
    const g = await guestLogin('+79085550055');
    const r1 = await http().post('/guest/v1/auth/refresh').send({ refreshToken: g.tokens.refreshToken });
    expect(r1.status).toBe(200);
    expect((await http().post('/guest/v1/auth/refresh').send({ refreshToken: g.tokens.refreshToken })).status).toBe(401);
    // Старый токен доступа тоже заменён
    expect((await g.get('/guest/v1/bookings/my')).status).toBe(401);
    expect((await http().get('/guest/v1/bookings/my').set('authorization', `Bearer ${r1.body.accessToken}`)).status).toBe(200);
    await http().post('/guest/v1/auth/logout').send({ refreshToken: r1.body.refreshToken });
    expect((await http().post('/guest/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
  });
  it('без токена брони закрыты; cookie сотрудника не подходит', async () => {
    expect((await http().get('/guest/v1/bookings/my')).status).toBe(401);
    expect((await owner.get('/guest/v1/bookings/my')).status).toBe(401);
  });
  it('хранится только хеш кода', async () => {
    const rows = await db.selectFrom('guest_otp').select('code_hash').execute();
    expect(rows.every((r) => r.code_hash.length === 32)).toBe(true);
  });
});

describe('брони и онлайн-регистрация', () => {
  let g: Awaited<ReturnType<typeof guestLogin>>;
  let mine: { id: string; number: string; total_minor: number };
  let foreign: { id: string };

  beforeAll(async () => {
    mine = await createBooking(PHONE, addDays(today, 2), addDays(today, 4));
    foreign = await createBooking('+79085550099', addDays(today, 2), addDays(today, 4), 1);
    g = await guestLogin(PHONE);
  });

  it('гость видит только брони на свой телефон, чужая — «не найдено»', async () => {
    const r = await g.get('/guest/v1/bookings/my');
    expect(r.status).toBe(200);
    expect(r.body.map((b: { id: string }) => b.id)).toEqual([mine.id]);
    expect(r.body[0]).toMatchObject({ number: mine.number, status: 'confirmed', checkinStatus: 'registration_not_started', adults: 2, totalAmount: mine.total_minor, paidAmount: 0, balanceDue: mine.total_minor, currency: 'RUB' });
    // Заезд в 17:00 по Екатеринбургу (UTC+5)
    expect(new Date(r.body[0].arrivalAt).toISOString()).toBe(`${addDays(today, 2)}T12:00:00.000Z`);
    expect((await g.get(`/guest/v1/bookings/${foreign.id}`)).status).toBe(404);
    expect((await g.get(`/guest/v1/checkin/${foreign.id}`)).status).toBe(404);
  });

  it('регистрация: гости, паспорта, правила; код двери ждёт оплаты', async () => {
    let s = await g.get(`/guest/v1/checkin/${mine.id}`);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ status: 'registration_not_started', rulesVersion: RULES_VERSION, expectedGuests: { adults: 2, children: 0 } });

    expect((await g.put(`/guest/v1/checkin/${mine.id}/documents`, { documents: [passport(s.body.guests[0].id)] })).status).toBe(409);
    expect((await g.put(`/guest/v1/checkin/${mine.id}/guests`, { guests: [{ firstName: 'Петя', lastName: 'Петров', isChild: true }] })).status).toBe(422);
    expect((await g.put(`/guest/v1/checkin/${mine.id}/guests`, { guests: Array.from({ length: 4 }, () => ({ firstName: 'А', lastName: 'Б' })) })).status).toBe(422);

    s = await g.put(`/guest/v1/checkin/${mine.id}/guests`, {
      guests: [{ firstName: 'Анна', lastName: 'Петрова', middleName: 'Сергеевна' }, { firstName: 'Олег', lastName: 'Петров' }],
    });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('registration_in_progress');
    expect(s.body.guests.map((x: { firstName: string; isPrimary: boolean }) => [x.firstName, x.isPrimary])).toEqual([['Анна', true], ['Олег', false]]);
    const [a, b] = s.body.guests.map((x: { id: string }) => x.id);

    expect((await g.put(`/guest/v1/checkin/${mine.id}/documents`, { documents: [passport(a)] })).body.code).toBe('documents_incomplete');
    expect((await g.put(`/guest/v1/checkin/${mine.id}/documents`, { documents: [passport(a), passport(foreign.id)] })).status).toBe(422);
    const bad = await g.put(`/guest/v1/checkin/${mine.id}/documents`, { documents: [passport(a), { ...passport(b), series: '12' }] });
    expect(bad.status).toBe(400);
    s = await g.put(`/guest/v1/checkin/${mine.id}/documents`, { documents: [passport(a, '654321'), passport(b, '111222')] });
    expect(s.status).toBe(200);
    expect(s.body.steps.documents).toBe(true);
    expect(s.body.guests[0].document).toEqual({ docType: 'ru_passport', numberMasked: '•••• 4321' });

    // В базе паспорт зашифрован
    const stored = await db.selectFrom('guest_document').select(['payload_enc', 'retain_until']).where('booking_id', '=', mine.id).execute();
    expect(stored).toHaveLength(2);
    expect(stored.some((d) => d.payload_enc.toString('latin1').includes('654321'))).toBe(false);
    expect(stored[0].retain_until).toBe(addDays(addDays(today, 4), 30));

    expect((await g.post(`/guest/v1/checkin/${mine.id}/rules`, { rulesVersion: '2000-01-01', rulesAccepted: true, personalDataConsent: true })).body.code).toBe('rules_outdated');
    expect((await g.post(`/guest/v1/checkin/${mine.id}/rules`, { rulesVersion: RULES_VERSION, rulesAccepted: true })).status).toBe(400);
    s = await g.post(`/guest/v1/checkin/${mine.id}/rules`, { rulesVersion: RULES_VERSION, rulesAccepted: true, personalDataConsent: true });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('awaiting_payment');
    expect(s.body.accessBlockers.map((x: { code: string }) => x.code)).toEqual(['registration_incomplete', 'payment_required', 'unit_not_ready', 'no_access_device']);
    const consents = await db.selectFrom('guest_consent').select(['kind', 'source']).where('source', '=', 'guest_app').execute();
    expect(consents.map((c) => c.kind).sort()).toEqual(['pd_processing', 'stay_rules']);
  });

  it('после оплаты регистрация завершается и больше не меняется из приложения', async () => {
    const p = await db.selectFrom('property').select('id').executeTakeFirstOrThrow();
    await db.insertInto('payment').values({
      property_id: p.id, booking_id: mine.id, purpose: 'balance', method: 'cash', status: 'succeeded', amount_minor: mine.total_minor, idempotency_key: `test-${mine.id}`, paid_at: new Date(),
    }).execute();
    const s = await g.get(`/guest/v1/checkin/${mine.id}`);
    expect(s.body.status).toBe('registration_completed');
    expect(s.body.balanceDue).toBe(0);
    const again = await g.put(`/guest/v1/checkin/${mine.id}/guests`, { guests: [{ firstName: 'Анна', lastName: 'Петрова' }] });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('registration_completed');
    expect((await g.get(`/guest/v1/bookings/${mine.id}`)).body).toMatchObject({ paidAmount: mine.total_minor, balanceDue: 0, checkinStatus: 'registration_completed' });
  });

  it('сотрудник видит регистрацию, паспорта — только с правом, каждый просмотр в журнале', async () => {
    const v = await owner.get(`/admin/v1/bookings/${mine.id}/checkin`);
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('registration_completed');
    const docs = await owner.get(`/admin/v1/bookings/${mine.id}/guest-documents`);
    expect(docs.status).toBe(200);
    expect(docs.body[0]).toMatchObject({ fullName: 'Петрова Анна Сергеевна', series: '7512', number: '654321', divisionCode: '740-001' });
    const log = await db.selectFrom('audit_log').select('action').where('action', '=', 'guest.documents.view').where('entity_id', '=', mine.id).execute();
    expect(log).toHaveLength(1);

    expect((await owner.post('/admin/v1/users', { email: 'desk@test.local', fullName: 'Ресепшен', password: 'desk-password-123', roles: ['front_desk'] })).status).toBe(201);
    const desk = await login(app, 'desk@test.local', 'desk-password-123');
    expect((await desk.get(`/admin/v1/bookings/${mine.id}/checkin`)).status).toBe(200);
    expect((await desk.get(`/admin/v1/bookings/${mine.id}/guest-documents`)).status).toBe(403);

    const ready = await owner.post(`/admin/v1/bookings/${mine.id}/checkin/unit-ready`);
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready_for_checkin');
  });

  it('гостей больше, чем в брони, — нужна проверка администратора', async () => {
    const b = await createBooking(PHONE, addDays(today, 1), addDays(today, 2), 1);
    await g.put(`/guest/v1/checkin/${b.id}/guests`, { guests: [{ firstName: 'Анна', lastName: 'Петрова' }, { firstName: 'Олег', lastName: 'Петров' }] });
    let s = await g.get(`/guest/v1/checkin/${b.id}`);
    expect(s.body.status).toBe('admin_approval_required');
    expect(s.body.steps.adminApproval).toBe(false);
    // Меньше гостей: лишний гость, добавленный приложением, удаляется
    const extra = s.body.guests[1].id;
    s = await g.put(`/guest/v1/checkin/${b.id}/guests`, { guests: [{ firstName: 'Анна', lastName: 'Петрова' }] });
    expect(s.body.guests).toHaveLength(1);
    expect(await db.selectFrom('guest').select('id').where('id', '=', extra).executeTakeFirst()).toBeUndefined();
    expect((await owner.post(`/admin/v1/bookings/${b.id}/checkin/approve`)).body.steps.adminApproval).toBe(true);
  });

  it('регистрация открывается за 7 дней до заезда', async () => {
    const b = await createBooking(PHONE, addDays(today, 30), addDays(today, 31));
    const s = await g.get(`/guest/v1/checkin/${b.id}`);
    expect(s.body.status).toBe('booking_confirmed');
    const r = await g.put(`/guest/v1/checkin/${b.id}/guests`, { guests: [{ firstName: 'Анна', lastName: 'Петрова' }] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('registration_not_open');
  });

  it('отменённая бронь: регистрация закрыта', async () => {
    const b = await createBooking(PHONE, addDays(today, 3), addDays(today, 5));
    expect((await owner.post(`/admin/v1/bookings/${b.id}/status`, { status: 'cancelled', reason: 'тест' })).status).toBe(200);
    expect((await g.get(`/guest/v1/bookings/${b.id}`)).body.checkinStatus).toBe('cancelled');
    expect((await g.post(`/guest/v1/checkin/${b.id}/start`)).body.code).toBe('booking_cancelled');
  });
});
