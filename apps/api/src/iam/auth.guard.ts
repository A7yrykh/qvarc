import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { PERMS_KEY, PUBLIC_KEY } from './auth.decorators';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'qvarc_sid';
export const CSRF_COOKIE = 'qvarc_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameToken(a: string | undefined, b: string | undefined) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? await this.auth.resolve(token) : null;
    if (!user) throw new UnauthorizedException('Нужно войти в систему');

    // Защита от CSRF: изменяющие запросы должны нести токен из cookie в заголовке
    if (!SAFE_METHODS.has(req.method) && !sameToken(req.cookies?.[CSRF_COOKIE], req.header('x-csrf-token'))) {
      throw new ForbiddenException('Нет CSRF-токена');
    }

    const needed = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, targets) ?? [];
    const missing = needed.filter((p) => !user.permissions.has(p));
    if (missing.length) {
      await this.audit.write({
        propertyId: user.propertyId,
        actorId: user.id,
        action: 'access.denied',
        entity: 'endpoint',
        entityId: `${req.method} ${req.route?.path ?? req.path}`,
        after: { missing },
        ip: req.ip ?? null,
      });
      throw new ForbiddenException('Недостаточно прав');
    }
    req.user = user;
    return true;
  }
}
