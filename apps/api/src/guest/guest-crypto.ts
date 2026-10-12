import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest();
export const randomToken = () => randomBytes(32).toString('base64url');
export const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join('');

/** Отдельные ключи для разных задач из одного GUEST_DATA_KEY */
export function deriveKey(master: Buffer, purpose: 'documents' | 'otp'): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `qvarc-guest-${purpose}`, 32));
}

export function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export function sameBytes(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** AES-256-GCM: версия, IV, тег и шифртекст в одном буфере. */
export function encrypt(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), data]);
}

export function decrypt(key: Buffer, payload: Buffer): string {
  if (payload[0] !== 1) throw new Error('Неизвестная версия шифра');
  const d = createDecipheriv('aes-256-gcm', key, payload.subarray(1, 13));
  d.setAuthTag(payload.subarray(13, 29));
  return Buffer.concat([d.update(payload.subarray(29)), d.final()]).toString('utf8');
}
