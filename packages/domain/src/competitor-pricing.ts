/**
 * Цена ночи от цен соседей: на min..max% дешевле соседей в зависимости от спроса, но не ниже минимума.
 *
 * Спрос 0..1 считается по нашей загрузке категории на эту ночь:
 * ниже occupancyLow — спроса нет (скидка максимальная), выше occupancyHigh — спрос высокий (скидка минимальная).
 * За last_minute_days до заезда незанятые номера дешевеют: спрос считается вдвое ниже.
 * Ажиотаж (не меньше surgeMinBookings новых броней на эту ночь за последние часы): скидка минимальная,
 * цена поднимается ещё на surgeMarkupPct и не становится ниже текущей.
 */

export interface CompetitorQuote {
  competitor: string;
  /** Цена за ночь у соседа, уже приведённая к нашей категории коэффициентом. NULL — мест нет. */
  priceMinor: number | null;
}

export interface PricingParams {
  minDiscountPct: number;
  maxDiscountPct: number;
  reference: 'min' | 'avg';
  occupancyLowPct: number;
  occupancyHighPct: number;
  lastMinuteDays: number;
  roundToMinor: number;
  surgeMinBookings: number;
  surgeMarkupPct: number;
}

export interface NightInput {
  /** Сколько наших номеров категории занято и сколько всего на эту ночь */
  occupied: number;
  total: number;
  /** Дней до ночи от сегодня */
  leadDays: number;
  /** Новых броней этой категории на эту ночь за последние часы */
  recentBookings?: number;
  quotes: CompetitorQuote[];
  /** Минимальная цена ночи. Без неё цена не предлагается. */
  floorMinor: number | null;
  /** Текущая цена ночи в тарифе */
  currentMinor: number | null;
}

export type NightDecision =
  | {
      kind: 'price';
      suggestedMinor: number;
      reasons: PricingReasons;
    }
  | { kind: 'skip'; reason: 'no_competitor_prices' | 'no_floor' | 'no_rooms'; reasons: Partial<PricingReasons> };

export interface PricingReasons {
  referenceMinor: number;
  reference: 'min' | 'avg';
  competitors: { competitor: string; priceMinor: number | null }[];
  soldOut: string[];
  occupancyPct: number;
  leadDays: number;
  demand: number;
  discountPct: number;
  rawMinor: number;
  floorMinor: number;
  floorApplied: boolean;
  currentMinor: number | null;
  recentBookings: number;
  surge: boolean;
}

/** Явно ошибочные цены соседей (сбой разбора страницы) в расчёт не берутся. */
export const SANE_PRICE_MINOR = { min: 100_000, max: 30_000_000 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function demandScore(occupied: number, total: number, leadDays: number, p: Pick<PricingParams, 'occupancyLowPct' | 'occupancyHighPct' | 'lastMinuteDays'>): number {
  const occ = total > 0 ? (occupied / total) * 100 : 0;
  let d = clamp((occ - p.occupancyLowPct) / (p.occupancyHighPct - p.occupancyLowPct), 0, 1);
  if (leadDays <= p.lastMinuteDays && occ < 100) d = d / 2;
  return Math.round(d * 1000) / 1000;
}

export function discountFor(demand: number, p: Pick<PricingParams, 'minDiscountPct' | 'maxDiscountPct'>): number {
  return Math.round((p.maxDiscountPct - demand * (p.maxDiscountPct - p.minDiscountPct)) * 100) / 100;
}

export function decideNight(input: NightInput, p: PricingParams): NightDecision {
  const competitors = input.quotes.map((q) => ({ competitor: q.competitor, priceMinor: q.priceMinor }));
  const soldOut = input.quotes.filter((q) => q.priceMinor === null).map((q) => q.competitor);
  const prices = input.quotes
    .map((q) => q.priceMinor)
    .filter((v): v is number => v !== null && v >= SANE_PRICE_MINOR.min && v <= SANE_PRICE_MINOR.max);
  const occupancyPct = input.total > 0 ? Math.round((input.occupied / input.total) * 100) : 0;
  const recentBookings = input.recentBookings ?? 0;
  const surge = recentBookings >= p.surgeMinBookings;
  const base = { competitors, soldOut, occupancyPct, leadDays: input.leadDays, currentMinor: input.currentMinor, recentBookings, surge };
  if (input.total > 0 && input.occupied >= input.total) return { kind: 'skip', reason: 'no_rooms', reasons: base };
  if (!prices.length) return { kind: 'skip', reason: 'no_competitor_prices', reasons: base };
  if (input.floorMinor === null) return { kind: 'skip', reason: 'no_floor', reasons: base };

  const referenceMinor = p.reference === 'avg' ? Math.round(prices.reduce((s, v) => s + v, 0) / prices.length) : Math.min(...prices);
  const demand = surge ? 1 : demandScore(input.occupied, input.total, input.leadDays, p);
  const discountPct = discountFor(demand, p);
  const rawMinor = referenceMinor * (1 - discountPct / 100) * (surge ? 1 + p.surgeMarkupPct / 100 : 1);
  let rounded = Math.round(rawMinor / p.roundToMinor) * p.roundToMinor;
  // При ажиотаже цена только растёт
  if (surge && input.currentMinor !== null) rounded = Math.max(rounded, input.currentMinor);
  const floorApplied = rounded < input.floorMinor;
  const suggestedMinor = floorApplied ? input.floorMinor : rounded;
  return {
    kind: 'price',
    suggestedMinor,
    reasons: { ...base, referenceMinor, reference: p.reference, demand, discountPct, rawMinor: Math.round(rawMinor), floorMinor: input.floorMinor, floorApplied },
  };
}

/** Минимум на дату: из подходящих периодов берётся самый короткий, при равенстве — последний заведённый. */
export function pickFloor(floors: { from: string; to: string; minPriceMinor: number; createdAt: Date }[], night: string): number | null {
  const len = (f: { from: string; to: string }) => Date.parse(f.to) - Date.parse(f.from);
  const f = floors
    .filter((x) => x.from <= night && night < x.to)
    .sort((a, b) => len(a) - len(b) || b.createdAt.getTime() - a.createdAt.getTime())[0];
  return f ? f.minPriceMinor : null;
}
