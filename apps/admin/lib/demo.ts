// Демо-режим админки: вместо API — выдуманные данные в браузере посетителя.
// Брони, гости и цены не связаны с настоящей системой; изменения хранятся в localStorage и сбрасываются кнопкой.
import rooms from '../../../data/kvarc-rooms.json';
import { addDays, nightsBetween, quote, resolveRules, type RateRuleInput } from '../../../packages/domain/src';

const KEY = 'qvarc-demo-v1';

interface DType {
  id: string; code: string; name: string; kind: string; area_m2: string | null; base_occupancy: number; max_adults: number;
  max_children: number; max_occupancy: number; description: string | null; sort_order: number; is_active: boolean;
}
interface DUnit { id: string; accommodation_type_id: string; name: string; lock_system_ref: string | null; is_active: boolean }
interface DPlan {
  id: string; code: string; name: string; meal_plan: string; is_refundable: boolean; cancellation_policy: unknown; prepayment_policy: { pct: number; due: string; days?: number };
  deposit_policy: unknown; is_public: boolean; is_active: boolean; accommodation_type_ids: string[];
}
interface DRule {
  id: string; rate_plan_id: string; accommodation_type_id: string; from: string; to: string; weekdays: number[]; priority: number;
  price_minor: number | null; extra_adult_minor: number | null; extra_child_minor: number | null; min_stay: number | null; max_stay: number | null;
  min_lead_days: number | null; closed: boolean; closed_to_arrival: boolean; closed_to_departure: boolean; label: string | null; created_at: string;
}
interface DBlock { id: string; unit_id: string | null; accommodation_type_id: string | null; from: string; to: string; reason: string }
interface DGuest { id: string; last_name: string; first_name: string; middle_name: string | null; phone_e164: string | null; email: string | null; tags: string[]; created_at: string; notes: { id: string; body: string; created_at: string }[] }
interface DStay { id: string; unit_id: string | null; accommodation_type_id: string; is_active: boolean; adults: number; children: number }
interface DHistory { id: number; from_status: string | null; to_status: string; changed_at: string; reason: string | null; source: string }
interface DBooking {
  id: string; number: string; status: string; payment_state: string; arrival: string; departure: string; adults: number; children_ages: number[];
  total_minor: number; prepayment_due_minor: number; special_requests: string | null; created_at: string; channel_code: string;
  booker_guest_id: string; rate_plan_id: string; stays: DStay[]; nights: { booking_stay_id: string; night: string; amount_minor: number }[];
  history: DHistory[]; registration: unknown;
}
interface DPayment { id: string; booking_id: string; purpose: string; method: string; provider: string | null; status: string; amount_minor: number; refunded_minor: number; paid_at: string | null; created_at: string }
interface State {
  today: string; seq: number; hist: number; types: DType[]; units: DUnit[]; plans: DPlan[]; rules: DRule[]; blocks: DBlock[];
  guests: DGuest[]; bookings: DBooking[]; payments: DPayment[];
}

export class DemoError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.message ?? status));
  }
}
const fail = (status: number, message: string, extra: Record<string, unknown> = {}): never => {
  throw new DemoError(status, { message, ...extra });
};

const TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_payment', 'pending_confirmation', 'confirmed', 'cancelled'],
  pending_payment: ['confirmed', 'cancelled', 'expired'],
  pending_confirmation: ['confirmed', 'cancelled'],
  expired: ['confirmed'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['checked_out'],
  no_show: ['confirmed'],
};
const ACTIVE = ['pending_payment', 'pending_confirmation', 'confirmed', 'checked_in', 'checked_out'];

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nowIso = () => new Date().toISOString();
const rangeStr = (a: string, b: string) => `[${a},${b})`;

// ───────────── начальные данные ─────────────

/** Тестовые цены за ночь, ₽: будни и пятница–суббота */
const PRICES: Record<string, [number, number]> = { standard: [5000, 6000], comfort: [6000, 7000], apartments: [9000, 11000], cottage: [11000, 13000] };

const PEOPLE: [string, string, string | null, string][] = [
  ['Смирнова', 'Анна', 'Сергеевна', '+79120001101'], ['Кузнецов', 'Дмитрий', 'Олегович', '+79120001102'], ['Попова', 'Елена', null, '+79120001103'],
  ['Васильев', 'Игорь', 'Петрович', '+79120001104'], ['Морозова', 'Ольга', 'Андреевна', '+79120001105'], ['Новиков', 'Артём', null, '+79120001106'],
  ['Фёдорова', 'Наталья', 'Викторовна', '+79120001107'], ['Волков', 'Сергей', 'Иванович', '+79120001108'], ['Лебедева', 'Мария', null, '+79120001109'],
  ['Козлов', 'Андрей', 'Николаевич', '+79120001110'], ['Соколова', 'Ирина', 'Павловна', '+79120001111'], ['Павлов', 'Максим', null, '+79120001112'],
  ['Егорова', 'Татьяна', 'Юрьевна', '+79120001113'], ['Орлов', 'Николай', 'Алексеевич', '+79120001114'], ['Зайцева', 'Светлана', null, '+79120001115'],
  ['Голубев', 'Роман', 'Евгеньевич', '+79120001116'],
];

