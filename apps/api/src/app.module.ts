import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AvailabilityService } from './bookings/availability.service';
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
      controllers: [AuthController, UsersController, InventoryController, GuestsController, BookingsController],
      providers: [
        AuthService,
        UsersService,
        InventoryService,
        GuestsService,
        AvailabilityService,
        BookingsService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
