import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Database } from '../../../../packages/db/src';
import type { AppConfig } from '../config';
import { AuditService } from './audit.service';
import { CONFIG, DB } from './tokens';

@Global()
@Module({
  providers: [
    { provide: DB, inject: [CONFIG], useFactory: (c: AppConfig) => createDb(c.databaseUrl) },
    AuditService,
  ],
  exports: [DB, AuditService],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Database) {}
  async onApplicationShutdown() {
    await this.db.destroy();
  }
}
