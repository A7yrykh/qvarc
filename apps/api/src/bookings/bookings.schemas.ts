import { z } from 'zod';
import { GuestBody } from '../guests/guests.service';
import { isoDate, uuid } from '../common/validation';

export const QuoteBody = z
  .object({
    accommodationTypeId: uuid,
    ratePlanId: uuid,
    arrival: isoDate,
    departure: isoDate,
    adults: z.number().int().min(1).max(50),
    childrenAges: z.array(z.number().int().min(0).max(17)).max(20).default([]),
  })
  .refine((b) => b.departure > b.arrival, { message: 'Дата выезда должна быть позже даты заезда', path: ['departure'] });

export const SearchQuery = z
  .object({
    arrival: isoDate,
    departure: isoDate,
    adults: z.coerce.number().int().min(1).max(50),
    children: z.coerce.number().int().min(0).max(20).default(0),
  })
  .refine((b) => b.departure > b.arrival, { message: 'Дата выезда должна быть позже даты заезда', path: ['departure'] });

export const CreateBookingBody = z
  .object({
    guestId: uuid.optional(),
    guest: GuestBody.optional(),
    accommodationTypeId: uuid,
    ratePlanId: uuid,
    unitId: uuid.optional(),
    arrival: isoDate,
    departure: isoDate,
    adults: z.number().int().min(1).max(50),
    childrenAges: z.array(z.number().int().min(0).max(17)).max(20).default([]),
    status: z.enum(['confirmed', 'pending_payment', 'pending_confirmation']).default('confirmed'),
    channelCode: z.string().default('front_desk'),
    specialRequests: z.string().max(2000).nullable().optional(),
    idempotencyKey: z.string().min(8).max(100).optional(),
    // Администратор может принять бронь вопреки ограничениям тарифа (мин. срок, закрытый заезд), но не вопреки занятости
    overrideRestrictions: z.boolean().default(false),
    overrideReason: z.string().max(500).optional(),
  })
  .refine((b) => !!b.guestId !== !!b.guest, { message: 'Укажите либо существующего гостя, либо данные нового' })
  .refine((b) => b.departure > b.arrival, { message: 'Дата выезда должна быть позже даты заезда', path: ['departure'] })
  .refine((b) => !b.overrideRestrictions || !!b.overrideReason, { message: 'Укажите причину обхода ограничений', path: ['overrideReason'] });

export const MoveBody = z.object({ unitId: uuid, reason: z.string().max(500).optional() });

export const ChangeDatesBody = z
  .object({ arrival: isoDate, departure: isoDate, reason: z.string().max(500).optional() })
  .refine((b) => b.departure > b.arrival, { message: 'Дата выезда должна быть позже даты заезда', path: ['departure'] });

export const StatusBody = z.object({
  status: z.enum(['pending_payment', 'pending_confirmation', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show']),
  reason: z.string().max(500).optional(),
});

export const CalendarQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((b) => b.to > b.from, { message: 'Конец периода раньше начала' });

export const ListQuery = z.object({
  q: z.string().max(100).optional(),
  arrivalFrom: isoDate.optional(),
  arrivalTo: isoDate.optional(),
  status: z.string().optional(),
});
