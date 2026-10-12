// Клиент API админки. Сессия в httpOnly-cookie, CSRF-токен читается из cookie qvarc_csrf.
// В демо-сборке (NEXT_PUBLIC_DEMO=1) запросы обслуживает lib/demo.ts в браузере, сервер не нужен.
import { DemoError, demoApi } from './demo';

export const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';
/** Префикс адреса, если админка открыта не с корня сайта (демо в папке) */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const asset = (p: string) => `${BASE}${p}`;

export class ApiError extends Error {
  constructor(public status: number, public body: { message?: string; code?: string; issues?: { path: string; message: string }[]; restrictions?: { code: string; night?: string; value?: number }[] }) {
    super(body?.message ?? `Ошибка ${status}`);
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|; )qvarc_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  if (DEMO) {
    try {
      return (await demoApi(method, path, body)) as T;
    } catch (e) {
      if (e instanceof DemoError) throw new ApiError(e.status, e.body);
      throw e;
    }
  }
  const res = await fetch(`/admin/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-csrf-token': csrf() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    window.location.href = asset('/login');
  }
  if (!res.ok) throw new ApiError(res.status, data ?? {});
  return data as T;
}

export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T,>(p: string, b: unknown) => api<T>('PUT', p, b);
export const patch = <T,>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const del = <T,>(p: string) => api<T>('DELETE', p);

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const parts = [e.body?.message ?? e.message];
    if (e.body?.issues?.length) parts.push(e.body.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '));
    if (e.body?.restrictions?.length) parts.push(e.body.restrictions.map(restrictionText).join('; '));
    return parts.join('. ');
  }
  return e instanceof Error ? e.message : String(e);
}

export function restrictionText(r: { code: string; night?: string; value?: number }): string {
  const night = r.night ? ` (${fmtDate(r.night)})` : '';
  switch (r.code) {
    case 'too_many_guests': return `Гостей больше вместимости (макс. ${r.value})`;
    case 'no_price': return `Нет цены${night}`;
    case 'closed': return `Продажи закрыты${night}`;
    case 'closed_to_arrival': return `Заезд закрыт${night}`;
    case 'closed_to_departure': return `Выезд закрыт${night}`;
    case 'min_stay': return `Минимум ${r.value} ноч.`;
    case 'max_stay': return `Максимум ${r.value} ноч.`;
    case 'min_lead_days': return `Бронировать не позднее чем за ${r.value} дн.`;
    case 'arrival_in_past': return 'Дата заезда в прошлом';
    default: return r.code;
  }
}

export const rub = (minor: number | null | undefined) =>
  minor === null || minor === undefined ? '—' : `${(minor / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

export const toMinor = (rubles: string) => {
  const v = Number(rubles.replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
};

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'UTC', ...opts });
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Черновик', tone: 'muted' },
  pending_payment: { label: 'Ожидает оплаты', tone: 'warn' },
  pending_confirmation: { label: 'Ожидает подтверждения', tone: 'warn' },
  confirmed: { label: 'Подтверждена', tone: 'ok' },
  checked_in: { label: 'Гость заселён', tone: 'info' },
  checked_out: { label: 'Гость выехал', tone: 'muted' },
  cancelled: { label: 'Отменена', tone: 'bad' },
  no_show: { label: 'Неявка', tone: 'bad' },
  expired: { label: 'Истекла', tone: 'bad' },
};

export const CHANNEL: Record<string, string> = {
  travelline: 'TravelLine',
  direct_site: 'Сайт',
  front_desk: 'Ресепшен',
  phone: 'Телефон',
  messenger: 'Мессенджер',
};

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const isoWeekday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};

/** Номера по-человечески: 1, 2, 10, а не 1, 10, 2. */
const collator = new Intl.Collator('ru', { numeric: true });
export const byName = <T extends { name: string }>(a: T, b: T) => collator.compare(a.name, b.name);
/** Сохраняет порядок категорий, в котором их отдал API, и сортирует номера внутри категории. */
export function sortUnits<T extends { name: string }>(units: T[], typeOf: (u: T) => string): T[] {
  const order = new Map<string, number>();
  for (const u of units) if (!order.has(typeOf(u))) order.set(typeOf(u), order.size);
  return [...units].sort((a, b) => order.get(typeOf(a))! - order.get(typeOf(b))! || byName(a, b));
}
