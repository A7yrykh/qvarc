import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../packages/domain/src';
import type { Database } from '../packages/db/src';
import { importMenu } from '../apps/api/src/cli/import-menu';
import { SMS_PROVIDER, TestSmsProvider } from '../apps/api/src/guest/sms.provider';
import menuFile from '../data/menu-summer-2026.json';
import { login, OWNER, setup, type Session } from './helpers';

let app: INestApplication;
let db: Database;
let owner: Session;
let sms: TestSmsProvider;
const TZ = 'Asia/Yekaterinburg';
const today = todayIn(TZ);
const tomorrow = addDays(today, 1);
const at = (date: string, time: string) => `${date}T${time}:00+05:00`;
const ids: Record<string, string> = {};
const prices: Record<string, number> = {};
const http = () => request(app.getHttpServer());
let keyN = 0;
const key = () => `test-key-${++keyN}-${Date.now()}`;

type Guest = Awaited<ReturnType<typeof guestLogin>>;

async function guestLogin(phone: string) {
  expect((await http().post('/guest/v1/auth/otp/request').send({ phone })).status).toBe(200);
  const v = await http().post('/guest/v1/auth/otp/verify').send({ phone, code: sms.lastCodeFor(phone) });
  expect(v.status).toBe(200);
  const auth = `Bearer ${v.body.accessToken}`;
  return {
    get: (url: string) => http().get(url).set('authorization', auth),
    post: (url: string, body?: object, idem?: string) => {
      const r = http().post(url).set('authorization', auth);
      return (idem ? r.set('idempotency-key', idem) : r).send(body ?? {});
    },
  };
}

async function createBooking(phone: string) {
  const r = await owner.post('/admin/v1/bookings', {
    guest: { lastName: 'Петрова', firstName: 'Анна', phone },
    accommodationTypeId: ids.std, ratePlanId: ids.plan, arrival: today, departure: addDays(today, 3), adults: 2, childrenAges: [],
  });
  expect(r.status).toBe(201);
  return r.body as { id: string };
}

let anna: Guest;
let boris: Guest;

