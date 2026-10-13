import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../packages/db/src';
import { login, OWNER, setup } from './helpers';

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  ({ app, db } = await setup());
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('смена своего пароля', () => {
  it('нужен текущий пароль; после смены старый не подходит, другие сеансы закрыты', async () => {
    const a = await login(app, OWNER.email, OWNER.password);
    const b = await login(app, OWNER.email, OWNER.password);
    expect((await a.post('/admin/v1/auth/password', { current: 'wrong-password', next: 'new-password-456' })).status).toBe(401);
    expect((await a.post('/admin/v1/auth/password', { current: OWNER.password, next: 'short' })).status).toBe(400);
    expect((await a.post('/admin/v1/auth/password', { current: OWNER.password, next: 'new-password-456' })).status).toBe(200);
    expect((await a.get('/admin/v1/auth/me')).status).toBe(200);
    expect((await b.get('/admin/v1/auth/me')).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/admin/v1/auth/login').send({ email: OWNER.email, password: OWNER.password })).status).toBe(401);
    await login(app, OWNER.email, 'new-password-456');
  });
});
