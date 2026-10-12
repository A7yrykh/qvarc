import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Inject } from '@nestjs/common';
import { CONFIG } from '../common/tokens';
import { parse } from '../common/validation';
import type { AppConfig } from '../config';
import { ClientIp, CurrentUser, Public, type StaffUser } from './auth.decorators';
import { CSRF_COOKIE, SESSION_COOKIE } from './auth.guard';
import { AuthService } from './auth.service';

const LoginBody = z.object({ email: z.email(), password: z.string().min(1).max(200) });

@Controller('admin/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null) {
    const { email, password } = parse(LoginBody, body);
    const s = await this.auth.login(email, password, ip, req.header('user-agent') ?? null);
    const base = { secure: this.config.cookieSecure, sameSite: 'lax' as const, expires: s.expiresAt, path: '/' };
    res.cookie(SESSION_COOKIE, s.token, { ...base, httpOnly: true });
    res.cookie(CSRF_COOKIE, s.csrf, { ...base, httpOnly: false });
    return { ok: true, csrfToken: s.csrf };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: StaffUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: StaffUser) {
    return { id: user.id, email: user.email, fullName: user.fullName, permissions: [...user.permissions].sort() };
  }
}
