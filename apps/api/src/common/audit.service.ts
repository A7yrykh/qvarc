import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '../../../../packages/db/src';
import { DB } from './tokens';

export interface AuditEntry {
  propertyId: string;
  actorType?: 'user' | 'guest' | 'system' | 'channel' | 'provider';
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Запись в журнал. Внутри транзакции передавайте trx, чтобы запись откатилась вместе с изменением. */
  async write(entry: AuditEntry, trx: Database = this.db) {
    await trx
      .insertInto('audit_log')
      .values({
        property_id: entry.propertyId,
        actor_type: entry.actorType ?? 'user',
        actor_id: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entityId ?? null,
        before: entry.before === undefined ? null : JSON.stringify(entry.before),
        after: entry.after === undefined ? null : JSON.stringify(entry.after),
        ip: entry.ip ?? null,
      })
      .execute();
  }
}
