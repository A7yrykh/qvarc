import { describe, expect, it } from 'vitest';
import { decideNight, demandScore, discountFor, pickFloor, type PricingParams } from './competitor-pricing';

const p: PricingParams = { minDiscountPct: 20, maxDiscountPct: 30, reference: 'min', occupancyLowPct: 30, occupancyHighPct: 80, lastMinuteDays: 3, roundToMinor: 10_000, surgeMinBookings: 2, surgeMarkupPct: 10 };
const night = (over: object = {}) => ({
  occupied: 0, total: 4, leadDays: 30, floorMinor: 300_000, currentMinor: 500_000,
  quotes: [{ competitor: 'Верт', priceMinor: 1_000_000 }, { competitor: 'Гости', priceMinor: 800_000 }],
  ...over,
});

describe('цена от соседей', () => {
  it('нет спроса — скидка 30% от самого дешёвого соседа', () => {
    const d = decideNight(night(), p);
    expect(d.kind).toBe('price');
    if (d.kind !== 'price') return;
    expect(d.reasons.referenceMinor).toBe(800_000);
    expect(d.reasons.discountPct).toBe(30);
    expect(d.suggestedMinor).toBe(560_000);
  });

  it('высокий спрос — скидка 20%', () => {
    const d = decideNight(night({ occupied: 4, total: 5 }), p);
    expect(d.kind === 'price' && d.suggestedMinor).toBe(640_000);
  });

  it('средний спрос — скидка между 20 и 30%', () => {
    expect(demandScore(2, 4, 30, p)).toBe(0.4);
    expect(discountFor(0.4, p)).toBe(26);
  });

  it('за несколько дней до заезда незанятые номера дешевеют', () => {
    expect(demandScore(3, 4, 2, p)).toBeLessThan(demandScore(3, 4, 10, p));
  });

  it('не ниже минимума', () => {
    const d = decideNight(night({ floorMinor: 600_000 }), p);
    expect(d.kind === 'price' && d.suggestedMinor).toBe(600_000);
    expect(d.kind === 'price' && d.reasons.floorApplied).toBe(true);
  });

  it('по средней цене соседей', () => {
    const d = decideNight(night(), { ...p, reference: 'avg' });
    expect(d.kind === 'price' && d.suggestedMinor).toBe(630_000);
  });

  it('без минимума, без цен соседей и без свободных номеров цена не предлагается', () => {
    expect(decideNight(night({ floorMinor: null }), p)).toMatchObject({ kind: 'skip', reason: 'no_floor' });
    expect(decideNight(night({ quotes: [{ competitor: 'Верт', priceMinor: null }] }), p)).toMatchObject({ kind: 'skip', reason: 'no_competitor_prices' });
    expect(decideNight(night({ occupied: 4 }), p)).toMatchObject({ kind: 'skip', reason: 'no_rooms' });
  });

  it('явно ошибочная цена соседа отбрасывается', () => {
    const d = decideNight(night({ quotes: [{ competitor: 'Верт', priceMinor: 500 }, { competitor: 'Гости', priceMinor: 800_000 }] }), p);
    expect(d.kind === 'price' && d.reasons.referenceMinor).toBe(800_000);
  });

  it('ажиотаж: скидка минимальная и наценка сверху', () => {
    const d = decideNight(night({ recentBookings: 2 }), p);
    expect(d.kind === 'price' && d.suggestedMinor).toBe(700_000);
    expect(d.kind === 'price' && d.reasons.surge).toBe(true);
    expect(decideNight(night({ recentBookings: 1 }), p)).toMatchObject({ suggestedMinor: 560_000 });
  });

  it('при ажиотаже цена не снижается', () => {
    const d = decideNight(night({ recentBookings: 3, currentMinor: 900_000 }), p);
    expect(d.kind === 'price' && d.suggestedMinor).toBe(900_000);
  });

  it('минимум: самый короткий период важнее сезона', () => {
    const floors = [
      { from: '2027-06-01', to: '2027-09-01', minPriceMinor: 500_000, createdAt: new Date(2026, 0, 2) },
      { from: '2027-07-10', to: '2027-07-13', minPriceMinor: 900_000, createdAt: new Date(2026, 0, 1) },
    ];
    expect(pickFloor(floors, '2027-07-11')).toBe(900_000);
    expect(pickFloor(floors, '2027-07-20')).toBe(500_000);
    expect(pickFloor(floors, '2027-10-01')).toBeNull();
  });
});
