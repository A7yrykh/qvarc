import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { bootstrapProperty } from '../apps/api/src/cli/bootstrap';
import type { AppConfig } from '../apps/api/src/config';
import { createApp } from '../apps/api/src/main';
import { createDb } from '../packages/db/src';
import { migrate } from '../packages/db/scripts/migrate';

export const TEST_DB = process.env.DATABASE_URL_TEST ?? 'postgres://postgres@/qvarc_test?host=/tmp/pgq';
export const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };

/** Чистая база: схема пересоздаётся и миграции применяются заново. */
export async function resetDb() {
  const c = new Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await migrate(TEST_DB, () => undefined);
}

export async function setup(payments: AppConfig['payments'] = { provider: 'sandbox', sandboxSecret: 'test-secret' }) {
  await resetDb();
  const db = createDb(TEST_DB, 20);
  const ids = await bootstrapProperty(db, {
    legalName: 'ИП Тестовый',
    propertyCode: 'test',
    propertyName: 'Тестовый объект',
    timezone: 'Asia/Yekaterinburg',
    ownerEmail: OWNER.email,
    ownerName: 'Владелец',
    ownerPassword: OWNER.password,
  });
  const app = await createApp({
    databaseUrl: TEST_DB,
    cookieSecure: false,
    sessionHours: 1,
    bookingSiteUrl: 'http://book.test',
    apiPublicUrl: 'http://api.test',
    payments,
    jobs: false,
    rateLimitFactor: 100,
  });
  await app.init();
  app.getHttpServer().setMaxListeners(50);
  return { app, db, ids };
}

/** Сессия сотрудника: cookie сохраняются, CSRF-токен подставляется в изменяющие запросы. */
export async function login(app: INestApplication, email: string, password: string) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/admin/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrfToken as string;
  return {
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('x-csrf-token', csrf).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set('x-csrf-token', csrf).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set('x-csrf-token', csrf).send(body ?? {}),
    del: (url: string) => agent.delete(url).set('x-csrf-token', csrf),
    raw: agent,
  };
}
export type Session = Awaited<ReturnType<typeof login>>;