/** Сценарии броней: [гость, номер (индекс), заезд от сегодня, ночей, взрослых, дети, канал, оплата: 0 нет, 1 предоплата, 2 полностью] */
const PLAN: [number, number, number, number, number, number[], string, 0 | 1 | 2][] = [
  [0, 0, -6, 3, 2, [], 'direct_site', 2], [1, 4, -3, 4, 2, [7], 'phone', 2], [2, 8, -2, 3, 4, [], 'direct_site', 1],
  [3, 11, -1, 5, 3, [10], 'front_desk', 1], [4, 1, 0, 2, 2, [], 'direct_site', 1], [5, 5, 1, 2, 2, [], 'messenger', 0],
  [6, 9, 2, 3, 4, [5], 'direct_site', 1], [7, 2, 4, 2, 2, [], 'phone', 1], [8, 6, 5, 3, 2, [], 'direct_site', 1],
  [9, 10, 6, 2, 3, [], 'direct_site', 1], [10, 3, 8, 4, 2, [3], 'phone', 0], [11, 0, 10, 2, 2, [], 'direct_site', 1],
  [12, 7, 12, 3, 2, [], 'direct_site', 1], [13, 11, 15, 7, 4, [8], 'phone', 1], [14, 4, 18, 2, 2, [], 'direct_site', 1],
  [15, 8, 21, 3, 4, [], 'messenger', 0], [2, 1, -12, 2, 2, [], 'direct_site', 2], [6, 5, -9, 3, 2, [], 'phone', 2],
];

function seed(): State {
  const today = todayLocal();
  const created = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const s: State = { today, seq: 0, hist: 0, types: [], units: [], plans: [], rules: [], blocks: [], guests: [], bookings: [], payments: [] };
  for (const t of rooms.accommodationTypes) {
    const id = uid();
    s.types.push({
      id, code: t.code, name: t.name, kind: t.kind, area_m2: t.areaM2 ? t.areaM2.toFixed(1) : null, base_occupancy: t.baseOccupancy,
      max_adults: t.maxAdults, max_children: t.maxChildren, max_occupancy: t.maxOccupancy, description: t.description, sort_order: t.sortOrder, is_active: true,
    });
    for (const name of t.units) s.units.push({ id: uid(), accommodation_type_id: id, name, lock_system_ref: null, is_active: true });
  }
  const p = rooms.ratePlan;
  const plan: DPlan = {
    id: uid(), code: p.code, name: p.name, meal_plan: p.mealPlan, is_refundable: true, cancellation_policy: p.cancellationPolicy,
    prepayment_policy: p.prepaymentPolicy, deposit_policy: p.depositPolicy ?? null, is_public: true, is_active: true, accommodation_type_ids: s.types.map((t) => t.id),
  };
  s.plans.push(plan);
  const from = addDays(today, -60), to = addDays(today, 365);
  for (const t of s.types) {
    const [weekday, weekend] = PRICES[t.code] ?? [5000, 6000];
    s.rules.push({ ...rule(plan.id, t.id, from, to, [1, 2, 3, 4, 5, 6, 7], 0, weekday * 100, 'Базовая цена (демо)', created), extra_adult_minor: 150_000, extra_child_minor: 100_000 });
    s.rules.push(rule(plan.id, t.id, from, to, [5, 6], 10, weekend * 100, 'Выходные (демо)', created));
  }
  for (const [last, first, middle, phone] of PEOPLE) {
    s.guests.push({ id: uid(), last_name: last, first_name: first, middle_name: middle, phone_e164: phone, email: `${translit(last)}@example.com`, tags: [], created_at: created, notes: [] });
  }
  s.guests[1].tags = ['постоянный гость'];
  s.guests[13].tags = ['постоянный гость', 'с собакой'];
  const units = sortedUnits(s);
  for (const [g, u, offset, nights, adults, kids, channel, paid] of PLAN) {
    const unit = units[u];
    const arrival = addDays(today, offset), departure = addDays(arrival, nights);
    if (!unitFree(s, unit.id, arrival, departure)) continue;
    const status = departure <= today ? 'checked_out' : arrival <= today ? (offset === 0 ? 'confirmed' : 'checked_in') : paid === 0 && channel === 'direct_site' ? 'pending_payment' : 'confirmed';
    const b = createBooking(s, {
      guestId: s.guests[g].id, typeId: unit.accommodation_type_id, unitId: unit.id, planId: plan.id, arrival, departure, adults, childrenAges: kids,
      channel, status: 'confirmed', requests: g === 13 ? 'Приедем с собакой, нужна миска' : null, force: true,
    });
    b.created_at = new Date(Date.parse(`${arrival}T09:00:00Z`) - (10 + g) * 86_400_000).toISOString();
    b.history[0].changed_at = b.created_at;
    if (paid > 0) pay(s, b, paid === 2 ? b.total_minor : b.prepayment_due_minor, b.created_at);
    if (status === 'pending_payment') { b.status = 'pending_payment'; b.history = [hist(s, null, 'pending_payment', null, b.created_at)]; }
    if (status === 'checked_in' || status === 'checked_out') move(s, b, 'checked_in', null, `${arrival}T12:10:00Z`);
    if (status === 'checked_out') { if (paidOf(s, b.id) < b.total_minor) pay(s, b, b.total_minor - paidOf(s, b.id), `${arrival}T12:00:00Z`); move(s, b, 'checked_out', null, `${departure}T09:30:00Z`); }
  }
  const apt = units.find((x) => x.name === 'Апартаменты 1');
  if (apt) s.blocks.push({ id: uid(), unit_id: apt.id, accommodation_type_id: null, from: addDays(today, 24), to: addDays(today, 27), reason: 'out_of_order' });
  return s;
}

