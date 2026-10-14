import { z } from 'zod';
import { isoDate, money, uuid } from '../common/validation';

export const SettingsBody = z
  .object({
    autoApply: z.boolean(),
    ratePlanId: uuid.nullable().optional(),
    minDiscountPct: z.number().min(0).max(89),
    maxDiscountPct: z.number().min(0).max(89),
    reference: z.enum(['min', 'avg']).default('min'),
    horizonDays: z.number().int().min(1).max(365),
    occupancyLowPct: z.number().int().min(0).max(100),
    occupancyHighPct: z.number().int().min(0).max(100),
    lastMinuteDays: z.number().int().min(0).max(60),
    collectEveryHours: z.number().int().min(1).max(168),
    roundToMinor: z.number().int().positive().default(10_000),
  })
  .refine((s) => s.minDiscountPct <= s.maxDiscountPct, { message: 'Наименьшая скидка больше наибольшей' })
  .refine((s) => s.occupancyLowPct < s.occupancyHighPct, { message: 'Порог низкой загрузки должен быть ниже порога высокой' });

export const CompetitorBody = z
  .object({
    name: z.string().min(1).max(200),
    siteUrl: z.string().url().max(500).nullable().optional(),
    sourceKind: z.enum(['manual', 'page']).default('manual'),
    sourceRef: z.string().max(500).nullable().optional(),
    isActive: z.boolean().default(true),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((c) => c.sourceKind === 'manual' || /^https:\/\/\S+$/.test(c.sourceRef ?? ''), { message: 'Для сбора со страницы укажите её адрес https://…', path: ['sourceRef'] });

export const CategoryBody = z.object({
  externalRef: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  accommodationTypeId: uuid.nullable().optional(),
  factor: z.number().positive().max(5).default(1),
});

export const ManualPriceBody = z
  .object({
    competitorId: uuid,
    externalRef: z.string().min(1).max(200),
    from: isoDate,
    to: isoDate,
    priceMinor: money.nullable(),
  })
  .refine((b) => b.to > b.from, { message: 'Конец периода раньше начала' });

export const FloorBody = z
  .object({
    accommodationTypeId: uuid,
    from: isoDate,
    to: isoDate,
    minPriceMinor: money.refine((v) => v > 0, 'Минимум больше нуля'),
    label: z.string().max(200).nullable().optional(),
  })
  .refine((b) => b.to > b.from, { message: 'Конец периода раньше начала' });

export const DecideBody = z.object({ ids: z.array(uuid).min(1).max(500), accept: z.boolean() });

export const RecQuery = z.object({
  status: z.enum(['proposed', 'accepted', 'rejected', 'expired']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export const PricesQuery = z.object({ from: isoDate, to: isoDate }).refine((q) => q.to > q.from, { message: 'Конец периода раньше начала' });
