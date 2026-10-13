import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CONFIG } from '../common/tokens';
import { parse } from '../common/validation';
import type { AppConfig } from '../config';
import { CurrentUser, Public, RequirePerms, type StaffUser } from '../iam/auth.decorators';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider';
import { PaymentsService } from './payments.service';
import { SandboxProvider } from './sandbox.provider';

type RawRequest = Request & { rawBody?: Buffer };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Уведомления эквайера о статусе платежа */
  @Public()
  @Post('public/v1/payments/webhook')
  @HttpCode(200)
  webhook(@Req() req: RawRequest) {
    return this.payments.handleWebhook(req.headers as Record<string, string>, req.rawBody);
  }

  /** Сбер по умолчанию присылает уведомление GET-запросом с параметрами в адресе */
  @Public()
  @Get('public/v1/payments/webhook')
  @HttpCode(200)
  webhookGet(@Req() req: Request) {
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1) : '';
    return this.payments.handleWebhook(req.headers as Record<string, string>, Buffer.from(qs));
  }

  @Get('admin/v1/bookings/:id/payments')
  @RequirePerms('payment.read')
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: StaffUser) {
    return this.payments.listForBooking(u.propertyId, id);
  }

  @Post('admin/v1/bookings/:id/deposit-offsets')
  @RequirePerms('booking.write', 'payment.read')
  applyDeposit(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: StaffUser) {
    const body = parse(z.object({ depositId: z.string().uuid(), amountMinor: z.number().int().positive() }), b);
    return this.payments.applyDeposit({ propertyId: u.propertyId, bookingId: id, depositId: body.depositId, amountMinor: body.amountMinor, userId: u.id });
  }

  @Post('admin/v1/payments/:id/refunds')
  @RequirePerms('payment.refund')
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: StaffUser) {
    const body = parse(z.object({ amountMinor: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }), b);
    return this.payments.refund({ paymentId: id, amountMinor: body.amountMinor, reason: body.reason, userId: u.id, propertyId: u.propertyId });
  }

  // ── Тестовая страница оплаты (только PAYMENT_PROVIDER=sandbox) ──

  private sandbox() {
    if (!(this.provider instanceof SandboxProvider)) throw new NotFoundException();
    return this.provider;
  }

  @Public()
  @Get('public/v1/sandbox/pay/:id')
  sandboxPage(@Param('id') id: string, @Res() res: Response) {
    const p = this.sandbox().view(id);
    if (!p) throw new NotFoundException('Платёж не найден');
    const amount = (p.amountMinor / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2 });
    res.type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тестовая оплата</title><style>body{font-family:system-ui,sans-serif;background:#f4f3f0;display:grid;place-items:center;min-height:100vh;margin:0}
.c{background:#fff;border:1px solid #ddd;border-radius:10px;padding:28px;max-width:380px;width:calc(100% - 32px)}
.w{background:#f3e6c9;color:#8a6420;padding:8px 10px;border-radius:6px;font-size:13px}
button{font:inherit;padding:10px 16px;border-radius:6px;border:1px solid #2f3338;cursor:pointer;margin-right:8px}
.ok{background:#2f3338;color:#fff}</style></head><body><form class="c" method="post">
<div class="w">Тестовый режим: деньги не списываются</div><h2>${esc(amount)} ₽</h2><p>${esc(p.description)}</p>
<p>Статус: ${esc(p.status)}</p>
${p.status === 'pending' ? '<button class="ok" formaction="?outcome=succeeded" name="o" value="1">Оплатить</button><button formaction="?outcome=failed" name="o" value="1">Отказ банка</button>' : `<a href="${esc(p.returnUrl)}">Вернуться на сайт</a>`}
</form></body></html>`);
  }

  @Public()
  @Post('public/v1/sandbox/pay/:id')
  async sandboxComplete(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const sb = this.sandbox();
    const outcome = req.query.outcome === 'succeeded' ? 'succeeded' : 'failed';
    const p = sb.view(id);
    if (!p) throw new NotFoundException('Платёж не найден');
    const ev = sb.complete(id, outcome);
    if (ev) await this.payments.handleWebhook({ 'x-sandbox-signature': ev.signature }, ev.body);
    res.redirect(303, p.returnUrl);
  }
}