function rule(planId: string, typeId: string, from: string, to: string, weekdays: number[], priority: number, price: number, label: string, created: string): DRule {
  return {
    id: uid(), rate_plan_id: planId, accommodation_type_id: typeId, from, to, weekdays, priority, price_minor: price, extra_adult_minor: null, extra_child_minor: null,
    min_stay: null, max_stay: null, min_lead_days: null, closed: false, closed_to_arrival: false, closed_to_departure: false, label, created_at: created,
  };
}

function translit(s: string) {
  const m: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ь: '', ъ: '' };
  return s.toLowerCase().split('').map((c) => m[c] ?? c).join('');
}

// ───────────── хранилище ─────────────

let cache: State | null = null;
function load(): State {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      // Демо «живёт» относительно сегодняшнего дня: на следующий день данные создаются заново
      if (s.today === todayLocal()) return (cache = s);
    }
  } catch { /* приватный режим: работаем без сохранения */ }
  cache = seed();
  save();
  return cache;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* без сохранения */ }
}
export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* ничего */ }
  cache = null;
}

// ───────────── логика броней ─────────────

const sortedUnits = (s: State) => {
  const order = new Map(s.types.map((t) => [t.id, t.sort_order]));
  const coll = new Intl.Collator('ru', { numeric: true });
  return [...s.units].sort((a, b) => order.get(a.accommodation_type_id)! - order.get(b.accommodation_type_id)! || coll.compare(a.name, b.name));
};

function unitFree(s: State, unitId: string, a: string, b: string, exceptBooking?: string) {
  const busy = s.bookings.some((bk) => bk.id !== exceptBooking && ACTIVE.includes(bk.status) && bk.stays.some((st) => st.is_active && st.unit_id === unitId) && bk.arrival < b && a < bk.departure);
  const unit = s.units.find((u) => u.id === unitId);
  const blocked = s.blocks.some((bl) => (bl.unit_id === unitId || bl.accommodation_type_id === unit?.accommodation_type_id) && bl.from < b && a < bl.to);
  return !busy && !blocked;
}

const ruleInputs = (s: State, planId: string, typeId: string): RateRuleInput[] =>
  s.rules.filter((r) => r.rate_plan_id === planId && r.accommodation_type_id === typeId).map((r) => ({
    id: r.id, from: r.from, to: r.to, weekdays: r.weekdays, priority: r.priority, createdAt: new Date(r.created_at), priceMinor: r.price_minor,
    extraAdultMinor: r.extra_adult_minor, extraChildMinor: r.extra_child_minor, minStay: r.min_stay, maxStay: r.max_stay, minLeadDays: r.min_lead_days,
    closed: r.closed, closedToArrival: r.closed_to_arrival, closedToDeparture: r.closed_to_departure,
  }));

