import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { setActor, type Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import { PaymentsService } from '../payments/payments.service';

/**
 * Снятие просроченных удержаний: неоплаченная вовремя бронь получает статус «Истекла», номер освобождается.
 * Перед снятием платёж сверяется с эквайером, чтобы не снять уже оплаченную бронь.
 * Несколько копий API не мешают друг другу: строки берутся с SKIP LOCKED.
 */
@Injectable()
export class HoldsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Holds');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (!this.config.jobs) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.expireDue()
        .catch((e) => this.log.error(e instanceof Error ? e.stack : String(e)))
        .finally(() => (this.running = false));
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async expireDue(now: Date = new Date()) {
    const due = await this.db
      .selectFrom('booking')
      .select('id')
      .where('status', '=', 'pending_payment')
      .where('hold_expires_at', '<', now)
      .orderBy('hold_expires_at')
      .limit(50)
      .execute();
    let expired = 0;
    for (const { id } of due) {
      // Сначала сверка и отмена платежей у эквайера: успешная оплата подтвердит бронь
      await this.payments.cancelPending(id);
      const done = await this.db.transaction().execute(async (trx) => {
        await setActor(trx, null, 'system', 'Истекло время оплаты');
        const b = await trx
          .selectFrom('booking')
          .select(['id', 'status', 'property_id', 'hold_expires_at'])
          .where('id', '=', id)
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!b || b.status !== 'pending_payment' || !b.hold_expires_at || b.hold_expires_at > now) return false;
        await trx.updateTable('booking').set({ status: 'expired', hold_expires_at: null }).where('id', '=', id).execute();
        await this.audit.write({ propertyId: b.property_id, actorType: 'system', actorId: null, action: 'booking.hold_expired', entity: 'booking', entityId: id }, trx);
        return true;
      });
      if (done) expired++;
    }
    if (expired) this.log.log(`Снято просроченных удержаний: ${expired}`);
    return expired;
  }
}
