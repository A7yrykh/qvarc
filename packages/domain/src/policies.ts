import { diffDays } from './dates';

export interface CancellationTier {
  days_before: number; // отмена не позже чем за столько дней до заезда
  penalty_pct: number; // удержание в процентах от стоимости
  /** Удержание стоимостью первых ночей (как в правилах «Кварца»: штраф в размере первых суток). Если задано, penalty_pct не используется. */
  penalty_nights?: number;
}

export interface PrepaymentPolicy {
  pct: number; // доля предоплаты, 0–100
  due: 'at_booking' | 'days_before_arrival';
  days?: number;
}

function assertPct(v: number) {
  if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`Процент вне диапазона 0–100: ${v}`);
}

export function validateCancellationPolicy(tiers: CancellationTier[]): CancellationTier[] {
  if (!Array.isArray(tiers) || tiers.length === 0) throw new Error('Условия отмены не заданы');
  for (const t of tiers) {
    if (!Number.isInteger(t.days_before) || t.days_before < 0) throw new Error('days_before должно быть целым ≥ 0');
    assertPct(t.penalty_pct);
    if (t.penalty_nights !== undefined && (!Number.isInteger(t.penalty_nights) || t.penalty_nights < 0 || t.penalty_nights > 30))
      throw new Error('penalty_nights должно быть целым от 0 до 30');
  }
  const sorted = [...tiers].sort((a, b) => b.days_before - a.days_before);
  if (sorted[sorted.length - 1].days_before !== 0)
    throw new Error('Условия отмены должны описывать отмену в день заезда (days_before = 0)');
  return sorted;
}

/**
 * Удержание при отмене: первая ступень, для которой до заезда осталось не меньше days_before дней.
 * nightPricesMinor — цены ночей брони по порядку, нужны для ступеней с penalty_nights.
 */
export function cancellationPenaltyMinor(
  tiers: CancellationTier[],
  totalMinor: number,
  arrival: string,
  cancelDate: string,
  nightPricesMinor?: number[],
): number {
  const daysLeft = diffDays(cancelDate, arrival);
  const sorted = validateCancellationPolicy(tiers);
  const tier: CancellationTier = daysLeft < 0 ? { days_before: 0, penalty_pct: 100 } : sorted.find((t) => daysLeft >= t.days_before)!;
  if (tier.penalty_nights !== undefined) {
    if (!nightPricesMinor?.length) throw new Error('Для удержания за ночи нужны цены ночей брони');
    const sum = nightPricesMinor.slice(0, tier.penalty_nights).reduce((a, b) => a + b, 0);
    return Math.min(totalMinor, sum);
  }
  return Math.round((totalMinor * tier.penalty_pct) / 100);
}

export function prepaymentMinor(policy: PrepaymentPolicy, totalMinor: number): number {
  assertPct(policy.pct);
  return Math.round((totalMinor * policy.pct) / 100);
}

/** Сезон в днях года, «ММ-ДД». from > to означает переход через Новый год. */
export interface DepositSeason {
  name: string;
  from: string;
  to: string; // включительно
}

/**
 * Сезонный депозит (договор-оферта п.5): при отмене меньше чем за days_before дней до заезда в сезон
 * оплата не возвращается деньгами, а остаётся на депозите гостя для будущего проживания.
 */
export interface DepositPolicy {
  days_before: number;
  seasons: DepositSeason[];
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function validateDepositPolicy(p: DepositPolicy): DepositPolicy {
  if (!Number.isInteger(p.days_before) || p.days_before < 1) throw new Error('days_before депозита должно быть целым ≥ 1');
  if (!Array.isArray(p.seasons) || p.seasons.length === 0) throw new Error('Не заданы сезоны депозита');
  for (const s of p.seasons) if (!MMDD.test(s.from) || !MMDD.test(s.to)) throw new Error(`Сезон «${s.name}»: даты в формате ММ-ДД`);
  return p;
}

/** Сезон, в который попадает дата заезда, или null */
export function seasonOf(seasons: DepositSeason[], date: string): DepositSeason | null {
  const md = date.slice(5, 10);
  return seasons.find((s) => (s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to)) ?? null;
}

/** Действует ли сезонный депозит при отмене в cancelDate брони с заездом arrival */
export function depositApplies(policy: DepositPolicy | null | undefined, arrival: string, cancelDate: string): boolean {
  if (!policy) return false;
  return diffDays(cancelDate, arrival) < policy.days_before && seasonOf(policy.seasons, arrival) !== null;
}

/**
 * Итог отмены: удержание по ступеням, возврат на карту и сумма, остающаяся на депозите.
 * При сезонном депозите вся оплата остаётся на депозите, на карту ничего не возвращается.
 */
export function cancellationOutcome(penaltyMinor: number, paidMinor: number, deposit: boolean) {
  if (deposit) return { penaltyMinor: 0, refundMinor: 0, depositMinor: paidMinor };
  return { penaltyMinor, refundMinor: Math.max(0, paidMinor - penaltyMinor), depositMinor: 0 };
}
