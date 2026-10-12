import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import type { StaffUser } from '../iam/auth.decorators';

export const GuestBody = z.object({
  lastName: z.string().trim().min(1).max(100),
  firstName: z.string().trim().min(1).max(100),
  middleName: z.string().trim().max(100).nullable().optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Телефон в международном формате, например +79085870030')
    .nullable()
    .optional(),
  email: z.email().nullable().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().max(50)).max(50).optional(),
});
export type GuestInput = z.infer<typeof GuestBody>;

const CONTACT_FIELDS = ['phone_e164', 'email', 'birth_date'] as const;

@Injectable()
export class GuestsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async create(propertyId: string, input: GuestInput, trx: Database = this.db) {
    return trx
      .insertInto('guest')
      .values({
        property_id: propertyId,
        last_name: input.lastName,
        first_name: input.firstName,
        middle_name: input.middleName ?? null,
        phone_e164: input.phone ?? null,
        email: input.email ?? null,
        preferences: JSON.stringify(input.preferences ?? {}),
        tags: input.tags ?? [],
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
  }

  /** Убирает контакты, если у сотрудника нет права их видеть. */
  private mask<T extends Record<string, unknown>>(row: T, user: StaffUser): T {
    if (user.permissions.has('guest.contacts.read')) return row;
    const copy: Record<string, unknown> = { ...row };
    for (const f of CONTACT_FIELDS) if (f in copy) copy[f] = null;
    return copy as T;
  }

  async search(user: StaffUser, q: string) {
    const term = q.trim();
    let query = this.db
      .selectFrom('guest')
      .select(['id', 'last_name', 'first_name', 'middle_name', 'phone_e164', 'email', 'tags', 'created_at'])
      .where('property_id', '=', user.propertyId)
      .where('merged_into_id', 'is', null);
    if (term) {
      const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
      query = query.where((eb) => {
        const ors = [eb(sql`lower(last_name)`, 'like', like.toLowerCase())];
        // Поиск по контактам только для тех, кто может их видеть
        if (user.permissions.has('guest.contacts.read')) {
          ors.push(eb('phone_e164', 'like', like), eb(sql`email::text`, 'ilike', like));
        }
        return eb.or(ors);
      });
    }
    const rows = await query.orderBy('last_name').limit(50).execute();
    return rows.map((r) => this.mask(r, user));
  }

  async get(user: StaffUser, id: string, ip: string | null) {
    const guest = await this.db
      .selectFrom('guest')
      .selectAll()
      .where('id', '=', id)
      .where('property_id', '=', user.propertyId)
      .executeTakeFirst();
    if (!guest) throw new NotFoundException('Гость не найден');
    const stays = await this.db
      .selectFrom('booking as b')
      .leftJoin('booking_guest as bg', 'bg.booking_id', 'b.id')
      .select(['b.id', 'b.number', 'b.status', 'b.arrival', 'b.departure', 'b.total_minor'])
      .where((eb) => eb.or([eb('b.booker_guest_id', '=', id), eb('bg.guest_id', '=', id)]))
      .groupBy('b.id')
      .orderBy('b.arrival', 'desc')
      .execute();
    const consents = await this.db.selectFrom('guest_consent').selectAll().where('guest_id', '=', id).execute();
    const notes = await this.db.selectFrom('guest_note').selectAll().where('guest_id', '=', id).orderBy('created_at', 'desc').execute();
    if (user.permissions.has('guest.contacts.read')) {
      await this.audit.write({ propertyId: user.propertyId, actorId: user.id, action: 'guest.pii.view', entity: 'guest', entityId: id, ip });
    }
    const spent = stays.filter((s) => s.status === 'checked_out').reduce((a, s) => a + s.total_minor, 0);
    return { ...this.mask(guest, user), bookings: stays, consents, notes, total_spent_minor: spent };
  }

  async update(user: StaffUser, id: string, input: GuestInput, ip: string | null) {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('guest')
        .selectAll()
        .where('id', '=', id)
        .where('property_id', '=', user.propertyId)
        .forUpdate()
        .executeTakeFirst();
      if (!before) throw new NotFoundException('Гость не найден');
      const after = await trx
        .updateTable('guest')
        .set({
          last_name: input.lastName,
          first_name: input.firstName,
          middle_name: input.middleName ?? null,
          phone_e164: input.phone ?? null,
          email: input.email ?? null,
          preferences: JSON.stringify(input.preferences ?? before.preferences),
          tags: input.tags ?? before.tags,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.write({ propertyId: user.propertyId, actorId: user.id, action: 'guest.update', entity: 'guest', entityId: id, before, after, ip }, trx);
      return this.mask(after, user);
    });
  }
}