function quoteFor(s: State, planId: string, typeId: string, arrival: string, departure: string, adults: number, children: number) {
  const t = s.types.find((x) => x.id === typeId) ?? fail(404, 'Категория не найдена');
  const plan = s.plans.find((x) => x.id === planId) ?? fail(404, 'Тариф не найден');
  if (departure <= arrival) fail(422, 'Выезд должен быть позже заезда');
  const q = quote(ruleInputs(s, planId, typeId), { baseOccupancy: t.base_occupancy, maxAdults: t.max_adults, maxChildren: t.max_children, maxOccupancy: t.max_occupancy }, { arrival, departure, adults, children, today: todayLocal() });
  return { ...q, prepaymentDueMinor: Math.round((q.totalMinor * plan.prepayment_policy.pct) / 100) };
}

function hist(s: State, from: string | null, to: string, reason: string | null, at = nowIso()): DHistory {
  return { id: ++s.hist, from_status: from, to_status: to, changed_at: at, reason, source: reason === 'Оплата' ? 'payment' : 'staff' };
}

function createBooking(s: State, i: {
  guestId: string; typeId: string; unitId?: string | null; planId: string; arrival: string; departure: string; adults: number; childrenAges: number[];
  channel: string; status: string; requests: string | null; force?: boolean; override?: boolean;
}): DBooking {
  const q = quoteFor(s, i.planId, i.typeId, i.arrival, i.departure, i.adults, i.childrenAges.length);
  if (!q.bookable && !i.force && !i.override) fail(422, 'Бронь нарушает ограничения тарифа', { restrictions: q.restrictions });
  if (q.nights.length === 0 || q.totalMinor === 0) fail(422, 'Нет цены на эти даты');
  let unitId = i.unitId ?? null;
  if (unitId && !unitFree(s, unitId, i.arrival, i.departure)) fail(409, 'Номер занят на эти даты');
  if (!unitId) unitId = s.units.find((u) => u.accommodation_type_id === i.typeId && u.is_active && unitFree(s, u.id, i.arrival, i.departure))?.id ?? fail(409, 'Нет свободных номеров этой категории');
  const stay: DStay = { id: uid(), unit_id: unitId, accommodation_type_id: i.typeId, is_active: true, adults: i.adults, children: i.childrenAges.length };
  const b: DBooking = {
    id: uid(), number: `QV-${i.arrival.slice(0, 4)}-${String(++s.seq).padStart(6, '0')}`, status: i.status, payment_state: 'unpaid',
    arrival: i.arrival, departure: i.departure, adults: i.adults, children_ages: i.childrenAges, total_minor: q.totalMinor, prepayment_due_minor: q.prepaymentDueMinor,
    special_requests: i.requests, created_at: nowIso(), channel_code: i.channel, booker_guest_id: i.guestId, rate_plan_id: i.planId, stays: [stay],
    nights: q.nights.map((n) => ({ booking_stay_id: stay.id, night: n.night, amount_minor: n.amountMinor })), history: [],
    registration: { guestsSubmittedAt: null, rulesVersion: null, rulesAcceptedAt: null, guests: [] },
  };
  b.history.push(hist(s, null, i.status, i.override ? 'Ограничения тарифа сняты администратором' : null, b.created_at));
  s.bookings.push(b);
  return b;
}

const paidOf = (s: State, bookingId: string) =>
  s.payments.filter((p) => p.booking_id === bookingId && p.status === 'succeeded').reduce((a, p) => a + p.amount_minor - p.refunded_minor, 0);

function updatePaymentState(s: State, b: DBooking) {
  const paid = paidOf(s, b.id);
  const refunded = s.payments.some((p) => p.booking_id === b.id && p.refunded_minor > 0);
  b.payment_state = paid === 0 ? (refunded ? 'refunded' : 'unpaid') : paid < b.total_minor ? 'partially_paid' : paid === b.total_minor ? 'paid' : 'overpaid';
}

function pay(s: State, b: DBooking, amount: number, at: string) {
  if (amount <= 0) return;
  s.payments.push({
    id: uid(), booking_id: b.id, purpose: paidOf(s, b.id) === 0 && amount < b.total_minor ? 'prepayment' : 'balance', method: 'card', provider: 'sber',
    status: 'succeeded', amount_minor: amount, refunded_minor: 0, paid_at: at, created_at: at,
  });
  updatePaymentState(s, b);
}

function move(s: State, b: DBooking, to: string, reason: string | null, at = nowIso()) {
  if (!(TRANSITIONS[b.status] ?? []).includes(to)) fail(409, 'Такой переход статуса невозможен');
  b.history.push(hist(s, b.status, to, reason, at));
  b.status = to;
  if (to === 'cancelled' || to === 'no_show' || to === 'expired') b.stays.forEach((st) => (st.is_active = false));
  if (to === 'confirmed') b.stays.forEach((st, i) => (st.is_active = i === b.stays.length - 1));
}

