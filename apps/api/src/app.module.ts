import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AvailabilityService } from './bookings/availability.service';
import { HoldsService } from './bookings/holds.service';
import { BookingsController } from './bookings/bookings.controller';
import { BookingsService } from './bookings/bookings.service';
import { DbModule } from './common/db.module';
import { ErrorFilter } from './common/errors';
import { CONFIG } from './common/tokens';
import type { AppConfig } from './config';
import { CheckinService } from './guest-app/checkin.service';
import { GuestAppController } from './guest-app/guest-app.controller';
import { GuestAppService } from './guest-app/guest-app.service';
import { GuestAuthService } from './guest-app/guest-auth.service';
import { DisabledMailSender, LogMailSender, MAIL_SENDER, SmtpMailSender } from './common/mail';
import { GuestsController } from './guests/guests.controller';
import { GuestsService } from './guests/guests.service';
import { AuthController } from './iam/auth.controller';
import { AuthGuard } from './iam/auth.guard';
import { AuthService } from './iam/auth.service';
import { UsersController } from './iam/users.controller';
import { UsersService } from './iam/users.service';
import { ImportsController } from './imports/imports.controller';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { RateGridService } from './inventory/rate-grid.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PAYMENT_PROVIDER } from './payments/provider';
import { SandboxProvider } from './payments/sandbox.provider';
import { SberProvider } from './payments/sber.provider';
import { PublicController } from './public/public.controller';
import { ServicesController } from './services/services.controller';
import { ServicesService } from './services/services.service';
import { PublicService } from './public/public.service';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    const configModule: DynamicModule = {
      module: class ConfigModule {},
      global: true,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
    return {
      module: AppModule,
      imports: [configModule, DbModule],
      controllers: [AuthController, UsersController, InventoryController, GuestsController, BookingsController, PaymentsController, PublicController, GuestAppController, ImportsController, ServicesController],
      providers: [
        AuthService,
        UsersService,
        InventoryService,
        RateGridService,
        GuestsService,
        AvailabilityService,
        BookingsService,
        HoldsService,
        PaymentsService,
        PublicService,
        GuestAuthService,
        GuestAppService,
        CheckinService,
        ServicesService,
        {
          provide: MAIL_SENDER,
          useFactory: () => (config.mail.mode === 'smtp' ? new SmtpMailSender(config.mail.smtpUrl!, config.mail.from) : config.mail.mode === 'log' ? new LogMailSender() : new DisabledMailSender()),
        },
        { provide: PAYMENT_PROVIDER, useFactory: () => (config.payments.sber ? new SberProvider(config.payments.sber) : new SandboxProvider(config.payments.sandboxSecret, config.apiPublicUrl)) },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
