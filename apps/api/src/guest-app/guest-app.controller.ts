import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { isoDate, parse, uuid } from '../common/validation';
import { ClientIp, Public } from '../iam/auth.decorators';
import { ServiceBookingBody } from '../services/services.schemas';
import { ServicesService } from '../services/services.service';
import { CheckinService, DocumentsBody, GuestsBody, RulesBody } from './checkin.service';
import { GuestAppService } from './guest-app.service';
import { GuestAuthService } from './guest-auth.service';

const EmailBody = z.object({ email: z.string().min(3).max(254) });
const VerifyBody = z.object({ email: z.string().min(3).max(254), code: z.string().regex(/^\s*\d{6}\s*$/, 'Код из 6 цифр') });
const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });
const PaymentBody = z.object({ purpose: z.string().max(40), targetId: uuid });
const IdempotencyKey = z.string().min(8).max(100);

/**
 * API гостевого приложения для iPhone. Адрес в приложении (QvarcAPIBaseURL): https://<api>/guest/v1/<код объекта>.
 * Вход по коду из письма на e-mail гостя, дальше заголовок Authorization: Bearer <токен доступа>.
 */
@Public()
@Controller('guest/v1')
export class GuestAppController {
  constructor(
    private readonly auth: GuestAuthService,
    private readonly svc: GuestAppService,
    private readonly checkin: CheckinService,
    private readonly catalog: ServicesService,
  ) {}

  /** Сюда банк возвращает гостя после оплаты; приложение ловит адрес qvarc:// и проверяет платёж. */
  @Get('payment-return')
  paymentReturn(@Res() res: Response) {
    res.redirect(302, 'qvarc://payment-return');
  }

  private async guest(code: string, authorization: string | undefined) {
    const p = await this.svc.propertyByCode(code);
    return this.auth.resolve(p.id, authorization);
  }

  @Post(':property/auth/otp/request')
  @HttpCode(200)
  async requestCode(@Param('property') code: string, @Body() b: unknown, @ClientIp() ip: string | null) {
    const p = await this.svc.propertyByCode(code);
    return this.auth.requestCode(p.id, parse(EmailBody, b).email, ip);
  }

  @Post(':property/auth/otp/verify')
  @HttpCode(200)
  async verify(@Param('property') code: string, @Body() b: unknown, @ClientIp() ip: string | null) {
    const p = await this.svc.propertyByCode(code);
    const body = parse(VerifyBody, b);
    return this.auth.verify(p.id, body.email, body.code, ip);
  }

  @Post(':property/auth/refresh')
  @HttpCode(200)
  async refresh(@Param('property') code: string, @Body() b: unknown) {
    const p = await this.svc.propertyByCode(code);
    return this.auth.refresh(p.id, parse(RefreshBody, b).refreshToken);
  }

  @Post(':property/auth/logout')
  @HttpCode(200)
  async logout(@Body() b: unknown) {
    await this.auth.logout(parse(RefreshBody, b).refreshToken);
    return { ok: true };
  }

  @Get(':property/property')
  property(@Param('property') code: string) {
    return this.svc.property(code);
  }

  @Get(':property/documents/:code')
  document(@Param('property') code: string, @Param('code') doc: string) {
    return this.svc.document(code, doc);
  }

  @Get(':property/bookings/my')
  async myBookings(@Param('property') code: string, @Headers('authorization') a?: string) {
    return this.svc.myBookings(await this.guest(code, a));
  }

  @Get(':property/checkin/:id')
  async checkinState(@Param('property') code: string, @Param('id') id: string, @Headers('authorization') a?: string) {
    return this.checkin.state(await this.guest(code, a), parse(uuid, id));
  }

  @Put(':property/checkin/:id/guests')
  async checkinGuests(@Param('property') code: string, @Param('id') id: string, @Body() b: unknown, @ClientIp() ip: string | null, @Headers('authorization') a?: string) {
    return this.checkin.submitGuests(await this.guest(code, a), parse(uuid, id), parse(GuestsBody, b), ip);
  }