// ───────────── представления ─────────────

const guestOf = (s: State, id: string) => s.guests.find((g) => g.id === id) ?? fail(404, 'Гость не найден');
const bookingOf = (s: State, id: string) => s.bookings.find((b) => b.id === id) ?? fail(404, 'Бронь не найдена');

function bookingView(s: State, b: DBooking) {
  const g = guestOf(s, b.booker_guest_id);
  const paid = paidOf(s, b.id);
  return {
    id: b.id, number: b.number, status: b.status, payment_state: b.payment_state, arrival: b.arrival, departure: b.departure, adults: b.adults,
    children_ages: b.children_ages, total_minor: b.total_minor, paid_minor: paid, balance_minor: b.total_minor - paid, prepayment_due_minor: b.prepayment_due_minor,
    special_requests: b.special_requests, created_at: b.created_at, channel_code: b.channel_code, booker_guest_id: b.booker_guest_id,
    last_name: g.last_name, first_name: g.first_name, phone_e164: g.phone_e164, email: g.email,
    stays: b.stays.map((st) => ({
      id: st.id, unit_id: st.unit_id, unit_name: s.units.find((u) => u.id === st.unit_id)?.name ?? null, type_name: s.types.find((t) => t.id === st.accommodation_type_id)?.name ?? '',
      accommodation_type_id: st.accommodation_type_id, stay: rangeStr(b.arrival, b.departure), is_active: st.is_active, adults: st.adults, children: st.children,
    })),
    nights: b.nights, history: b.history, allowed_transitions: TRANSITIONS[b.status] ?? [], registration: b.registration, deposit: null,
  };
}

function q(params: URLSearchParams, k: string) {
  return params.get(k) ?? '';
}

// ───────────── маршруты ─────────────

