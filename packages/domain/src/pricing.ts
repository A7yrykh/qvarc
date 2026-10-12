import { addDays, diffDays, isoWeekday, nightsBetween } from './dates';

export interface RateRuleInput {
  id: string;
  from: string; // включительно
  to: string; // не включительно
  weekdays: number[];
  priority: number;
  createdAt: Date;
  priceMinor: number | null;
  extraAdultMinor: number | null;
  extraChildMinor: number | null;
  minStay: number | null;
  maxStay: number | null;
  minLeadDays: number | null;
  closed: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

export interface Capacity {
  baseOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
}

export interface QuoteRequest {
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  today: string; // сегодня в часовом поясе объекта
}

export type RestrictionCode =
  | 'too_many_guests'
  | 'no_price'
  | 'closed'
  | 'closed_to_arrival'
  | 'closed_to_departure'
  | 'min_stay'
  | 'max_stay'
  | 'min_lead_days'
  | 'arrival_in_past';

export interface Restriction {
  code: RestrictionCode;
  night?: string;
  value?: number;
}

export interface NightPrice {
  night: string;
  amountMinor: number;
}

export interface Quote {
  nights: NightPrice[];
  totalMinor: number;
  restrictions: Restriction[];
  bookable: boolean;
}

interface Resolved {
  priceMinor: number | null;
  extraAdultMinor: number | null;
  extraChildMinor: number | null;
  minStay: number | null;
  maxStay: number | null;
  minLeadDays: number | null;
  closed: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

/**
 * Правила на дату. Числовые поля берутся из самого приоритетного правила, где поле задано:
 * так «выходные» могут менять только цену, а «сезон» задавать минимальный срок.
 * Запреты (closed, closed_to_*) суммируются: достаточно одного правила.
 */
export function resolveRules(rules: RateRuleInput[], date: string): Resolved {
  const weekday = isoWeekday(date);
  const applicable = rules
    .filter((r) => r.from <= date && date < r.to && r.weekdays.includes(weekday))
    .sort((a, b) => b.priority - a.priority || b.createdAt.getTime() - a.createdAt.getTime());
  const pick = <K extends keyof RateRuleInput>(key: K) =>
    (applicable.find((r) => r[key] !== null)?.[key] ?? null) as RateRuleInput[K] | null;
  return {
    priceMinor: pick('priceMinor'),
    extraAdultMinor: pick('extraAdultMinor'),
    extraChildMinor: pick('extraChildMinor'),
    minStay: pick('minStay'),
    maxStay: pick('maxStay'),
    minLeadDays: pick('minLeadDays'),
    closed: applicable.some((r) => r.closed),
    closedToArrival: applicable.some((r) => r.closedToArrival),
    closedToDeparture: applicable.some((r) => r.closedToDeparture),
  };
}

/**
 * Цена ночи: базовая цена за base_occupancy гостей, сверх неё доплата
 * сначала за взрослых, затем за детей.
 */
export function nightPrice(resolved: Resolved, capacity: Capacity, adults: number, children: number): number | null {
  if (resolved.priceMinor === null) return null;
  const extraAdults = Math.max(0, adults - capacity.baseOccupancy);
  const freeSlotsForChildren = Math.max(0, capacity.baseOccupancy - adults);
  const extraChildren = Math.max(0, children - freeSlotsForChildren);
  if (extraAdults > 0 && resolved.extraAdultMinor === null) return null;
  if (extraChildren > 0 && resolved.extraChildMinor === null) return null;
  return (
    resolved.priceMinor +
    extraAdults * (resolved.extraAdultMinor ?? 0) +
    extraChildren * (resolved.extraChildMinor ?? 0)
  );
}

export function quote(rules: RateRuleInput[], capacity: Capacity, req: QuoteRequest): Quote {
  const restrictions: Restriction[] = [];
  const nights = nightsBetween(req.arrival, req.departure);

  if (
    req.adults < 1 ||
    req.adults > capacity.maxAdults ||
    req.children > capacity.maxChildren ||
    req.adults + req.children > capacity.maxOccupancy
  ) {
    restrictions.push({ code: 'too_many_guests', value: capacity.maxOccupancy });
  }
  if (req.arrival < req.today) restrictions.push({ code: 'arrival_in_past' });

  const prices: NightPrice[] = [];
  for (const night of nights) {
    const r = resolveRules(rules, night);
    if (r.closed) restrictions.push({ code: 'closed', night });
    const amount = nightPrice(r, capacity, req.adults, req.children);
    if (amount === null) restrictions.push({ code: 'no_price', night });
    else prices.push({ night, amountMinor: amount });
  }

  const onArrival = resolveRules(rules, req.arrival);
  if (onArrival.closedToArrival) restrictions.push({ code: 'closed_to_arrival', night: req.arrival });
  if (onArrival.minStay !== null && nights.length < onArrival.minStay)
    restrictions.push({ code: 'min_stay', value: onArrival.minStay });
  if (onArrival.maxStay !== null && nights.length > onArrival.maxStay)
    restrictions.push({ code: 'max_stay', value: onArrival.maxStay });
  if (onArrival.minLeadDays !== null && diffDays(req.today, req.arrival) < onArrival.minLeadDays)
    restrictions.push({ code: 'min_lead_days', value: onArrival.minLeadDays });
  if (resolveRules(rules, req.departure).closedToDeparture)
    restrictions.push({ code: 'closed_to_departure', night: req.departure });

  return {
    nights: prices,
    totalMinor: prices.reduce((s, p) => s + p.amountMinor, 0),
    restrictions,
    bookable: restrictions.length === 0,
  };
}

/** Даты, которые занимает правило, чтобы выбрать из базы только нужные правила. */
export function quoteWindow(arrival: string, departure: string): { from: string; to: string } {
  return { from: arrival, to: addDays(departure, 1) };
}