  @Put(':property/checkin/:id/documents')
  async checkinDocuments(@Param('property') code: string, @Param('id') id: string, @Body() b: unknown, @ClientIp() ip: string | null, @Headers('authorization') a?: string) {
    return this.checkin.submitDocuments(await this.guest(code, a), parse(uuid, id), parse(DocumentsBody, b), ip);
  }

  @Post(':property/checkin/:id/rules')
  @HttpCode(200)
  async checkinRules(@Param('property') code: string, @Param('id') id: string, @Body() b: unknown, @ClientIp() ip: string | null, @Headers('authorization') a?: string) {
    return this.checkin.acceptRules(await this.guest(code, a), parse(uuid, id), parse(RulesBody, b), ip);
  }

  @Post(':property/payments')
  async createPayment(@Param('property') code: string, @Body() b: unknown, @Headers('idempotency-key') key: string | undefined, @Headers('authorization') a?: string) {
    const g = await this.guest(code, a);
    return this.svc.createPayment(g, parse(PaymentBody, b), parse(IdempotencyKey, key));
  }

  @Get(':property/payments/:id')
  async payment(@Param('property') code: string, @Param('id') id: string, @Headers('authorization') a?: string) {
    return this.svc.payment(await this.guest(code, a), parse(uuid, id));
  }

  // Доп. услуги и прокат: каталог, свободное время, бронь к своей брони проживания
  @Get(':property/services')
  async services(@Param('property') code: string, @Headers('authorization') a?: string) {
    const g = await this.guest(code, a);
    return this.catalog.catalog(g.propertyId);
  }

  @Get(':property/services/:id/slots')
  async serviceSlots(@Param('property') code: string, @Param('id') id: string, @Query('date') date: string, @Headers('authorization') a?: string) {
    const g = await this.guest(code, a);
    return this.catalog.slots(g.propertyId, parse(uuid, id), parse(isoDate, date));
  }

  @Post(':property/service-bookings')
  async bookService(@Param('property') code: string, @Body() b: unknown, @Headers('idempotency-key') key: string | undefined, @ClientIp() ip: string | null, @Headers('authorization') a?: string) {
    const g = await this.guest(code, a);
    const input = parse(ServiceBookingBody, b);
    const own = await this.svc.bookingIds(g);
    if (!own.includes(input.bookingId)) throw new NotFoundException('Бронь не найдена');
    const idem = key ? `app:${g.accountId}:${parse(IdempotencyKey, key)}` : undefined;
    const r = await this.catalog.book({ type: 'guest', id: g.accountId, propertyId: g.propertyId, ip }, input, 'guest_app', idem);
    return this.catalog.forGuest(g.propertyId, r.id, own);
  }

  @Get(':property/service-bookings/my')
  async myServiceBookings(@Param('property') code: string, @Headers('authorization') a?: string) {
    const g = await this.guest(code, a);
    return this.catalog.listForGuest(g.propertyId, await this.svc.bookingIds(g));
  }

  @Get(':property/service-bookings/:id')
  async serviceBooking(@Param('property') code: string, @Param('id') id: string, @Headers('authorization') a?: string) {
    const g = await this.guest(code, a);
    return this.catalog.forGuest(g.propertyId, parse(uuid, id), await this.svc.bookingIds(g));
  }

  @Post(':property/service-bookings/:id/cancel')
  @HttpCode(200)
  async cancelService(@Param('property') code: string, @Param('id') id: string, @ClientIp() ip: string | null, @Headers('authorization') a?: string) {
    const g = await this.guest(code, a);
    const own = await this.svc.bookingIds(g);
    const sbId = parse(uuid, id);
    await this.catalog.act({ type: 'guest', id: g.accountId, propertyId: g.propertyId, ip }, sbId, 'cancel', { guestBookingIds: own });
    return this.catalog.forGuest(g.propertyId, sbId, own);
  }

  @Get(':property/restaurants')
  async restaurants(@Param('property') code: string, @Headers('authorization') a?: string) {
    await this.guest(code, a);
    return [];
  }

  @Get(':property/food-orders/my')
  async myFoodOrders(@Param('property') code: string, @Headers('authorization') a?: string, @Query() _q?: unknown) {
    await this.guest(code, a);
    return [];
  }
}
