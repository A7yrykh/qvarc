// Сведения о базе для гостевого приложения и документы (правила проживания и др.) из файла data/kvarc-guest-app.json.
// Повторный запуск перезаписывает сведения и документы с теми же кодами.
//   DATABASE_URL=... npx tsx apps/api/src/cli/import-guest-app.ts qvarc-uvildy data/kvarc-guest-app.json
import { sql } from 'kysely';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createDb, type Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';

const FileSchema = z.object({
  info: z.object({
    address: z.string().max(300).optional(),
    about: z.string().max(2000).optional(),
    phones: z.array(z.string().regex(/^\+7\d{10}$/)).max(5).optional(),
    email: z.email().optional(),
    facilities: z.array(z.string().max(100)).max(30).optional(),
    faq: z.array(z.object({ q: z.string().max(300), a: z.string().max(2000) })).max(50).optional(),
  }),
  documents: z
    .array(
      z.object({
        code: z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/),
        title: z.string().min(3).max(300),
        version: z.string().min(1).max(40),
        issuer: z.string().min(2).max(200),
        sections: z.array(z.object({ title: z.string().max(300), paragraphs: z.array(z.string().max(5000)).min(1) })).min(1),
      }),
    )
    .default([]),
});

export async function importGuestApp(db: Database, propertyCode: string, data: unknown) {
  const file = FileSchema.parse(data);
  const p = await db.selectFrom('property').select(['id']).where('code', '=', propertyCode).executeTakeFirstOrThrow();
  await db
    .updateTable('property')
    .set({ settings: sql`settings || jsonb_build_object('guestApp', ${JSON.stringify(file.info)}::jsonb)` })
    .where('id', '=', p.id)
    .execute();
  for (const d of file.documents) {
    const values = { title: d.title, version: d.version, issuer: d.issuer, sections: JSON.stringify(d.sections), updated_at: new Date() };
    await db
      .insertInto('legal_document')
      .values({ property_id: p.id, code: d.code, ...values })
      .onConflict((oc) => oc.columns(['property_id', 'code']).doUpdateSet(values))
      .execute();
  }
  await new AuditService(db).write({ propertyId: p.id, actorType: 'system', actorId: null, action: 'guest_app.import', entity: 'property', entityId: p.id, after: { documents: file.documents.map((d) => `${d.code}@${d.version}`) } });
  return [`сведения для приложения: телефонов ${file.info.phones?.length ?? 0}, вопросов ${file.info.faq?.length ?? 0}`, ...file.documents.map((d) => `документ «${d.title}» версии ${d.version}`)];
}

if (require.main === module) {
  const [propertyCode, path = 'data/kvarc-guest-app.json'] = process.argv.slice(2);
  if (!propertyCode || !process.env.DATABASE_URL) {
    console.error('Использование: DATABASE_URL=... npx tsx apps/api/src/cli/import-guest-app.ts <код объекта> [файл]');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL, 2);
  importGuestApp(db, propertyCode, JSON.parse(readFileSync(path, 'utf8')))
    .then((r) => console.log(r.join('\n')))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
