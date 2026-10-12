import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { isoDate, money, parse, uuid } from '../common/validation';
import { CurrentUser, Public, RequirePerms, type StaffUser } from '../iam/auth.decorators';
import { CatalogService } from './catalog.service';
import { FOOD_STATUSES, FoodService } from './food.service';
import { GuestAuthService } from './guest-auth.service';
import { idempotencyKey } from './guest-profile';
import { CurrentGuest, GuestGuard, type GuestPrincipal } from './guest.guard';
import { RestaurantService, TABLE_STATUSES } from './restaurant.service';

const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const text = (max: number) => z.string().trim().max(max).optional();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате ЧЧ:ММ');
const today = () => new Date().toISOString().slice(0, 10);

/** Ресторан, меню и каталог услуг: открыты без входа */
@Public()
@Controller('guest/v1')
export class GuestCatalogController {
  constructor(
    private readonly auth: GuestAuthService,
    private readonly restaurants: RestaurantService,
    private readonly food: FoodService,
    private readonly catalog: CatalogService,
  ) {}

  @Get('restaurants')
  async restaurantList() {
    return this.restaurants.list(await this.auth.property());
  }

  @Get('restaurants/:id/availability')
  async availability(@Param('id', ParseUUIDPipe) id: string, @Query('date') date: string, @Query('partySize') partySize: string) {
    const q = parse(z.object({ date: isoDate, partySize: z.coerce.number().int().min(1).max(30) }), { date, partySize });
    return this.restaurants.availability(await this.auth.property(), id, q.date, q.partySize);
  }

  @Get('restaurants/:id/menu')
  async menu(@Param('id', ParseUUIDPipe) id: string) {
    return this.food.menu(await this.auth.property(), id);
  }

  @Get('services')
  async services() {
    return this.catalog.list(await this.auth.property());
  }

  @Get('services/:id/slots')
  async slots(@Param('id', ParseUUIDPipe) id: string, @Query('date') date: string) {
    return this.catalog.slots(await this.auth.property(), id, parse(isoDate, date));
  }
}

/** Заказы и брони гостя */
@Public()
@UseGuards(GuestGuard)
@Controller('guest/v1')
export class GuestOrdersController {
  constructor(
    private readonly restaurants: RestaurantService,
    private readonly food: FoodService,
    private readonly catalog: CatalogService,
  ) {}

  @Post('table-reservations')
  reserve(@CurrentGuest() g: GuestPrincipal, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const input = parse(
      z.object({
        restaurantId: uuid,
        startsAt: dateTime,
        partySize: z.number().int().min(1).max(30),
        bookingId: uuid.optional(),
        wishes: text(500),
        allergies: text(500),
        comment: text(1000),
      }),
      body,
    );
    return this.restaurants.reserve(g, input, idempotencyKey(g, key, 'table'));
  }

  @Get('table-reservations/:id')
  reservation(@CurrentGuest() g: GuestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.restaurants.getForGuest(g, id);
  }

  @Post('table-reservations/:id/cancel')
  @HttpCode(200)
  cancelReservation(@CurrentGuest() g: GuestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.restaurants.cancelByGuest(g, id);
  }

  @Post('food-orders')
  order(@CurrentGuest() g: GuestPrincipal, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const input = parse(
      z.object({
        restaurantId: uuid,
        bookingId: uuid.optional(),
        fulfillment: z.enum(['delivery', 'pickup']),
        paymentMethod: z.enum(['online', 'on_delivery']),
        items: z.array(z.object({ menuItemId: uuid, quantity: z.number().int().min(1).max(20), comment: text(300) })).min(1).max(50),
        comment: text(1000),
      }),
      body,
    );
    return this.food.create(g, input, idempotencyKey(g, key, 'food'));
  }

  @Get('food-orders/my')
  myOrders(@CurrentGuest() g: GuestPrincipal) {
    return this.food.listForGuest(g);
  }

  @Get('food-orders/:id')
  foodOrder(@CurrentGuest() g: GuestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.food.getForGuest(g, id);
  }

  @Post('food-orders/:id/cancel')
  @HttpCode(200)
  cancelOrder(@CurrentGuest() g: GuestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.food.cancelByGuest(g, id);
  }

  @Post('service-bookings')
  bookService(@CurrentGuest() g: GuestPrincipal, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const input = parse(
      z.object({
        serviceId: uuid,
        bookingId: uuid,
        startsAt: dateTime,
        quantity: z.number().int().min(1).max(50).default(1),
        comment: text(1000),
      }),
      body,
    );
    return this.catalog.book(g, input, idempotencyKey(g, key, 'service'));
  }

  @Get('service-bookings/:id')
  serviceBooking(@CurrentGuest() g: GuestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getForGuest(g, id);
  }

  @Post('service-bookings/:id/cancel')
  @HttpCode(200)
  cancelService(@CurrentGuest() g: GuestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.cancelByGuest(g, id);
  }
}

const restaurantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  phone: z.string().max(50).nullish(),
  seatingMinutes: z.number().int().min(15).max(720).optional(),
  turnoverMinutes: z.number().int().min(0).max(240).optional(),
  autoConfirmReservations: z.boolean().optional(),
  acceptsDelivery: z.boolean().optional(),
  isActive: z.boolean().optional(),
  hours: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), opensAt: time, closesAt: time, lastSeating: time.nullish() }))
    .max(7)
    .refine((h) => new Set(h.map((x) => x.weekday)).size === h.length, 'День недели указан дважды')
    .refine((h) => h.every((x) => x.closesAt > x.opensAt), 'Закрытие должно быть позже открытия')
    .optional(),
});

