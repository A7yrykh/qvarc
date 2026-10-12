import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { GuestAuthService } from './guest-auth.service';

export interface GuestPrincipal {
  accountId: string;
  propertyId: string;
  phone: string;
  sessionId: string;
}

/**
 * Вход гостя: токен доступа в заголовке Authorization: Bearer ….
 * Cookie не используются, поэтому CSRF-защита сотрудников здесь не нужна.
 * Контроллер помечается @Public(), чтобы общий AuthGuard сотрудников его пропустил.
 */
@Injectable()
export class GuestGuard implements CanActivate {
  constructor(private readonly auth: GuestAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { guest?: GuestPrincipal }>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException({ message: 'Войдите по номеру телефона', code: 'unauthorized' });
    const guest = await this.auth.resolve(header.slice(7).trim());
    if (!guest) throw new UnauthorizedException({ message: 'Сессия истекла, войдите снова', code: 'unauthorized' });
    req.guest = guest;
    return true;
  }
}

export const CurrentGuest = createParamDecorator((_: unknown, ctx: ExecutionContext): GuestPrincipal => {
  return ctx.switchToHttp().getRequest().guest;
});
