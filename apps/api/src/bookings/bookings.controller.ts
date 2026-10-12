import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { parse } from '../common/validation';
import { ClientIp, CurrentUser, RequirePerms, type StaffUser } from '../iam/auth.decorators';
import { CheckinService } from '../guest-app/checkin.service';
import { AvailabilityService } from './availability.service';
import { CalendarQuery, ChangeDatesBody, CreateBookingBody, ListQuery, MoveBody, QuoteBody, SearchQuery, StatusBody } from './bookings.schemas';
import { BookingsService } from './bookings.service';

@Controller('admin/v1')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly availability: AvailabilityService,
    private readonly checkin: CheckinService,
  ) {}

  @Get('availability')
  @RequirePerms('booking.read')
  search(@Query() q: unknown, @CurrentUser() u: StaffUser) {
    const s = parse(SearchQuery, q);
    return this.availability.search(u.propertyId, { ...s, publicOnly: false });
  }

  @Post('quotes')
  @HttpCode(200)
  @RequirePerms('booking.read')
  quote(@Body() b: unknown, @CurrentUser() u: StaffUser) {
    const q = parse(QuoteBody, b);
    return this.availability.quote(u.propertyId, { ...q, children: q.childrenAges.length });
  }

  @Get('calendar')
  @RequirePerms('calendar.read')
  calendar(@Query() q: unknown, @CurrentUser() u: StaffUser) {
    const { from, to } = parse(CalendarQuery, q);
    return this.bookings.calendar(u, from, to);
  }

  @Get('bookings')
  @RequirePerms('booking.read')
  list(@Query() q: unknown, @CurrentUser() u: StaffUser) {
    return this.bookings.list(u, parse(ListQuery, q));
  }

  @Get('bookings/:id')
  @RequirePerms('booking.read')
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: StaffUser) {
    const b = await this.bookings.get(u, id);
    // Онлайн-регистрация из приложения: состав гостей и документы (только тип и последние цифры)
    return { ...b, registration: await this.checkin.summary(id) };
  }

  @Post('bookings')
  @RequirePerms('booking.write', 'guest.write')
  async create(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    const r = await this.bookings.create({ user, propertyId: user.propertyId, ip }, parse(CreateBookingBody, b));
    return { ...(await this.bookings.get(user, r.id)), duplicate: r.duplicate };
  }

  @Patch('bookings/:id/unit')
  @RequirePerms('booking.write')
  move(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.bookings.move({ user, propertyId: user.propertyId, ip }, id, parse(MoveBody, b));
  }

  @Patch('bookings/:id/dates')
  @RequirePerms('booking.write')
  dates(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.bookings.changeDates({ user, propertyId: user.propertyId, ip }, id, parse(ChangeDatesBody, b));
  }

  @Post('bookings/:id/status')
  @HttpCode(200)
  @RequirePerms('booking.status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.bookings.changeStatus({ user, propertyId: user.propertyId, ip }, id, parse(StatusBody, b));
  }
}
