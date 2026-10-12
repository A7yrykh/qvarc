import { z } from 'zod';
import { isoDate, uuid } from '../common/validation';

const ages = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').filter(Boolean).map(Number) : []))
  .pipe(z.array(z.number().int().min(0).max(17)).max(10));

export const OffersQuery = z
  .object({
    arrival: isoDate,
    departure: isoDate,
    adults: z.coerce.number().int().min(1).max(20),
    children: ages,
  })
  .refine((q) => q.departure > q.arrival, { message: 'Дата выезда должна быть позже даты заезда', path: ['departure'] });

export const PublicBookingBody = z
  .object({
    accommodationTypeId: uuid,
    ratePlanId: uuid,
    arrival: isoDate,
    departure: isoDate,
    adults: z.number().int().min(1).max(20),
    childrenAges: z.array(z.number().int().min(0).max(17)).max(10).default([]),
    guest: z.object({
      lastName: z.string().trim().min(1).max(100),
      firstName: z.string().trim().min(1).max(100),
      middleName: z.string().trim().max(100).nullable().optional(),
      phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Телефон в международном формате, например +79085870030'),
      email: z.email('Укажите e-mail: на него придут подтверждение и чек'),
    }),
    specialRequests: z.string().trim().max(1000).nullable().optional(),
    consents: z.object({
      pdProcessing: z.literal(true, 'Нужно согласие на обработку персональных данных'),
      marketing: z.boolean().default(false),
    }),
    idempotencyKey: z.string().min(16).max(100),
    utm: z.record(z.string().max(40), z.string().max(200)).optional(),
  })
  .refine((b) => b.departure > b.arrival, { message: 'Дата выезда должна быть позже даты заезда', path: ['departure'] });

export const ManageToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Неверная ссылка');
