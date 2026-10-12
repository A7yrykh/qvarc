import { diffDays } from './dates';

export interface CancellationTier {
  days_before: number; // отмена не позже чем за столько дней до заезда
  penalty_pct: number; // удержание в процентах от стоимости
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
  }
  const sorted = [...tiers].sort((a, b) => b.days_before - a.days_before);
  if (sorted[sorted.length - 1].days_before !== 0)
    throw new Error('Условия отмены должны описывать отмену в день заезда (days_before = 0)');
  return sorted;
}

/** Удержание при отмене: первая ступень, для которой до заезда осталось не меньше days_before дней. */
export function cancellationPenaltyMinor(
  tiers: CancellationTier[],
  totalMinor: number,
  arrival: string,
  cancelDate: string,
): number {
  const daysLeft = diffDays(cancelDate, arrival);
  const sorted = validateCancellationPolicy(tiers);
  const tier = daysLeft < 0 ? { penalty_pct: 100 } : sorted.find((t) => daysLeft >= t.days_before)!;
  return Math.round((totalMinor * tier.penalty_pct) / 100);
}

export function prepaymentMinor(policy: PrepaymentPolicy, totalMinor: number): number {
  assertPct(policy.pct);
  return Math.round((totalMinor * policy.pct) / 100);
}
