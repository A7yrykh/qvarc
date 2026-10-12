import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RateLimiter } from '../common/rate-limit';
import { CONFIG } from '../common/tokens';
import type { AppConfig } from '../config';
import { parse } from '../common/validation';
import { ClientIp, Public } from '../iam/auth.decorators';
import { ManageToken, OffersQuery, PublicBookingBody } from './public.schemas';
import { PublicService } from './public.service';


/** API модуля бронирования на сайте. Без входа; ограничение частоты по IP. */
@Public()
@Controller('public/v1/:property')
export class PublicController {
  private readonly searchLimit: RateLimiter;
  private readonly bookingLimit: RateLimiter;
  private readonly manageLimit: RateLimiter;

  constructor(
    private readonly svc: PublicService,
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

  @Post('bookings/:token/cancel')
  @HttpCode(200)
  cancel(@Param('token') token: string, @ClientIp() ip: string | null) {
    this.manageLimit.check(ip ?? '-');
    return this.svc.cancel(parse(ManageToken, token), ip);
  }
}
