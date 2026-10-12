// Загрузка меню ресторана из файла (data/menu-summer-2026.json, цены в копейках).
// Ресторана нет — создаётся без часов работы: пока часы не заданы в админке, гость видит меню, но заказать нельзя.
// Повторный запуск обновляет позиции по названию в разделе; позиции, которых нет в файле, скрываются, а не удаляются:
// на них ссылаются старые заказы.
//   DATABASE_URL=... npx tsx apps/api/src/cli/import-menu.ts qvarc-uvildy data/menu-summer-2026.json
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createDb, type Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';

const FileSchema = z.object({
  source: z.string(),
  menuName: z.string().default('Лето 2026'),
  restaurantName: z.string().default('Ресторан «Кварц»'),
  restaurantPhone: z.string().optional(),
  categories: z.array(
    z.object({
      name: z.string().min(1),
      items: z.array(
        z.object({
          name: z.string().min(1),
          price: z.number().int().positive(),
          weightGrams: z.number().int().positive().optional(),
          volumeMl: z.number().int().positive().optional(),
          description: z.string().optional(),
        }),
      ),
    }),
  ),
});

export async function importMenu(db: Database, propertyCode: string, data: unknown) {
  const file = FileSchema.parse(data);
  const property = await db.selectFrom('property').select('id').where('code', '=', propertyCode).executeTakeFirstOrThrow();
  return db.transaction().execute(async (trx) => {
    let restaurant = await trx.selectFrom('restaurant').select('id').where('property_id', '=', property.id).where('name', '=', file.restaurantName).executeTakeFirst();
    const createdRestaurant = !restaurant;
    restaurant ??= await trx
      .insertInto('restaurant')
      .values({ property_id: property.id, name: file.restaurantName, phone: file.restaurantPhone ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    let menu = await trx.selectFrom('menu').select('id').where('restaurant_id', '=', restaurant.id).where('name', '=', file.menuName).executeTakeFirst();
    menu ??= await trx
      .insertInto('menu')
      .values({ property_id: property.id, restaurant_id: restaurant.id, name: file.menuName })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx.updateTable('menu').set({ is_active: true }).where('id', '=', menu.id).execute();

    const existing = await trx.selectFrom('menu_item').select(['id', 'section', 'name']).where('menu_id', '=', menu.id).execute();
    const byKey = new Map(existing.map((i) => [`${i.section}\n${i.name}`, i.id]));
    const keep = new Set<string>();
    let created = 0;
    let updated = 0;
    for (const [ci, c] of file.categories.entries()) {
      for (const [ii, it] of c.items.entries()) {
        const values = {
          description: it.description ?? null,
          weight_g: it.weightGrams ?? null,
          volume_ml: it.volumeMl ?? null,
          price_minor: it.price,
          sort_order: ci * 1000 + ii,
          is_active: true,
        };
        const id = byKey.get(`${c.name}\n${it.name}`);
        if (id) {
          await trx.updateTable('menu_item').set(values).where('id', '=', id).execute();
          keep.add(id);
          updated++;
        } else {
          const row = await trx.insertInto('menu_item').values({ menu_id: menu.id, section: c.name, name: it.name, ...values }).returning('id').executeTakeFirstOrThrow();
          keep.add(row.id);
          created++;
        }
      }
    }
    const hide = existing.filter((i) => !keep.has(i.id)).map((i) => i.id);
    if (hide.length) await trx.updateTable('menu_item').set({ is_active: false }).where('id', 'in', hide).execute();
    await new AuditService(trx).write(
      { propertyId: property.id, actorType: 'system', actorId: null, action: 'menu.import', entity: 'menu', entityId: menu.id, after: { source: file.source, created, updated, hidden: hide.length } },
      trx,
    );
    return [
      `${file.restaurantName}: ${createdRestaurant ? 'создан, часы работы задайте в админке' : 'уже был'}`,
      `меню «${file.menuName}»: добавлено ${created}, обновлено ${updated}, скрыто ${hide.length}`,
    ];
  });
}

if (require.main === module) {
  const [propertyCode, path = 'data/menu-summer-2026.json'] = process.argv.slice(2);
  if (!propertyCode || !process.env.DATABASE_URL) {
    console.error('Использование: DATABASE_URL=... npx tsx apps/api/src/cli/import-menu.ts <код объекта> [файл]');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL, 2);
  importMenu(db, propertyCode, JSON.parse(readFileSync(path, 'utf8')))
    .then((r) => console.log(r.join('\n')))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
