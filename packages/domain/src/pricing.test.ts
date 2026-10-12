import { describe, expect, it } from 'vitest';
import { nightsBetween, todayIn } from './dates';
import { cancellationPenaltyMinor, prepaymentMinor, validateCancellationPolicy } from './policies';
import { quote, RateRuleInput } from './pricing';

const cap = { baseOccupancy: 2, maxAdults: 3, maxChildren: 2, maxOccupancy: 4 };
let seq = 0;
const rule = (p: Partial<RateRuleInput>): RateRuleInput => ({
  id: `r${++seq}`,
  from: '2027-01-01',
  to: '2028-01-01',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  priority: 0,
  createdAt: new Date(2026, 0, seq),
  priceMinor: null,
  extraAdultMinor: null,
  extraChildMinor: null,
  minStay: null,
  maxStay: null,
  minLeadDays: null,
  closed: false,
  closedToArrival: false,
  closedToDeparture: false,
  ...p,
});
const base = rule({ priceMinor: 500_000, extraAdultMinor: 150_000, extraChildMinor: 100_000 });
const weekend = rule({ weekdays: [5, 6], priority: 10, priceMinor: 700_000 });
const summer = rule({ from: '2027-07-01', to: '2027-09-01', priority: 5, priceMinor: 900_000, minStay: 2 });
const req = { adults: 2, children: 0, today: '2027-01-10' };

describe('даты', () => {
  it('ночи не включают день выезда', () => {
    expect(nightsBetween('2027-03-30', '2027-04-02')).toEqual(['2027-03-30', '2027-03-31', '2027-04-01']);
  });
  it('выезд раньше заезда — ошибка', () => {
    expect(() => nightsBetween('2027-03-02', '2027-03-02')).toThrow();
  });
  it('сегодня в часовом поясе объекта', () => {
    // 20:00 UTC 31 декабря — в Екатеринбурге (UTC+5) уже 1 января
    expect(todayIn('Asia/Yekaterinburg', new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });
});

describe('расчёт цены', () => {
  it('будни по базовой цене, пятница и суббота по цене выходных', () => {
    // 2027-03-03 среда … 2027-03-07 воскресенье (выезд)
    const q = quote([base, weekend], cap, { ...req, arrival: '2027-03-03', departure: '2027-03-07' });
    expect(q.nights.map((n) => n.amountMinor)).toEqual([500_000, 500_000, 700_000, 700_000]);
    expect(q.totalMinor).toBe(2_400_000);
    expect(q.bookable).toBe(true);
  });

  it('сезон перекрывает базу, выходные перекрывают сезон по цене, минимальный срок берётся из сезона', () => {
    const q = quote([base, weekend, summer], cap, { ...req, arrival: '2027-07-08', departure: '2027-07-09' });
    expect(q.restrictions).toContainEqual({ code: 'min_stay', value: 2 });
    const q2 = quote([base, weekend, summer], cap, { ...req, arrival: '2027-07-08', departure: '2027-07-10' });
    // четверг — сезон, пятница — выходные
    expect(q2.nights.map((n) => n.amountMinor)).toEqual([900_000, 700_000]);
    expect(q2.bookable).toBe(true);
  });

  it('доплата за третьего взрослого и ребёнка сверх базовой вместимости', () => {
    const q = quote([base], cap, { ...req, adults: 3, children: 1, arrival: '2027-03-01', departure: '2027-03-02' });
    expect(q.totalMinor).toBe(500_000 + 150_000 + 100_000);
  });

  it('ребёнок на свободном базовом месте без доплаты', () => {
    const q = quote([base], cap, { ...req, adults: 1, children: 1, arrival: '2027-03-01', departure: '2027-03-02' });
    expect(q.totalMinor).toBe(500_000);
  });

  it('гостей больше вместимости — бронь невозможна', () => {
    const q = quote([base], cap, { ...req, adults: 3, children: 2, arrival: '2027-03-01', departure: '2027-03-02' });
    expect(q.restrictions.map((r) => r.code)).toContain('too_many_guests');
    expect(q.bookable).toBe(false);
  });

  it('нет цены на ночь — бронь невозможна', () => {
    const q = quote([base], cap, { ...req, arrival: '2027-12-31', departure: '2028-01-02' });
    expect(q.restrictions).toContainEqual({ code: 'no_price', night: '2028-01-01' });
  });

  it('закрытые даты, запрет заезда и выезда, срок до заезда', () => {
    const rules = [
      base,
      rule({ from: '2027-05-09', to: '2027-05-10', closed: true }),
      rule({ from: '2027-05-01', to: '2027-05-02', closedToArrival: true }),
      rule({ from: '2027-05-04', to: '2027-05-05', closedToDeparture: true }),
      rule({ from: '2027-01-11', to: '2027-01-20', minLeadDays: 3 }),
    ];
    const codes = (a: string, d: string) =>
      quote(rules, cap, { ...req, arrival: a, departure: d }).restrictions.map((r) => r.code);
    expect(codes('2027-05-08', '2027-05-10')).toEqual(['closed']);
    expect(codes('2027-05-01', '2027-05-03')).toEqual(['closed_to_arrival']);
    expect(codes('2027-05-02', '2027-05-04')).toEqual(['closed_to_departure']);
    expect(codes('2027-01-11', '2027-01-12')).toEqual(['min_lead_days']);
    expect(codes('2027-01-09', '2027-01-12')).toContain('arrival_in_past');
  });
});

describe('условия отмены и предоплата', () => {
  const tiers = [
    { days_before: 0, penalty_pct: 100 },
    { days_before: 14, penalty_pct: 0 },
    { days_before: 3, penalty_pct: 30 },
  ];
  it('ступени удержания', () => {
    expect(cancellationPenaltyMinor(tiers, 1_000_000, '2027-07-20', '2027-07-01')).toBe(0);
    expect(cancellationPenaltyMinor(tiers, 1_000_000, '2027-07-20', '2027-07-10')).toBe(300_000);
    expect(cancellationPenaltyMinor(tiers, 1_000_000, '2027-07-20', '2027-07-19')).toBe(1_000_000);
  });
  it('условия без ступени на день заезда отклоняются', () => {
    expect(() => validateCancellationPolicy([{ days_before: 3, penalty_pct: 0 }])).toThrow();
  });
  it('предоплата 30%', () => {
    expect(prepaymentMinor({ pct: 30, due: 'at_booking' }, 1_234_567)).toBe(370_370);
  });
});