type Handler = (s: State, m: RegExpMatchArray, params: URLSearchParams, body: any) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROUTES: [string, RegExp, Handler][] = [
  ['POST', /^\/auth\/login$/, () => ({ ok: true })],
  ['POST', /^\/auth\/logout$/, () => null],
  ['GET', /^\/auth\/me$/, () => ({
    id: 'demo', email: 'demo@kvarc', fullName: 'Демо-доступ',
    permissions: ['booking.read', 'booking.status', 'booking.write', 'calendar.read', 'guest.contacts.read', 'guest.read', 'guest.write', 'inventory.read', 'inventory.write', 'payment.read', 'payment.refund', 'rates.read', 'rates.write'],
  })],

  ['GET', /^\/accommodation-types$/, (s) => [...s.types].sort((a, b) => a.sort_order - b.sort_order).map((t) => ({ ...t, active_units: s.units.filter((u) => u.accommodation_type_id === t.id && u.is_active).length }))],
  ['POST', /^\/accommodation-types$/, (s, _m, _p, b) => {
    if (s.types.some((t) => t.code === b.code)) fail(409, 'Категория с таким кодом уже есть');
    const t: DType = { id: uid(), code: b.code, name: b.name, kind: b.kind, area_m2: b.areaM2 == null || b.areaM2 === '' ? null : Number(b.areaM2).toFixed(1), base_occupancy: b.baseOccupancy, max_adults: b.maxAdults, max_children: b.maxChildren, max_occupancy: b.maxOccupancy, description: b.description || null, sort_order: b.sortOrder ?? 0, is_active: b.isActive ?? true };
    s.types.push(t);
    return t;
  }],
  ['PUT', /^\/accommodation-types\/([^/]+)$/, (s, m, _p, b) => {
    const t = s.types.find((x) => x.id === m[1]) ?? fail(404, 'Категория не найдена');
    Object.assign(t, { code: b.code, name: b.name, kind: b.kind, area_m2: b.areaM2 == null || b.areaM2 === '' ? null : Number(b.areaM2).toFixed(1), base_occupancy: b.baseOccupancy, max_adults: b.maxAdults, max_children: b.maxChildren, max_occupancy: b.maxOccupancy, description: b.description || null, sort_order: b.sortOrder ?? 0, is_active: b.isActive ?? true });
    return t;
  }],

  ['GET', /^\/units$/, (s) => sortedUnits(s).map((u) => {
    const t = s.types.find((x) => x.id === u.accommodation_type_id)!;
    return { ...u, type_name: t.name, type_code: t.code };
  })],
  ['POST', /^\/units$/, (s, _m, _p, b) => {
    const u: DUnit = { id: uid(), accommodation_type_id: b.accommodationTypeId, name: b.name, lock_system_ref: b.lockSystemRef ?? null, is_active: b.isActive ?? true };
    s.units.push(u);
    return u;
  }],
  ['PUT', /^\/units\/([^/]+)$/, (s, m, _p, b) => {
    const u = s.units.find((x) => x.id === m[1]) ?? fail(404, 'Номер не найден');
    Object.assign(u, { accommodation_type_id: b.accommodationTypeId, name: b.name, is_active: b.isActive ?? true });
    return u;
  }],
  ['POST', /^\/availability-blocks$/, (s, _m, _p, b) => {
    if (b.to <= b.from) fail(422, 'Конец периода раньше начала');
    const bl: DBlock = { id: uid(), unit_id: b.unitId ?? null, accommodation_type_id: b.accommodationTypeId ?? null, from: b.from, to: b.to, reason: b.reason };
    s.blocks.push(bl);
    return bl;
  }],

  ['GET', /^\/rate-plans$/, (s) => s.plans],
  ['POST', /^\/rate-plans$/, (s, _m, _p, b) => {
    if (s.plans.some((p) => p.code === b.code)) fail(409, 'Тариф с таким кодом уже есть');
    const p: DPlan = { id: uid(), code: b.code, name: b.name, meal_plan: b.mealPlan ?? 'none', is_refundable: b.isRefundable ?? true, cancellation_policy: b.cancellationPolicy, prepayment_policy: b.prepaymentPolicy, deposit_policy: b.depositPolicy ?? null, is_public: b.isPublic ?? true, is_active: b.isActive ?? true, accommodation_type_ids: b.accommodationTypeIds };
    s.plans.push(p);
    return p;
  }],
  ['PUT', /^\/rate-plans\/([^/]+)$/, (s, m, _p, b) => {
    const p = s.plans.find((x) => x.id === m[1]) ?? fail(404, 'Тариф не найден');
    if (s.plans.some((x) => x.code === b.code && x.id !== p.id)) fail(409, 'Тариф с таким кодом уже есть');
    Object.assign(p, { code: b.code, name: b.name, meal_plan: b.mealPlan, is_refundable: b.isRefundable, cancellation_policy: b.cancellationPolicy, prepayment_policy: b.prepaymentPolicy, deposit_policy: b.depositPolicy ?? null, is_public: b.isPublic, is_active: b.isActive, accommodation_type_ids: b.accommodationTypeIds });
    return p;
  }],
  ['GET', /^\/rate-rules$/, (s, _m, p) => s.rules
    .filter((r) => r.rate_plan_id === q(p, 'ratePlanId') && (!p.get('from') || (r.from < q(p, 'to') && q(p, 'from') < r.to)))
    .sort((a, b) => b.priority - a.priority || b.created_at.localeCompare(a.created_at))
    .map(({ from, to, ...r }) => ({ ...r, period: rangeStr(from, to) }))],
  ['POST', /^\/rate-rules$/, (s, _m, _p, b) => {
    if (b.to <= b.from) fail(422, 'Конец периода раньше начала');
    const r: DRule = {
      id: uid(), rate_plan_id: b.ratePlanId, accommodation_type_id: b.accommodationTypeId, from: b.from, to: b.to, weekdays: b.weekdays ?? [1, 2, 3, 4, 5, 6, 7], priority: b.priority ?? 0,
      price_minor: b.priceMinor ?? null, extra_adult_minor: b.extraAdultMinor ?? null, extra_child_minor: b.extraChildMinor ?? null, min_stay: b.minStay ?? null, max_stay: b.maxStay ?? null,
      min_lead_days: b.minLeadDays ?? null, closed: !!b.closed, closed_to_arrival: !!b.closedToArrival, closed_to_departure: !!b.closedToDeparture, label: b.label ?? null, created_at: nowIso(),
    };
    s.rules.push(r);
    return r;
  }],
  ['DELETE', /^\/rate-rules\/([^/]+)$/, (s, m) => { s.rules = s.rules.filter((r) => r.id !== m[1]); return null; }],
  ['GET', /^\/rate-grid$/, (s, _m, p) => {
    const planId = q(p, 'ratePlanId'), from = q(p, 'from'), to = q(p, 'to');
    const plan = s.plans.find((x) => x.id === planId) ?? fail(404, 'Тариф не найден');
    const days = nightsBetween(from, to);
    const rows = [...s.types].filter((t) => t.is_active && plan.accommodation_type_ids.includes(t.id)).sort((a, b) => a.sort_order - b.sort_order).map((t) => {
      const rules = ruleInputs(s, planId, t.id);
      const units = s.units.filter((u) => u.accommodation_type_id === t.id && u.is_active);
      return {
        accommodationType: { id: t.id, name: t.name, code: t.code },
        days: days.map((date) => {
          const r = resolveRules(rules, date);
          return { date, free: units.filter((u) => unitFree(s, u.id, date, addDays(date, 1))).length, ...r };
        }),
      };
    });
    return { ratePlanId: planId, from, to, rows };
  }],
  ['POST', /^\/quotes$/, (s, _m, _p, b) => quoteFor(s, b.ratePlanId, b.accommodationTypeId, b.arrival, b.departure, b.adults, (b.childrenAges ?? []).length)],

  ['GET', /^\/calendar$/, (s, _m, p) => {
    const from = q(p, 'from'), to = q(p, 'to');
    const units = sortedUnits(s).map((u) => ({ id: u.id, name: u.name, is_active: u.is_active, type_id: u.accommodation_type_id, type_name: s.types.find((t) => t.id === u.accommodation_type_id)!.name }));
    const stays = s.bookings.filter((b) => b.arrival < to && from < b.departure && !['cancelled', 'no_show', 'expired', 'draft'].includes(b.status)).flatMap((b) => {
      const g = guestOf(s, b.booker_guest_id);
      const paid = paidOf(s, b.id);
      return b.stays.filter((st) => st.is_active).map((st) => ({
        stay_id: st.id, unit_id: st.unit_id, stay: rangeStr(b.arrival, b.departure), booking_id: b.id, number: b.number, status: b.status, payment_state: b.payment_state,
        total_minor: b.total_minor, balance_minor: b.total_minor - paid, adults: b.adults, children_ages: b.children_ages, channel_code: b.channel_code, last_name: g.last_name, first_name: g.first_name,
      }));
    });
    const blocks = s.blocks.filter((bl) => bl.from < to && from < bl.to).map((bl) => ({ id: bl.id, unit_id: bl.unit_id, accommodation_type_id: bl.accommodation_type_id, period: rangeStr(bl.from, bl.to), reason: bl.reason }));
    return { from, to, units, stays, blocks };
  }],

  ['GET', /^\/bookings$/, (s, _m, p) => {
    const text = q(p, 'q').toLowerCase();
    return s.bookings
      .filter((b) => {
        const g = guestOf(s, b.booker_guest_id);
        return (!text || b.number.toLowerCase().includes(text) || g.last_name.toLowerCase().includes(text))
          && (!p.get('status') || b.status === p.get('status'))
          && (!p.get('arrivalFrom') || b.arrival >= q(p, 'arrivalFrom'))
          && (!p.get('arrivalTo') || b.arrival <= q(p, 'arrivalTo'));
      })
      .sort((a, b) => b.arrival.localeCompare(a.arrival))
      .map((b) => {
        const g = guestOf(s, b.booker_guest_id);
        return { id: b.id, number: b.number, status: b.status, payment_state: b.payment_state, arrival: b.arrival, departure: b.departure, total_minor: b.total_minor, created_at: b.created_at, last_name: g.last_name, first_name: g.first_name, channel_code: b.channel_code };
      });
  }],
  ['POST', /^\/bookings$/, (s, _m, _p, b) => {
    let guestId = b.guestId as string | undefined;
    if (!guestId) {
      const g = b.guest ?? fail(422, 'Укажите гостя');
      if (!g.lastName || !g.firstName) fail(422, 'Укажите фамилию и имя гостя');
      const ng: DGuest = { id: uid(), last_name: g.lastName, first_name: g.firstName, middle_name: g.middleName ?? null, phone_e164: g.phone ? String(g.phone).replace(/[^\d+]/g, '') : null, email: g.email ?? null, tags: [], created_at: nowIso(), notes: [] };
      s.guests.push(ng);
      guestId = ng.id;
    }
    if (b.overrideRestrictions && !b.overrideReason) fail(422, 'Укажите причину, по которой снимаете ограничения');
    const bk = createBooking(s, {
      guestId, typeId: b.accommodationTypeId, unitId: b.unitId ?? null, planId: b.ratePlanId, arrival: b.arrival, departure: b.departure, adults: b.adults,
      childrenAges: b.childrenAges ?? [], channel: b.channelCode, status: b.status ?? 'confirmed', requests: b.specialRequests ?? null, override: !!b.overrideRestrictions,
    });
    return bookingView(s, bk);
  }],
  ['GET', /^\/bookings\/([^/]+)$/, (s, m) => bookingView(s, bookingOf(s, m[1]))],
  ['GET', /^\/bookings\/([^/]+)\/payments$/, (s, m) => s.payments.filter((p) => p.booking_id === m[1])],
  ['POST', /^\/bookings\/([^/]+)\/status$/, (s, m, _p, b) => {
    const bk = bookingOf(s, m[1]);
    if (b.status === 'confirmed' && !bk.stays.some((st) => st.unit_id && unitFree(s, st.unit_id, bk.arrival, bk.departure, bk.id))) fail(409, 'Номер уже занят на эти даты');
    move(s, bk, b.status, b.reason ?? null);
    return bookingView(s, bk);
  }],
  ['PATCH', /^\/bookings\/([^/]+)\/unit$/, (s, m, _p, b) => {
    const bk = bookingOf(s, m[1]);
    if (!unitFree(s, b.unitId, bk.arrival, bk.departure, bk.id)) fail(409, 'Номер занят на эти даты');
    const st = bk.stays.find((x) => x.is_active) ?? bk.stays[0];
    st.unit_id = b.unitId;
    return bookingView(s, bk);
  }],
  ['PATCH', /^\/bookings\/([^/]+)\/dates$/, (s, m, _p, b) => {
    const bk = bookingOf(s, m[1]);
    if (b.departure <= b.arrival) fail(422, 'Выезд должен быть позже заезда');
    const st = bk.stays.find((x) => x.is_active) ?? bk.stays[0];
    if (st.unit_id && !unitFree(s, st.unit_id, b.arrival, b.departure, bk.id)) fail(409, 'Номер занят на новые даты');
    // Цена уже назначенных ночей сохраняется, новые ночи считаются по текущему тарифу
    const q2 = quoteFor(s, bk.rate_plan_id, st.accommodation_type_id, b.arrival, b.departure, bk.adults, bk.children_ages.length);
    const old = new Map(bk.nights.map((n) => [n.night, n.amount_minor]));
    bk.nights = q2.nights.map((n) => ({ booking_stay_id: st.id, night: n.night, amount_minor: old.get(n.night) ?? n.amountMinor }));
    bk.arrival = b.arrival;
    bk.departure = b.departure;
    bk.total_minor = bk.nights.reduce((a, n) => a + n.amount_minor, 0);
    updatePaymentState(s, bk);
    return bookingView(s, bk);
  }],
  ['POST', /^\/payments\/([^/]+)\/refunds$/, (s, m, _p, b) => {
    const p = s.payments.find((x) => x.id === m[1]) ?? fail(404, 'Платёж не найден');
    if (b.amountMinor <= 0 || p.refunded_minor + b.amountMinor > p.amount_minor) fail(422, 'Сумма возврата больше оплаченной');
    p.refunded_minor += b.amountMinor;
    updatePaymentState(s, bookingOf(s, p.booking_id));
    return { status: 'succeeded' };
  }],

  ['GET', /^\/guests$/, (s, _m, p) => {
    const text = q(p, 'q').toLowerCase();
    return s.guests
      .filter((g) => !text || [g.last_name, g.first_name, g.phone_e164 ?? '', g.email ?? ''].some((v) => v.toLowerCase().includes(text)))
      .sort((a, b) => a.last_name.localeCompare(b.last_name, 'ru'))
      .map(({ notes, ...g }) => g);
  }],
  ['GET', /^\/guests\/([^/]+)$/, (s, m) => {
    const g = guestOf(s, m[1]);
    const bookings = s.bookings.filter((b) => b.booker_guest_id === g.id).sort((a, b) => b.arrival.localeCompare(a.arrival));
    return {
      ...g,
      bookings: bookings.map((b) => ({ id: b.id, number: b.number, status: b.status, arrival: b.arrival, departure: b.departure, total_minor: b.total_minor })),
      consents: [{ id: `${g.id}-pd`, kind: 'pd_processing', granted_at: g.created_at, revoked_at: null }],
      total_spent_minor: bookings.reduce((a, b) => a + paidOf(s, b.id), 0),
    };
  }],
  ['PUT', /^\/guests\/([^/]+)$/, (s, m, _p, b) => {
    const g = guestOf(s, m[1]);
    Object.assign(g, { last_name: b.lastName, first_name: b.firstName, middle_name: b.middleName ?? null, phone_e164: b.phone ?? null, email: b.email ?? null, tags: b.tags ?? [] });
    return g;
  }],
];

/** Ответ демо-«сервера» на запрос админки */
export async function demoApi(method: string, path: string, body?: unknown): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 60));
  const [p, qs = ''] = path.split('?');
  const params = new URLSearchParams(qs);
  const s = load();
  for (const [m, re, h] of ROUTES) {
    if (m !== method) continue;
    const match = p.match(re);
    if (!match) continue;
    const res = h(s, match, params, body ?? {});
    if (method !== 'GET') save();
    return JSON.parse(JSON.stringify(res ?? null));
  }
  return fail(404, 'В демо-версии этот раздел недоступен');
}

