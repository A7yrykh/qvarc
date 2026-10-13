// Первичная настройка: организация, объект, системные роли, источники броней и учётная запись владельца.
// Номера, тарифы и цены после этого заводит администратор в системе — здесь их нет.
import { createDb, type Database } from '../../../../packages/db/src';
import { UsersService } from '../iam/users.service';

export const DIRECT_CHANNELS = [
  { code: 'direct_site', name: 'Сайт' },
  { code: 'front_desk', name: 'Ресепшен' },
  { code: 'phone', name: 'Телефон' },
  { code: 'messenger', name: 'Мессенджер' },
];

export interface BootstrapInput {
  legalName: string;
  inn?: string;
  propertyCode: string;
  propertyName: string;
  timezone: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
}

export async function bootstrapProperty(db: Database, input: BootstrapInput) {
  if (input.ownerPassword.length < 12) throw new Error('Пароль владельца не короче 12 символов');
  return db.transaction().execute(async (trx) => {
    const org = await trx
      .insertInto('organization')
      .values({ legal_name: input.legalName, inn: input.inn ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    const property = await trx
      .insertInto('property')
      .values({ organization_id: org.id, code: input.propertyCode, name: input.propertyName, timezone: input.timezone })
      .returning('id')
      .executeTakeFirstOrThrow();
    const users = new UsersService(trx);
    await users.createSystemRoles(property.id, trx);
    await trx
      .insertInto('channel')
      .values(DIRECT_CHANNELS.map((c) => ({ property_id: property.id, code: c.code, name: c.name })))
      .execute();
    const owner = await users.createUser(
      { propertyId: property.id, email: input.ownerEmail, fullName: input.ownerName, password: input.ownerPassword, roleCodes: ['owner'] },
      trx,
    );
    return { organizationId: org.id, propertyId: property.id, ownerId: owner.id };
  });
}

if (require.main === module) {
  const env = process.env;
  const required = ['DATABASE_URL', 'QVARC_LEGAL_NAME', 'QVARC_PROPERTY_NAME', 'QVARC_OWNER_EMAIL', 'QVARC_OWNER_NAME', 'QVARC_OWNER_PASSWORD'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    console.error(`Не заданы переменные: ${missing.join(', ')}`);
    process.exit(1);
  }
  const db = createDb(env.DATABASE_URL!);
  bootstrapProperty(db, {
    legalName: env.QVARC_LEGAL_NAME!,
    inn: env.QVARC_INN,
    propertyCode: env.QVARC_PROPERTY_CODE ?? 'kvarc',
    propertyName: env.QVARC_PROPERTY_NAME!,
    timezone: env.QVARC_TIMEZONE ?? 'Asia/Yekaterinburg',
    ownerEmail: env.QVARC_OWNER_EMAIL!,
    ownerName: env.QVARC_OWNER_NAME!,
    ownerPassword: env.QVARC_OWNER_PASSWORD!,
  })
    .then((r) => console.log(`Готово: объект ${r.propertyId}, владелец ${r.ownerId}`))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
