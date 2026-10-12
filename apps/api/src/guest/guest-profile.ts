import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Database } from '../../../../packages/db/src';
import type { GuestPrincipal } from './guest.guard';

/**
 * Карточка гостя (таблица guest) для заказов и броней из приложения: последняя карточка с этим телефоном.
 * Если гость ещё ни разу не бронировал, создаётся карточка «Гость приложения» с его телефоном.
 */
export async function guestProfileId(trx: Database, g: GuestPrincipal): Promise<string> {
  const found = await trx
    .selectFrom('guest')
    .select('id')
    .where('property_id', '=', g.propertyId)
    .where('phone_e164', '=', g.phone)
    .where('merged_into_id', 'is', null)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (found) return found.id;
  const created = await trx
    .insertInto('guest')
    .values({ property_id: g.propertyId, last_name: 'Гость приложения', first_name: '', phone_e164: g.phone, tags: ['guest_app'] })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}

const ALPHABET = 'ACDEFHJKLMNPRTUVWXY3479';
/** Короткий номер для гостя и персонала: F7KM3X (заказ), T…(столик) */
export const shortNumber = (prefix: string) => prefix + Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** Ключ повтора запроса из заголовка Idempotency-Key, свой у каждого гостя */
export function idempotencyKey(g: GuestPrincipal, header: string | undefined, kind: string): string {
  const key = header?.trim();
  if (!key || key.length < 8 || key.length > 100) {
    throw new BadRequestException({ message: 'Нужен заголовок Idempotency-Key (8–100 символов)', code: 'idempotency_key_required' });
  }
  return `${kind}:${g.accountId}:${key}`;
}