beforeAll(async () => {
  ({ app, db } = await setup());
  sms = app.get(SMS_PROVIDER);
  owner = await login(app, OWNER.email, OWNER.password);
  const std = await owner.post('/admin/v1/accommodation-types', {
    code: 'standard', name: 'Стандарт', kind: 'room', baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3,
  });
  ids.std = std.body.id;
  for (const name of ['Стандарт 1', 'Стандарт 2']) await owner.post('/admin/v1/units', { accommodationTypeId: ids.std, name });
  const plan = await owner.post('/admin/v1/rate-plans', {
    code: 'main', name: 'С завтраком', accommodationTypeIds: [ids.std],
    cancellationPolicy: [{ days_before: 0, penalty_pct: 0 }], prepaymentPolicy: { pct: 0, due: 'at_booking' },
  });
  ids.plan = plan.body.id;
  await owner.post('/admin/v1/rate-rules', { ratePlanId: ids.plan, accommodationTypeId: ids.std, from: today, to: addDays(today, 30), priceMinor: 500_000 });
  ids.annaBooking = (await createBooking('+79085550101')).id;
  ids.borisBooking = (await createBooking('+79085550102')).id;
  anna = await guestLogin('+79085550101');
  boris = await guestLogin('+79085550102');
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('прокат', () => {
  it('сотрудник заводит катамараны и услугу; гость видит её в каталоге без входа', async () => {
    const t = await owner.post('/admin/v1/equipment-types', { name: 'Катамаран', bufferMinutes: 10 });
    expect(t.status).toBe(201);
    ids.catType = t.body.id;
    for (const no of ['K-1', 'K-2']) expect((await owner.post(`/admin/v1/equipment-types/${ids.catType}/units`, { inventoryNo: no })).status).toBe(201);
    expect((await owner.post(`/admin/v1/equipment-types/${ids.catType}/units`, { inventoryNo: 'K-1' })).body.code).toBe('inventory_no_taken');
    const s = await owner.post('/admin/v1/services', {
      category: 'rental', name: 'Катамаран', priceMinor: 200_000, durationMinutes: 60, openTime: '09:00', closeTime: '21:00',
      maxQuantity: 2, equipmentTypeId: ids.catType, cancellationText: 'Отмена без оплаты до начала',
    });
    expect(s.status).toBe(201);
    ids.catamaran = s.body.id;
    const free = await owner.post('/admin/v1/services', { category: 'rental', name: 'Сап', priceMinor: 0, durationMinutes: 60, equipmentTypeId: ids.catType });
    ids.sup = free.body.id;

    const list = await http().get('/guest/v1/services');
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ id: 'rental', name: 'Прокат' });
    expect(list.body[0].services.find((x: { id: string }) => x.id === ids.catamaran)).toMatchObject({
      price: 200_000, bookingMode: 'slot', durationMinutes: 60, maxQuantity: 2, cancellationPolicy: 'Отмена без оплаты до начала',
    });
  });

  it('свободные слоты считаются по исправным единицам', async () => {
    const r = await http().get(`/guest/v1/services/${ids.catamaran}/slots`).query({ date: tomorrow });
    expect(r.status).toBe(200);
    const ten = r.body.slots.find((s: { startsAt: string }) => new Date(s.startsAt).getTime() === new Date(at(tomorrow, '10:00')).getTime());
    expect(ten).toMatchObject({ available: 2 });
    expect(r.body.slots).toHaveLength(12); // с 09:00 до 20:00
  });

  it('бронь удерживает оборудование; повтор с тем же ключом не создаёт вторую бронь', async () => {
    const k = key();
    const body = { serviceId: ids.catamaran, bookingId: ids.annaBooking, startsAt: at(tomorrow, '10:00'), quantity: 2 };
    const r = await anna.post('/guest/v1/service-bookings', body, k);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'hold', quantity: 2, amount: 400_000, service: 'Катамаран' });
    expect(r.body.holdExpiresAt).toBeTruthy();
    ids.annaRental = r.body.id;
    const again = await anna.post('/guest/v1/service-bookings', body, k);
    expect(again.body.id).toBe(ids.annaRental);
    expect(await db.selectFrom('equipment_reservation').select('id').where('service_booking_id', '=', ids.annaRental).execute()).toHaveLength(2);

    // Пересечение с учётом времени на осмотр: 11:00 тоже занято (10:00–11:00 + 10 минут)
    const busy = await boris.post('/guest/v1/service-bookings', { ...body, bookingId: ids.borisBooking, startsAt: at(tomorrow, '11:00'), quantity: 1 }, key());
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('not_available');
    expect(await anna.post('/guest/v1/service-bookings', body)).toMatchObject({ status: 400 });
  });

  it('чужую бронь услуги не видно; на чужое проживание забронировать нельзя', async () => {
    expect((await boris.get(`/guest/v1/service-bookings/${ids.annaRental}`)).status).toBe(404);
    expect((await boris.post(`/guest/v1/service-bookings/${ids.annaRental}/cancel`)).status).toBe(404);
    const r = await boris.post('/guest/v1/service-bookings', { serviceId: ids.catamaran, bookingId: ids.annaBooking, startsAt: at(tomorrow, '15:00') }, key());
    expect(r.status).toBe(404);
  });

  it('за пределами проживания и часов работы не бронируется', async () => {
    const base = { serviceId: ids.catamaran, bookingId: ids.borisBooking, quantity: 1 };
    expect((await boris.post('/guest/v1/service-bookings', { ...base, startsAt: at(addDays(today, 5), '10:00') }, key())).body.code).toBe('outside_stay');
    expect((await boris.post('/guest/v1/service-bookings', { ...base, startsAt: at(tomorrow, '20:30') }, key())).body.code).toBe('outside_hours');
    expect((await boris.post('/guest/v1/service-bookings', { ...base, quantity: 3, startsAt: at(tomorrow, '15:00') }, key())).body.code).toBe('quantity_exceeded');
  });

  it('одновременные брони: последнюю единицу получает только один гость', async () => {
    const tries = await Promise.all(
      [anna, boris, anna, boris].map((g, i) =>
        g.post('/guest/v1/service-bookings', { serviceId: ids.catamaran, bookingId: i % 2 ? ids.borisBooking : ids.annaBooking, startsAt: at(tomorrow, '14:00'), quantity: 1 }, key()),
      ),
    );
    expect(tries.filter((r) => r.status === 201)).toHaveLength(2);
    expect(tries.filter((r) => r.status === 409)).toHaveLength(2);
    const units = await db
      .selectFrom('equipment_reservation as r')
      .innerJoin('service_booking as sb', 'sb.id', 'r.service_booking_id')
      .select('r.equipment_unit_id')
      .where(({ eb, ref }) => eb(ref('sb.period'), '=', `[${new Date(at(tomorrow, '14:00')).toISOString()},${new Date(at(tomorrow, '15:00')).toISOString()})`))
      .execute();
    expect(new Set(units.map((u) => u.equipment_unit_id)).size).toBe(2);
  });

  it('отмена освобождает оборудование', async () => {
    const c = await anna.post(`/guest/v1/service-bookings/${ids.annaRental}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('cancelled');
    expect((await anna.post(`/guest/v1/service-bookings/${ids.annaRental}/cancel`)).body.code).toBe('invalid_transition');
    const r = await http().get(`/guest/v1/services/${ids.catamaran}/slots`).query({ date: tomorrow });
    expect(r.body.slots.find((s: { startsAt: string }) => new Date(s.startsAt).getTime() === new Date(at(tomorrow, '10:00')).getTime()).available).toBe(2);
  });

  it('истёкшее удержание освобождает оборудование', async () => {
    const r = await boris.post('/guest/v1/service-bookings', { serviceId: ids.catamaran, bookingId: ids.borisBooking, startsAt: at(tomorrow, '17:00'), quantity: 2 }, key());
    expect(r.body.status).toBe('hold');
    await db.updateTable('service_booking').set({ hold_expires_at: new Date(Date.now() - 1000) }).where('id', '=', r.body.id).execute();
    expect((await boris.get(`/guest/v1/service-bookings/${r.body.id}`)).body.status).toBe('expired');
    const again = await anna.post('/guest/v1/service-bookings', { serviceId: ids.catamaran, bookingId: ids.annaBooking, startsAt: at(tomorrow, '17:00'), quantity: 2 }, key());
    expect(again.status).toBe(201);
  });

  it('прокат на день: бесплатная услуга сразу подтверждена, выдача и возврат', async () => {
    const r = await anna.post('/guest/v1/service-bookings', { serviceId: ids.sup, bookingId: ids.annaBooking, startsAt: at(tomorrow, '19:00') }, key());
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('confirmed');
    const day = await owner.get('/admin/v1/service-bookings').query({ date: tomorrow });
    expect(day.status).toBe(200);
    const row = day.body.find((x: { id: string }) => x.id === r.body.id);
    expect(row).toMatchObject({ service: 'Сап', status: 'confirmed', guestName: 'Петрова Анна', guestPhone: '+79085550101' });
    expect(row.units).toHaveLength(1);

    expect((await owner.post(`/admin/v1/service-bookings/${r.body.id}/return`)).body.code).toBe('invalid_transition');
    expect((await owner.post(`/admin/v1/service-bookings/${r.body.id}/issue`)).status).toBe(200);
    expect((await anna.post(`/guest/v1/service-bookings/${r.body.id}/cancel`)).body.code).toBe('invalid_transition');
    expect((await owner.post(`/admin/v1/service-bookings/${r.body.id}/return`)).status).toBe(200);
    const res = await db.selectFrom('equipment_reservation').select(['status', 'issued_by', 'returned_at']).where('service_booking_id', '=', r.body.id).executeTakeFirstOrThrow();
    expect(res.status).toBe('returned');
    expect(res.issued_by).toBeTruthy();
    expect((await anna.get(`/guest/v1/service-bookings/${r.body.id}`)).body.status).toBe('done');
  });

  it('единица в ремонте не выдаётся', async () => {
    const eq = await owner.get('/admin/v1/equipment');
    const k1 = eq.body[0].units.find((u: { inventoryNo: string }) => u.inventoryNo === 'K-1');
    expect((await owner.post(`/admin/v1/equipment-units/${k1.id}/condition`, { condition: 'damaged', note: 'Пробит поплавок' })).status).toBe(200);
    const r = await http().get(`/guest/v1/services/${ids.catamaran}/slots`).query({ date: addDays(today, 2) });
    expect(r.body.slots.every((s: { available: number }) => s.available === 1)).toBe(true);
  });
});

describe('ресторан и столики', () => {
  it('сотрудник заводит ресторан, часы и столики', async () => {
    const hours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59', lastSeating: '21:00' }));
    const r = await owner.post('/admin/v1/restaurants', { name: 'Ресторан «Кварц»', seatingMinutes: 120, turnoverMinutes: 15, hours });
    expect(r.status).toBe(201);
    ids.rest = r.body.id;
    expect((await owner.post('/admin/v1/restaurants', { name: 'Плохие часы', hours: [{ weekday: 1, opensAt: '20:00', closesAt: '10:00' }] })).status).toBe(400);
    expect((await owner.post(`/admin/v1/restaurants/${ids.rest}/tables`, { name: '1', seats: 2, zone: 'Веранда' })).status).toBe(201);
    expect((await owner.post(`/admin/v1/restaurants/${ids.rest}/tables`, { name: '2', seats: 4, zone: 'Зал' })).status).toBe(201);
    const list = await http().get('/guest/v1/restaurants');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].hours).toHaveLength(7);
  });

  it('свободное время и бронь столика: меньший подходящий столик, потом больший, потом отказ', async () => {
    const av = await http().get(`/guest/v1/restaurants/${ids.rest}/availability`).query({ date: tomorrow, partySize: 2 });
    expect(av.status).toBe(200);
    expect(av.body.at(-1).startsAt).toBe(new Date(at(tomorrow, '21:00')).toISOString());
    const body = { restaurantId: ids.rest, startsAt: at(tomorrow, '13:00'), partySize: 2, bookingId: ids.annaBooking, allergies: 'орехи' };
    const first = await anna.post('/guest/v1/table-reservations', body, key());
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'confirmed', zone: 'Веранда', allergies: 'орехи' });
    ids.annaTable = first.body.id;
    const second = await boris.post('/guest/v1/table-reservations', { ...body, bookingId: ids.borisBooking, startsAt: at(tomorrow, '14:00') }, key());
    expect(second.body.zone).toBe('Зал');
    const third = await boris.post('/guest/v1/table-reservations', { ...body, bookingId: undefined, startsAt: at(tomorrow, '14:30') }, key());
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('no_tables');
    expect((await boris.post('/guest/v1/table-reservations', { ...body, startsAt: at(tomorrow, '22:00') }, key())).status).toBe(404);
    expect((await boris.post('/guest/v1/table-reservations', { ...body, bookingId: undefined, startsAt: at(tomorrow, '22:00') }, key())).body.code).toBe('outside_hours');
  });

  it('отмена гостем освобождает столик, сотрудник видит брони дня', async () => {
    expect((await boris.post(`/guest/v1/table-reservations/${ids.annaTable}/cancel`)).status).toBe(404);
    expect((await anna.post(`/guest/v1/table-reservations/${ids.annaTable}/cancel`)).body.status).toBe('cancelled');
    const r = await boris.post('/guest/v1/table-reservations', { restaurantId: ids.rest, startsAt: at(tomorrow, '14:30'), partySize: 2 }, key());
    expect(r.status).toBe(201);
    const day = await owner.get(`/admin/v1/restaurants/${ids.rest}/reservations`).query({ date: tomorrow });
    expect(day.body.map((x: { status: string }) => x.status).sort()).toEqual(['cancelled', 'confirmed', 'confirmed']);
    expect((await owner.post(`/admin/v1/table-reservations/${r.body.id}/status`, { status: 'seated' })).status).toBe(200);
    expect((await owner.post(`/admin/v1/table-reservations/${r.body.id}/status`, { status: 'confirmed' })).body.code).toBe('invalid_transition');
  });
});

describe('меню и заказ еды', () => {
  it('меню «Лето 2026» загружается из файла; повтор ничего не дублирует', async () => {
    await importMenu(db, 'test', { ...menuFile, restaurantName: 'Ресторан «Кварц»' });
    const report = await importMenu(db, 'test', { ...menuFile, restaurantName: 'Ресторан «Кварц»' });
    expect(report[1]).toContain('добавлено 0');
    const m = await http().get(`/guest/v1/restaurants/${ids.rest}/menu`);
    expect(m.status).toBe(200);
    expect(m.body.categories.map((c: { name: string }) => c.name)).toEqual(menuFile.categories.map((c) => c.name));
    const first = m.body.categories[0].items[0];
    expect(first).toMatchObject({ name: menuFile.categories[0].items[0].name, price: menuFile.categories[0].items[0].price, isAvailable: true });
    ids.dish = first.id;
    ids.dish2 = m.body.categories[0].items[1].id;
    prices.dish = first.price;
    prices.dish2 = m.body.categories[0].items[1].price;
  });

  const localHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(new Date()));
  // Заказы принимаются до 23:29 по местному времени (закрытие 23:59, приём заканчивается за 30 минут)
  it.skipIf(localHour === 23)('цена — только из меню; кухня видит заказ, гость отменяет до принятия', async () => {
    const k = key();
    const body = {
      restaurantId: ids.rest, bookingId: ids.annaBooking, fulfillment: 'pickup', paymentMethod: 'on_delivery',
      items: [{ menuItemId: ids.dish, quantity: 2, price: 1 }, { menuItemId: ids.dish2, quantity: 1 }, { menuItemId: ids.dish, quantity: 1 }],
    };
    const o = await anna.post('/guest/v1/food-orders', body, k);
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ status: 'new', fulfillment: 'pickup', paymentMethod: 'on_delivery', total: prices.dish * 3 + prices.dish2 });
    expect(o.body.items).toHaveLength(2);
    expect((await anna.post('/guest/v1/food-orders', body, k)).body.id).toBe(o.body.id);
    expect((await boris.get(`/guest/v1/food-orders/${o.body.id}`)).status).toBe(404);

    const kitchen = await owner.get('/admin/v1/kitchen/orders');
    expect(kitchen.body.map((x: { id: string }) => x.id)).toContain(o.body.id);
    expect((await owner.post(`/admin/v1/food-orders/${o.body.id}/status`, { status: 'accepted' })).status).toBe(200);
    expect((await anna.post(`/guest/v1/food-orders/${o.body.id}/cancel`)).status).toBe(409);

    const second = await anna.post('/guest/v1/food-orders', { ...body, items: [{ menuItemId: ids.dish2, quantity: 1 }] }, key());
    expect((await anna.post(`/guest/v1/food-orders/${second.body.id}/cancel`)).body.status).toBe('cancelled');
    expect((await anna.get('/guest/v1/food-orders/my')).body).toHaveLength(2);
  });

  it.skipIf(localHour === 23)('онлайн-заказ не виден кухне до оплаты; блюдо из стоп-листа не заказать', async () => {
    const o = await boris.post('/guest/v1/food-orders', {
      restaurantId: ids.rest, fulfillment: 'pickup', paymentMethod: 'online', items: [{ menuItemId: ids.dish, quantity: 1 }],
    }, key());
    expect(o.status).toBe(201);
    expect(o.body.statusLabel).toBe('Ждёт оплаты');
    expect((await owner.get('/admin/v1/kitchen/orders')).body.map((x: { id: string }) => x.id)).not.toContain(o.body.id);

    expect((await owner.patch(`/admin/v1/menu-items/${ids.dish}`, { isAvailable: false })).status).toBe(200);
    const stopped = await boris.post('/guest/v1/food-orders', {
      restaurantId: ids.rest, fulfillment: 'pickup', paymentMethod: 'on_delivery', items: [{ menuItemId: ids.dish, quantity: 1 }],
    }, key());
    expect(stopped.status).toBe(409);
    expect(stopped.body.code).toBe('menu_item_unavailable');
  });

  it('доставка в номер — только во время проживания с назначенным номером', async () => {
    const r = await anna.post('/guest/v1/food-orders', {
      restaurantId: ids.rest, bookingId: ids.annaBooking, fulfillment: 'delivery', paymentMethod: 'on_delivery', items: [{ menuItemId: ids.dish2, quantity: 1 }],
    }, key());
    expect(r.status).toBe(409);
    expect(['booking_not_active', 'no_unit', 'restaurant_closed']).toContain(r.body.code);
  });
});
