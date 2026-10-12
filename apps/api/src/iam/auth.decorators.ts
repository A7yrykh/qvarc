import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'qvarc:public';
export const PERMS_KEY = 'qvarc:perms';

/** Эндпоинт доступен без входа. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Нужны все перечисленные права. */
export const RequirePerms = (...perms: string[]) => SetMetadata(PERMS_KEY, perms);

export interface StaffUser {
  id: string;
  propertyId: string;
  email: string;
  fullName: string;
  permissions: Set<string>;
  sessionId: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): StaffUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  return ctx.switchToHttp().getRequest().ip ?? null;
});
