import { Body, Controller, Get, Post } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { z } from 'zod';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import { parse } from '../common/validation';
import { ClientIp, CurrentUser, RequirePerms, type StaffUser } from './auth.decorators';
import { UsersService } from './users.service';

const CreateUser = z.object({
  email: z.email(),
  fullName: z.string().min(2).max(200),
  password: z.string().min(12, 'Пароль не короче 12 символов').max(200),
  roles: z.array(z.string()).min(1),
});

@Controller('admin/v1/users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  @RequirePerms('users.manage')
  list(@CurrentUser() me: StaffUser) {
    return this.db
      .selectFrom('app_user')
      .select(['id', 'email', 'full_name', 'is_active', 'created_at'])
      .where('property_id', '=', me.propertyId)
      .orderBy('full_name')
      .execute();
  }

  @Post()
  @RequirePerms('users.manage')
  async create(@Body() body: unknown, @CurrentUser() me: StaffUser, @ClientIp() ip: string | null) {
    const b = parse(CreateUser, body);
    return this.db.transaction().execute(async (trx) => {
      const user = await this.users.createUser(
        { propertyId: me.propertyId, email: b.email, fullName: b.fullName, password: b.password, roleCodes: b.roles },
        trx,
      );
      await this.audit.write(
        { propertyId: me.propertyId, actorId: me.id, action: 'user.create', entity: 'app_user', entityId: user.id, after: { email: b.email, roles: b.roles }, ip },
        trx,
      );
      return user;
    });
  }
}
