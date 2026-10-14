import { z } from 'zod';
import { isoDate, money, uuid } from '../common/validation';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате ЧЧ:ММ');
const text = (max: number) => z.string().trim().max(max).nullish();
const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const ServiceBody = z
  .object({
    category: z.enum(['rental', 'water', 'excursion', 'food', 'room_extra', 'custom']),
    name: z.string().trim().min(1).max(200),
    description: text(2000),
    pricing: z.enum(['per_item', 'per_hour', 'per_day', 'per_person', 'per_stay']).default('per_item'),
    priceMinor: money,
    durationMinutes: z.number().int().min(5).max(1440).nullish(),
    minAge: z.number().int().min(0).max(99).nullish(),
    rules: text(2000),
    cancellationText: text(1000),
    openTime: time.default('09:00'),
    closeTime: time.default('21:00'),
    slotStepMinutes: z.number().int().min(5).max(720).default(60),
    maxQuantity: z.number().int().min(1).max(100).default(1),
    requiresConfirmation: z.boolean().default(false),
    equipmentTypeId: uuid.nullish(),
    photos: z.array(z.url().max(500)).max(20).optional(),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    bookableOnline: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine((s) => s.closeTime > s.openTime, { message: 'Закрытие позже открытия', path: ['closeTime'] })
  .refine((s) => !s.equipmentTypeId || !!s.durationMinutes, { message: 'Для проката укажите длительность сеанса', path: ['durationMinutes'] });

export const EquipmentTypeBody = z.object({
  name: z.string().trim().min(1).max(200),
  depositMinor: money.default(0),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  isActive: z.boolean().default(true),
});

export const EquipmentUnitBody = z.object({
  inventoryNo: z.string().trim().min(1).max(50),
  condition: z.enum(['ok', 'needs_check', 'damaged', 'retired']).default('ok'),
  notes: text(500),
});

/** Бронь услуги: в админке и на сайте — к брони проживания, в приложении — к своей брони */
export const ServiceBookingBody = z.object({
  serviceId: uuid,
  bookingId: uuid,
  startsAt: dateTime.nullish(),
  quantity: z.number().int().min(1).max(100).default(1),
  comment: text(1000),
});

export const ActionBody = z.object({ needsCheck: z.boolean().optional() });
export const DateQuery = isoDate;
export const IdempotencyKey = z.string().min(8).max(100);
