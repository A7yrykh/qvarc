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
    expect(again.join('\n')).toContain('уже есть');
    const units = await db.selectFrom('accommodation_unit').select('id').execute();
    expect(units).toHaveLength(12);
    const p = await db.selectFrom('property').select(['check_in_time', 'check_out_time']).where('code', '=', 'test').executeTakeFirstOrThrow();
    expect([p.check_in_time.slice(0, 5), p.check_out_time.slice(0, 5)]).toEqual(['17:00', '14:00']);
  });

  it('модуль бронирования показывает фото и описание, отмена позже чем за сутки удерживает первую ночь', async () => {
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
});
