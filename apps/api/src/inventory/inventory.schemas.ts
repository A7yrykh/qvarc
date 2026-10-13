import { z } from 'zod';
import { isoDate, money, uuid } from '../common/validation';

export const TypeBody = z
  .object({
    code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    name: z.string().min(1).max(200),
    kind: z.enum(['room', 'cottage', 'apartment', 'other']),
    areaM2: z.number().positive().max(10_000).nullable().optional(),
    baseOccupancy: z.number().int().min(1).max(50),
    maxAdults: z.number().int().min(1).max(50),
    maxChildren: z.number().int().min(0).max(50).default(0),
    maxOccupancy: z.number().int().min(1).max(50),
    description: z.string().max(5000).nullable().optional(),
    amenities: z.array(z.string().max(100)).max(100).default([]),
    /** Фото: адрес (https:// или путь от корня модуля бронирования) и подпись. Не передано — фото не меняются. */
    photos: z
      .array(z.object({ url: z.string().max(500).regex(/^(https:\/\/|\/)[^\s"'<>]+$/, 'Адрес фото: https://… или /…'), alt: z.string().max(300).default('') }))
      .max(30)
      .optional(),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
  })
  .refine((t) => t.maxOccupancy >= t.baseOccupancy, { message: 'Максимальная вместимость меньше базовой' })
  .refine((t) => t.maxAdults <= t.maxOccupancy, { message: 'Взрослых больше максимальной вместимости' });

export const UnitBody = z.object({
  accommodationTypeId: uuid,
  name: z.string().min(1).max(100),
  lockSystemRef: z.string().max(100).nullable().optional(),
  isActive: z.boolean().default(true),
});

const Tier = z.object({ days_before: z.number().int().min(0), penalty_pct: z.number().min(0).max(100), penalty_nights: z.number().int().min(0).max(30).optional() });
export const RatePlanBody = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().min(1).max(200),
  mealPlan: z.enum(['none', 'breakfast', 'half_board', 'full_board']).default('none'),
  isRefundable: z.boolean().default(true),
  cancellationPolicy: z.array(Tier).min(1),
  prepaymentPolicy: z.object({
    pct: z.number().min(0).max(100),
    due: z.enum(['at_booking', 'days_before_arrival']),
    days: z.number().int().min(0).optional(),
  }),
  /** Сезонный депозит по оферте: поздняя отмена в сезон оставляет оплату на депозите гостя */
  depositPolicy: z
    .object({
      days_before: z.number().int().min(1).max(365),
      seasons: z.array(z.object({ name: z.string().min(1).max(100), from: z.string(), to: z.string() })).min(1),
    })
    .nullable()
    .default(null),
  isPublic: z.boolean().default(true),
  accommodationTypeIds: z.array(uuid).min(1),
  isActive: z.boolean().default(true),
});

export const RatePlanTermsBody = RatePlanBody.pick({ cancellationPolicy: true, prepaymentPolicy: true, depositPolicy: true });

export const RateRuleBody = z
  .object({
    ratePlanId: uuid,
    accommodationTypeId: uuid,
    from: isoDate,
    to: isoDate, // не включительно
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5, 6, 7]),
    priority: z.number().int().min(-100).max(1000).default(0),
    priceMinor: money.nullable().default(null),
    extraAdultMinor: money.nullable().default(null),
    extraChildMinor: money.nullable().default(null),
    minStay: z.number().int().min(1).max(365).nullable().default(null),
    maxStay: z.number().int().min(1).max(365).nullable().default(null),
    minLeadDays: z.number().int().min(0).max(365).nullable().default(null),
    closed: z.boolean().default(false),
    closedToArrival: z.boolean().default(false),
    closedToDeparture: z.boolean().default(false),
    label: z.string().max(200).nullable().default(null),
  })
  .refine((r) => r.to > r.from, { message: 'Дата окончания должна быть позже даты начала', path: ['to'] })
  .refine((r) => r.minStay === null || r.maxStay === null || r.minStay <= r.maxStay, {
    message: 'Минимальный срок больше максимального',
  });

export const BlockBody = z
  .object({
    unitId: uuid.optional(),
    accommodationTypeId: uuid.optional(),
    from: isoDate,
    to: isoDate,
    reason: z.enum(['out_of_order', 'owner_use', 'stop_sale']),
    excludesFromInventory: z.boolean().default(true),
  })
  .refine((b) => !!b.unitId !== !!b.accommodationTypeId, { message: 'Укажите либо номер, либо категорию' })
  .refine((b) => b.to > b.from, { message: 'Дата окончания должна быть позже даты начала', path: ['to'] });
