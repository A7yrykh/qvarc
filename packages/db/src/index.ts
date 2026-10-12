import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './schema';

// date → строка 'YYYY-MM-DD' без сдвига часового пояса
types.setTypeParser(1082, (v) => v);
// bigint → number: суммы в копейках и счётчики далеко от предела 2^53
types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`bigint вне безопасного диапазона: ${v}`);
  return n;
});

export type Database = Kysely<DB>;
export type { DB } from './schema';

export function createDb(connectionString: string, max = 10): Database {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, max }) }) });
}

/** Контекст для триггеров истории: кто и почему меняет данные (действует до конца транзакции). */
export async function setActor(trx: Database, userId: string | null, source = 'app', reason?: string) {
  await sql`SELECT set_config('qvarc.user_id', ${userId ?? ''}, true),
                   set_config('qvarc.source', ${source}, true),
                   set_config('qvarc.reason', ${reason ?? ''}, true)`.execute(trx);
}

/** Коды ошибок PostgreSQL, которые API превращает в понятные ответы. */
export const PG = {
  uniqueViolation: '23505',
  exclusionViolation: '23P01',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
} as const;

export function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined;
}
