// Клиент публичного API модуля бронирования
export const PROPERTY = process.env.NEXT_PUBLIC_PROPERTY_CODE ?? 'qvarc-uvildy';
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL ?? '';
export const OFFER_URL = process.env.NEXT_PUBLIC_OFFER_URL ?? '';

export class ApiError extends Error {
  constructor(public status: number, public body: { message?: string; code?: string; issues?: { path: string; message: string }[] }) {
    super(body?.message ?? `Ошибка ${status}`);
  }
}

export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/public/v1${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data ?? {});
  return data as T;
}

export function errorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Слишком много попыток. Подождите пару минут и попробуйте снова.';
    if (e.body?.code === 'sold_out' || e.body?.code === 'overlap') return 'Пока вы оформляли бронь, номер заняли. Выберите другой вариант или даты.';
    const issues = e.body?.issues?.map((i) => i.message).join('; ');
    return [e.body?.message, issues].filter(Boolean).join(': ');
  }
  return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
}

export const rub = (minor: number) => `${(minor / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const fmtDate = (iso: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'UTC', ...o });

export const nightsWord = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ночь`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ночи`;
  return `${n} ночей`;
};

export const MEAL: Record<string, string> = { none: 'Без питания', breakfast: 'Завтрак включён', half_board: 'Полупансион', full_board: 'Полный пансион' };

export interface Tier { days_before: number; penalty_pct: number }
/** Условия отмены простыми словами: «за 7 дн. и более до заезда — бесплатно; менее чем за 7 дн. — удерживается 50%» */
export function cancellationText(tiers: Tier[] | null) {
  if (!tiers) return 'Невозвратный тариф: при отмене оплата не возвращается';
  const sorted = [...tiers].sort((a, b) => b.days_before - a.days_before);
  const parts = sorted.map((t, i) => {
    const upper = i === 0 ? null : sorted[i - 1].days_before - 1;
    const when = i === 0
      ? (t.days_before === 0 ? 'в любой момент' : `за ${t.days_before} дн. и более до заезда`)
      : t.days_before === 0 ? `менее чем за ${upper! + 1} дн.` : `за ${t.days_before}–${upper} дн.`;
    return `${when} — ${t.penalty_pct === 0 ? 'бесплатно' : `удерживается ${t.penalty_pct}% стоимости`}`;
  });
  return `Отмена: ${parts.join('; ')}`;
}
