import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CONFIG } from '../common/tokens';
import type { AppConfig } from '../config';
import { CheckinService } from './checkin.service';
import { GuestAuthService } from './guest-auth.service';

/** Раз в час: удаление паспортных данных после срока хранения, старых SMS-кодов и сессий. */
@Injectable()
export class GuestJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('GuestJobs');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly checkin: CheckinService,
    private readonly auth: GuestAuthService,
  ) {}

  onModuleInit() {
    if (!this.config.jobs) return;
    this.timer = setInterval(() => void this.run(), 3_600_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    try {
      await this.checkin.purgeExpiredDocuments();
      await this.auth.cleanup();
    } catch (e) {
      this.log.error(e instanceof Error ? e.stack : String(e));
    }
  }
}
