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
      controllers: [AuthController, UsersController, InventoryController, GuestsController, BookingsController, PaymentsController, PublicController],
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
        { provide: PAYMENT_PROVIDER, useFactory: () => new SandboxProvider(config.payments.sandboxSecret, config.apiPublicUrl) },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