/** Ресторан и кухня для сотрудников */
@Controller('admin/v1')
export class AdminRestaurantController {
  constructor(
    private readonly restaurants: RestaurantService,
    private readonly food: FoodService,
  ) {}

  @Get('restaurants')
  @RequirePerms('restaurant.manage')
  list(@CurrentUser() u: StaffUser) {
    return this.restaurants.list(u.propertyId);
  }

  @Post('restaurants')
  @RequirePerms('restaurant.manage')
  create(@CurrentUser() u: StaffUser, @Body() body: unknown) {
    return this.restaurants.save(u, parse(restaurantSchema, body));
  }

  @Put('restaurants/:id')
  @RequirePerms('restaurant.manage')
  update(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.restaurants.save(u, parse(restaurantSchema, body), id);
  }

  @Post('restaurants/:id/tables')
  @RequirePerms('restaurant.manage')
  addTable(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(z.object({ name: z.string().trim().min(1).max(50), seats: z.number().int().min(1).max(50), zone: z.string().max(100).nullish() }), body);
    return this.restaurants.addTable(u, id, input);
  }

  @Get('restaurants/:id/reservations')
  @RequirePerms('restaurant.manage')
  day(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Query('date') date?: string) {
    return this.restaurants.staffDay(u, id, parse(isoDate, date ?? today()));
  }

  @Post('table-reservations/:id/status')
  @HttpCode(200)
  @RequirePerms('restaurant.manage')
  reservationStatus(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { status } = parse(z.object({ status: z.enum(TABLE_STATUSES) }), body);
    return this.restaurants.setStatus(u.propertyId, id, status, { type: 'user', id: u.id });
  }

  @Get('kitchen/orders')
  @RequirePerms('kitchen.manage')
  kitchen(@CurrentUser() u: StaffUser, @Query('restaurantId') restaurantId?: string) {
    return this.food.kitchen(u, restaurantId ? parse(uuid, restaurantId) : undefined);
  }

  @Post('food-orders/:id/status')
  @HttpCode(200)
  @RequirePerms('kitchen.manage')
  orderStatus(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(z.object({ status: z.enum(FOOD_STATUSES), reason: text(500) }), body);
    return this.food.setStatus(u, id, input.status, input.reason);
  }

  @Patch('menu-items/:id')
  @RequirePerms('kitchen.manage')
  menuItem(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(z.object({ priceMinor: money.optional(), isAvailable: z.boolean().optional(), isActive: z.boolean().optional() }), body);
    return this.food.updateItem(u, id, input);
  }
}

const serviceSchema = z.object({
  category: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  pricing: z.enum(['per_item', 'per_hour', 'per_day', 'per_person', 'per_stay']).optional(),
  priceMinor: money,
  durationMinutes: z.number().int().min(5).max(24 * 60).nullish(),
  minAge: z.number().int().min(0).max(100).nullish(),
  rules: z.string().max(4000).nullish(),
  cancellationText: z.string().max(2000).nullish(),
  openTime: time.optional(),
  closeTime: time.optional(),
  slotStepMinutes: z.number().int().min(5).max(24 * 60).optional(),
  maxQuantity: z.number().int().min(1).max(50).optional(),
  requiresConfirmation: z.boolean().optional(),
  holdMinutes: z.number().int().min(5).max(120).optional(),
  equipmentTypeId: uuid.nullish(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

/** Услуги и прокат для сотрудников */
@Controller('admin/v1')
export class AdminRentalController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('services')
  @RequirePerms('rental.manage')
  services(@CurrentUser() u: StaffUser) {
    return this.catalog.list(u.propertyId);
  }

  @Post('services')
  @RequirePerms('rental.manage')
  createService(@CurrentUser() u: StaffUser, @Body() body: unknown) {
    return this.catalog.save(u, parse(serviceSchema, body));
  }

  @Put('services/:id')
  @RequirePerms('rental.manage')
  updateService(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.catalog.save(u, parse(serviceSchema, body), id);
  }

  @Get('equipment')
  @RequirePerms('rental.manage')
  equipment(@CurrentUser() u: StaffUser) {
    return this.catalog.equipment(u);
  }

  @Post('equipment-types')
  @RequirePerms('rental.manage')
  addType(@CurrentUser() u: StaffUser, @Body() body: unknown) {
    const input = parse(z.object({ name: z.string().trim().min(1).max(200), depositMinor: money.optional(), bufferMinutes: z.number().int().min(0).max(240).optional() }), body);
    return this.catalog.addEquipmentType(u, input);
  }

  @Post('equipment-types/:id/units')
  @RequirePerms('rental.manage')
  addUnit(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(z.object({ inventoryNo: z.string().trim().min(1).max(50), notes: z.string().max(500).nullish() }), body);
    return this.catalog.addUnit(u, id, input);
  }

  @Post('equipment-units/:id/condition')
  @HttpCode(200)
  @RequirePerms('rental.manage')
  condition(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(z.object({ condition: z.enum(['ok', 'needs_check', 'damaged', 'retired']), note: text(1000) }), body);
    return this.catalog.setUnitCondition(u, id, input.condition, input.note);
  }

  @Get('service-bookings')
  @RequirePerms('rental.manage')
  day(@CurrentUser() u: StaffUser, @Query('date') date?: string) {
    return this.catalog.staffDay(u, parse(isoDate, date ?? today()));
  }

  @Post('service-bookings/:id/:action')
  @HttpCode(200)
  @RequirePerms('rental.manage')
  transition(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string) {
    return this.catalog.transition(u.propertyId, id, parse(z.enum(['confirm', 'issue', 'return', 'cancel']), action), { type: 'user', id: u.id });
  }
}
