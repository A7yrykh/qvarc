import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Database } from '../../../../packages/db/src';
import { importTravelline, readTravelline } from '../cli/import-travelline';
import { importTravellineRates, readTravellineRates } from '../cli/import-travelline-rates';
import { DB } from '../common/tokens';
import { parse } from '../common/validation';
import { CurrentUser, RequirePerms, type StaffUser } from '../iam/auth.decorators';

// Файлы приходят из админки в base64; 3 МБ xlsx ≈ 4 МБ base64
const xlsx = z.string().max(4_500_000).optional();
const ImportBody = z
  .object({ ratePlans: xlsx, bookings: xlsx })
  .refine((b) => b.ratePlans || b.bookings, { message: 'Выберите хотя бы один файл' });

/**
 * Перенос из TravelLine через админку, теми же правилами, что и в cli/import-travelline*.ts:
 * сначала цены (шахматка тарифов), затем брони. Повторная загрузка не создаёт дублей.
 */
@Controller('admin/v1/imports')
export class ImportsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Post('travelline')
  @HttpCode(200)
  @RequirePerms('users.manage')
  async travelline(@Body() body: unknown, @CurrentUser() user: StaffUser) {
    const b = parse(ImportBody, body);
    const { code } = await this.db.selectFrom('property').select('code').where('id', '=', user.propertyId).executeTakeFirstOrThrow();
    const result: { rates?: { plan: string; created: boolean; rules: number }[]; period?: { from: string; to: string }; bookings?: Awaited<ReturnType<typeof importTravelline>> } = {};
    try {
      if (b.ratePlans) {
        const data = await readTravellineRates(Buffer.from(b.ratePlans, 'base64'));
        result.rates = await importTravellineRates(this.db, code, data);
        result.period = { from: data.from, to: data.to };
      }
      if (b.bookings) {
        result.bookings = await importTravelline(this.db, code, await readTravelline(Buffer.from(b.bookings, 'base64')));
      }
    } catch (e) {
      // Ошибки разбора выгрузки понятны администратору: неверный файл, неизвестный тариф или категория
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
    return result;
  }
}
