import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '../../../../packages/db/src';
import { DB } from '../common/tokens';
import { AuthService } from './auth.service';

/** Системные роли из раздела 12 ТЗ и их права по умолчанию. Набор можно менять в настройках. */
export const SYSTEM_ROLES: Record<string, { name: string; perms: string[] | 'all' }> = {
  owner: { name: 'Владелец', perms: 'all' },
  sysadmin: { name: 'Системный администратор', perms: 'all' },
  manager: { name: 'Управляющий объектом', perms: 'all' },
  reservations: {
    name: 'Администратор размещения',
    perms: ['inventory.read', 'rates.read', 'calendar.read', 'booking.read', 'booking.write', 'booking.status',
      'guest.read', 'guest.contacts.read', 'guest.write', 'payment.read'],
  },
  front_desk: {
    name: 'Сотрудник ресепшена',
    perms: ['inventory.read', 'rates.read', 'calendar.read', 'booking.read', 'booking.write', 'booking.status',
      'guest.read', 'guest.contacts.read', 'guest.write', 'payment.read'],
  },
  housekeeping: { name: 'Сотрудник уборки', perms: ['inventory.read', 'calendar.read'] },
  maintenance: { name: 'Сотрудник технической службы', perms: ['inventory.read', 'calendar.read'] },
  restaurant: { name: 'Сотрудник ресторана', perms: ['calendar.read'] },
  rental: { name: 'Сотрудник проката', perms: ['calendar.read'] },
  accountant: { name: 'Бухгалтер', perms: ['booking.read', 'payment.read', 'reports.read'] },
  marketing: { name: 'Маркетолог', perms: ['rates.read', 'reports.read'] },
  guest_relations: {
    name: 'Менеджер по работе с гостями',
    perms: ['calendar.read', 'booking.read', 'guest.read', 'guest.contacts.read', 'guest.write'],
  },
};

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async createSystemRoles(propertyId: string, trx: Database = this.db) {
    const all = (await trx.selectFrom('permission').select('code').execute()).map((p) => p.code);
    for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
      const role = await trx
        .insertInto('role')
        .values({ property_id: propertyId, code, name: def.name, is_system: true })
        .returning('id')
        .executeTakeFirstOrThrow();
      const perms = def.perms === 'all' ? all : def.perms;
      await trx
        .insertInto('role_permission')
        .values(perms.map((p) => ({ role_id: role.id, permission_code: p })))
        .execute();
    }
  }

  async createUser(
    input: { propertyId: string; email: string; fullName: string; password: string; roleCodes: string[] },
    trx: Database = this.db,
  ) {
    const roles = await trx
      .selectFrom('role')
      .select(['id', 'code'])
      .where('property_id', '=', input.propertyId)
      .where('code', 'in', input.roleCodes)
      .execute();
    if (roles.length !== input.roleCodes.length) throw new NotFoundException('Роль не найдена');
    const user = await trx
      .insertInto('app_user')
      .values({
        property_id: input.propertyId,
        email: input.email,
        full_name: input.fullName,
        password_hash: await AuthService.hashPassword(input.password),
      })
      .returning(['id', 'email', 'full_name'])
      .executeTakeFirstOrThrow();
    await trx.insertInto('user_role').values(roles.map((r) => ({ user_id: user.id, role_id: r.id }))).execute();
    return user;
  }
}
