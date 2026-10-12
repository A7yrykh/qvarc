// Загрузка категорий номеров, фото, номеров и основного тарифа из файла (data/kvarc-rooms.json).
// Повторный запуск обновляет категории по коду и добавляет недостающие номера, ничего не удаляя.
// Изменения проходят через те же сервисы, что и админка, и пишутся в журнал от имени владельца.
//   DATABASE_URL=... npx tsx apps/api/src/cli/import-rooms.ts qvarc-uvildy data/kvarc-rooms.json
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createDb, type Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import type { StaffUser } from '../iam/auth.decorators';
import { RatePlanBody, TypeBody } from '../inventory/inventory.schemas';
import { InventoryService } from '../inventory/inventory.service';

const FileSchema = z.object({
  property: z.object({ checkInTime: z.string().regex(/^\d\d:\d\d$/), checkOutTime: z.string().regex(/^\d\d:\d\d$/) }).optional(),
  accommodationTypes: z.array(z.object({ units: z.array(z.string().min(1).max(100)).default([]) }).passthrough()),
  ratePlan: z.object({}).passthrough().optional(),
});

export async function importRooms(db: Database, propertyCode: string, data: unknown) {
  const file = FileSchema.parse(data);
  const property = await db.selectFrom('property').select(['id']).where('code', '=', propertyCode).executeTakeFirstOrThrow();
  const owner = await db
    .selectFrom('app_user as u')
    .innerJoin('user_role as ur', 'ur.user_id', 'u.id')
    .innerJoin('role as r', 'r.id', 'ur.role_id')
    .select(['u.id', 'u.email', 'u.full_name'])
    .where('r.code', '=', 'owner')
    .where('r.property_id', '=', property.id)
    .executeTakeFirstOrThrow();
  const user: StaffUser = { id: owner.id, propertyId: property.id, email: owner.email, fullName: owner.full_name, permissions: new Set(), sessionId: 'cli' };
  const actor = { user, ip: null };
  const inv = new InventoryService(db, new AuditService(db));
  const report: string[] = [];

  if (file.property) {
    await db.updateTable('property').set({ check_in_time: file.property.checkInTime, check_out_time: file.property.checkOutTime }).where('id', '=', property.id).execute();
    report.push(`заезд с ${file.property.checkInTime}, выезд до ${file.property.checkOutTime}`);
  }

  const typeIds: string[] = [];
  for (const raw of file.accommodationTypes) {
    const { units, ...rest } = raw;
    const body = TypeBody.parse(rest);
    const existing = await db.selectFrom('accommodation_type').select('id').where('property_id', '=', property.id).where('code', '=', body.code).executeTakeFirst();
    const row = existing ? await inv.updateType(actor, existing.id, body) : await inv.createType(actor, body);
    typeIds.push(row.id);
    const have = new Set((await db.selectFrom('accommodation_unit').select('name').where('accommodation_type_id', '=', row.id).execute()).map((u) => u.name));
    const added = units.filter((u) => !have.has(u));
    for (const name of added) await inv.createUnit(actor, { accommodationTypeId: row.id, name, isActive: true });
    report.push(`${body.name}: ${existing ? 'обновлена' : 'создана'}, фото ${body.photos?.length ?? 0}, номеров добавлено ${added.length}`);
  }

  if (file.ratePlan) {
    const plan = RatePlanBody.parse({ ...file.ratePlan, accommodationTypeIds: typeIds });
    const existing = await db.selectFrom('rate_plan').select('id').where('property_id', '=', property.id).where('code', '=', plan.code).executeTakeFirst();
    if (existing) report.push(`тариф «${plan.name}» уже есть, не менялся`);
    else {
      await inv.createRatePlan(actor, plan);
      report.push(`тариф «${plan.name}» создан, цены задаются в «Ценах и ограничениях»`);
    }
  }
  return report;
}

if (require.main === module) {
  const [propertyCode, path = 'data/kvarc-rooms.json'] = process.argv.slice(2);
  if (!propertyCode || !process.env.DATABASE_URL) {
    console.error('Использование: DATABASE_URL=... npx tsx apps/api/src/cli/import-rooms.ts <код объекта> [файл]');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL, 2);
  importRooms(db, propertyCode, JSON.parse(readFileSync(path, 'utf8')))
    .then((r) => console.log(r.join('\n')))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
