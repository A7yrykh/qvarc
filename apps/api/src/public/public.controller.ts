import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RateLimiter } from '../common/rate-limit';
import { CONFIG } from '../common/tokens';
import type { AppConfig } from '../config';
import { isoDate, parse, uuid } from '../common/validation';
import { ServiceBookingBody } from '../services/services.schemas';
import { ServicesService } from '../services/services.service';
import { ClientIp, Public } from '../iam/auth.decorators';
import { GuestAppService } from '../guest-app/guest-app.service';
import { ManageToken, OffersQuery, PublicBookingBody } from './public.schemas';
import { PublicService } from './public.service';


const SiteServiceBody = ServiceBookingBody.omit({ bookingId: true }).extend({ idempotencyKey: z.string().min(16).max(100) });

/** API модуля бронирования на сайте. Без входа; ограничение частоты по IP. */
@Public()
@Controller('public/v1/:property')
export class PublicController {
  private readonly searchLimit: RateLimiter;
  private readonly bookingLimit: RateLimiter;
  private readonly manageLimit: RateLimiter;

  constructor(
    private readonly svc: PublicService,
    private readonly guestApp: GuestAppService,
    private readonly catalog: ServicesService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    const k = config.rateLimitFactor;
    this.searchLimit = new RateLimiter(120 * k, 60_000);
    this.bookingLimit = new RateLimiter(10 * k, 10 * 60_000);
    this.manageLimit = new RateLimiter(60 * k, 60_000);
  }

  @Get('info')
  info(@Param('property') code: string) {
    return this.svc.info(code);
  }

  /** Документы объекта (правила проживания, политика конфиденциальности) для ссылок из формы брони */
  @Get('documents/:code')
  document(@Param('property') code: string, @Param('code') doc: string) {
    return this.guestApp.document(code, doc);
  }

  @Get('offers')
  offers(@Param('property') code: string, @Query() q: unknown, @ClientIp() ip: string | null) {
    this.searchLimit.check(ip ?? '-');
    return this.svc.offers(code, parse(OffersQuery, q));
  }

  @Post('bookings')
  create(@Param('property') code: string, @Body() b: unknown, @ClientIp() ip: string | null) {
    this.bookingLimit.check(ip ?? '-');
    return this.svc.createBooking(code, parse(PublicBookingBody, b), ip);
  }

  @Get('bookings/:token')
  manage(@Param('token') token: string, @ClientIp() ip: string | null) {
    this.manageLimit.check(ip ?? '-');
    return this.svc.manage(parse(ManageToken, token));
  }

  @Post('bookings/:token/pay')
  @HttpCode(200)
  pay(@Param('token') token: string, @Body() b: unknown, @ClientIp() ip: string | null) {
    this.bookingLimit.check(ip ?? '-');
    const { attemptKey } = parse(z.object({ attemptKey: z.string().min(16).max(100) }), b);
    return this.svc.pay(parse(ManageToken, token), attemptKey);
  }

  /** Доп. услуги и прокат, которые можно добавить к брони */
  @Get('services')
  async services(@Param('property') code: string) {
    return this.catalog.catalog((await this.svc.property(code)).id);
  }

  @Get('services/:id/slots')
  async slots(@Param('property') code: string, @Param('id') id: string, @Query('date') date: string, @ClientIp() ip: string | null) {
    this.searchLimit.check(ip ?? '-');
    return this.catalog.slots((await this.svc.property(code)).id, parse(uuid, id), parse(isoDate, date));
  }

  @Post('bookings/:token/services')
  addService(@Param('token') token: string, @Body() b: unknown, @ClientIp() ip: string | null) {
    this.bookingLimit.check(ip ?? '-');
    const body = parse(SiteServiceBody, b);
    const { idempotencyKey, ...input } = body;
    return this.svc.addService(parse(ManageToken, token), input, idempotencyKey, ip);
  }

  @Post('bookings/:token/services/:id/cancel')
  @HttpCode(200)
  cancelService(@Param('token') token: string, @Param('id') id: string, @ClientIp() ip: string | null) {
    this.manageLimit.check(ip ?? '-');
    return this.svc.cancelService(parse(ManageToken, token), parse(uuid, id), ip);
  }

  @Post('bookings/:token/pay-services')
  @HttpCode(200)
  payServices(@Param('token') token: string, @Body() b: unknown, @ClientIp() ip: string | null) {
    this.bookingLimit.check(ip ?? '-');
    const { attemptKey } = parse(z.object({ attemptKey: z.string().min(16).max(100) }), b);
    return this.svc.payServices(parse(ManageToken, token), attemptKey);
  }

  @Post('bookings/:token/cancel')
  @HttpCode(200)
  cancel(@Param('token') token: string, @ClientIp() ip: string | null) {
    this.manageLimit.check(ip ?? '-');
    return this.svc.cancel(parse(ManageToken, token), ip);
  }
}
