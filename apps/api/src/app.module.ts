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
import { AdminCheckinController, CheckinController } from './guest/checkin.controller';
import { CheckinService } from './guest/checkin.service';
import { GuestContentController } from './guest/content.controller';
import { GuestAuthController } from './guest/guest-auth.controller';
import { GuestAuthService } from './guest/guest-auth.service';
import { GuestBookingsController } from './guest/guest-bookings.controller';
import { GuestJobsService } from './guest/guest-jobs.service';
import { GuestGuard } from './guest/guest.guard';
import { NoSmsProvider, SMS_PROVIDER, TestSmsProvider } from './guest/sms.provider';
import { GuestStayService } from './guest/stay.service';
import { GuestsController } from './guests/guests.controller';
import { GuestsService } from './guests/guests.service';
import { AuthController } from './iam/auth.controller';
import { AuthGuard } from './iam/auth.guard';
import { AuthService } from './iam/auth.service';
import { UsersController } from './iam/users.controller';
import { UsersService } from './iam/users.service';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { RateGridService } from './inventory/rate-grid.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PAYMENT_PROVIDER } from './payments/provider';
import { SandboxProvider } from './payments/sandbox.provider';
import { SberProvider } from './payments/sber.provider';
import { PublicController } from './public/public.controller';
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
      controllers: [
        AuthController, UsersController, InventoryController, GuestsController, BookingsController, PaymentsController, PublicController,
        GuestAuthController, GuestContentController, GuestBookingsController, CheckinController, AdminCheckinController,
      ],
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
        GuestGuard,
        GuestStayService,
        CheckinService,
        GuestJobsService,
        { provide: SMS_PROVIDER, useFactory: () => (config.guest.sms === 'test' ? new TestSmsProvider() : new NoSmsProvider()) },
        { provide: PAYMENT_PROVIDER, useFactory: () => (config.payments.sber ? new SberProvider(config.payments.sber) : new SandboxProvider(config.payments.sandboxSecret, config.apiPublicUrl)) },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
