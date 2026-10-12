import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RateLimiter } from '../common/rate-limit';
import { CONFIG } from '../common/tokens';
import { parse } from '../common/validation';
import type { AppConfig } from '../config';
import { ClientIp, Public } from '../iam/auth.decorators';
import { GuestAuthService } from './guest-auth.service';

/** +79001112233; 8 900 …, 900 … и с пробелами тоже принимаются */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    let d = v.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`;
    if (d.length === 10) d = `7${d}`;
    if (d.length !== 11 || !d.startsWith('7')) {
      ctx.addIssue({ code: 'custom', message: 'Номер телефона в формате +7 900 000-00-00' });
      return z.NEVER;
    }
    return `+${d}`;
  });

const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

@Public()
@Controller('guest/v1/auth')
export class GuestAuthController {
  private readonly ipLimit: RateLimiter;

  constructor(
    private readonly auth: GuestAuthService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.ipLimit = new RateLimiter(20 * config.rateLimitFactor, 3_600_000);
  }

  @Post('otp/request')
  @HttpCode(200)
  request(@Body() b: unknown, @ClientIp() ip: string | null) {
    this.ipLimit.check(ip ?? '-');
    const { phone } = parse(z.object({ phone: phoneSchema }), b);
    return this.auth.requestCode(phone, ip);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() b: unknown, @Req() req: Request, @ClientIp() ip: string | null) {
    const { phone, code } = parse(z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/, 'Код из 6 цифр') }), b);
    return this.auth.verify(phone, code, req.header('user-agent') ?? null, ip);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() b: unknown) {
    return this.auth.refresh(parse(RefreshBody, b).refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Body() b: unknown) {
    await this.auth.logout(parse(RefreshBody, b).refreshToken);
    return { ok: true };
  }
}
