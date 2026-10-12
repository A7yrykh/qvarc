import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import { diffDays, nightsBetween, resolveRules } from '../../../../packages/domain/src';
import type { Database } from '../../../../packages/db/src';
import { AvailabilityService } from '../bookings/availability.service';
import { DB } from '../common/tokens';
import { InventoryService } from './inventory.service';

/**
 * Таблица «Цены и ограничения»: для каждой категории тарифа и каждого дня —
 * итоговая цена и ограничения после наложения всех правил, плюс сколько номеров свободно.
 */
@Injectable()
export class RateGridService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly inv: InventoryService,
    private readonly availability: AvailabilityService,
  ) {}

  async grid(propertyId: string, ratePlanId: string, from: string, to: string) {
    if (diffDays(from, to) > 62) throw new UnprocessableEntityException('Период не больше 62 дней');
    await this.inv.assertRatePlan(propertyId, ratePlanId);
    const days = nightsBetween(from, to);
    const types = await this.db
      .selectFrom('accommodation_type as t')
      .innerJoin('rate_plan_type as pt', 'pt.accommodation_type_id', 't.id')
      .select(['t.id', 't.name', 't.code'])
      .where('pt.rate_plan_id', '=', ratePlanId)
      .where('t.is_active', '=', true)
      .orderBy('t.sort_order')
      .execute();

    const rows = [];
    for (const t of types) {
      const rules = await this.availability.loadRules(t.id, ratePlanId, from, to);
      const free = await sql<{ night: string; free: number }>`
        SELECT n::date::text AS night,
               (SELECT count(*) FROM accommodation_unit u
                 WHERE u.accommodation_type_id = ${t.id} AND u.is_active
                   AND NOT EXISTS (SELECT 1 FROM booking_stay s
                                    WHERE s.unit_id = u.id AND s.is_active AND s.stay @> n::date)
                   AND NOT EXISTS (SELECT 1 FROM availability_block b
                                    WHERE (b.unit_id = u.id OR b.accommodation_type_id = u.accommodation_type_id)
                                      AND b.period @> n::date))::int AS free
          FROM generate_series(${from}::date, ${to}::date - 1, interval '1 day') n`.execute(this.db);
      const freeByNight = new Map(free.rows.map((r) => [r.night, r.free]));
      rows.push({
        accommodationType: t,
        days: days.map((date) => {
          const r = resolveRules(rules, date);
          return {
            date,
            free: freeByNight.get(date) ?? 0,
            priceMinor: r.priceMinor,
            extraAdultMinor: r.extraAdultMinor,
            extraChildMinor: r.extraChildMinor,
            minStay: r.minStay,
            maxStay: r.maxStay,
            minLeadDays: r.minLeadDays,
            closed: r.closed,
            closedToArrival: r.closedToArrival,
            closedToDeparture: r.closedToDeparture,
          };
        }),
      });
    }
    return { ratePlanId, from, to, rows };
  }
}
