import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import {
  parseDateRange,
  prepaymentMinor,
  quote,
  todayIn,
  type PrepaymentPolicy,
  type Quote,
  type RateRuleInput,
} from '../../../../packages/domain/src';
import type { Database } from '../../../../packages/db/src';
import { DB } from '../common/tokens';

export interface StayRequest {
  accommodationTypeId: string;
  ratePlanId: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
}

export interface PricedQuote extends Quote {
  prepaymentDueMinor: number;
  prepaymentPolicy: PrepaymentPolicy;
  cancellationPolicy: unknown;
}

/** Расчёт цены и поиск свободных номеров. Используется и админкой, и публичным модулем бронирования. */
@Injectable()
export class AvailabilityService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async propertyToday(propertyId: string, trx: Database = this.db) {
    const p = await trx.selectFrom('property').select(['timezone', 'hold_minutes']).where('id', '=', propertyId).executeTakeFirstOrThrow();
    return { today: todayIn(p.timezone), holdMinutes: p.hold_minutes };
  }

  async loadRules(typeId: string, ratePlanId: string, from: string, to: string, trx: Database = this.db): Promise<RateRuleInput[]> {
    const rows = await trx
      .selectFrom('rate_rule')
      .selectAll()
      .where('accommodation_type_id', '=', typeId)
      .where('rate_plan_id', '=', ratePlanId)
      .where(sql<boolean>`period && daterange(${from}, ${to}, '[]')`)
      .execute();
    return rows.map((r) => {
      const { from: f, to: t } = parseDateRange(r.period);
      return {
        id: r.id,
        from: f,
        to: t,
        weekdays: r.weekdays,
        priority: r.priority,
        createdAt: r.created_at,
        priceMinor: r.price_minor,
        extraAdultMinor: r.extra_adult_minor,
        extraChildMinor: r.extra_child_minor,
        minStay: r.min_stay,
        maxStay: r.max_stay,
        minLeadDays: r.min_lead_days,
        closed: r.closed,
        closedToArrival: r.closed_to_arrival,
        closedToDeparture: r.closed_to_departure,
      };
    });
  }

  async quote(propertyId: string, req: StayRequest, trx: Database = this.db): Promise<PricedQuote> {
    const type = await trx
      .selectFrom('accommodation_type')
      .selectAll()
      .where('id', '=', req.accommodationTypeId)
      .where('property_id', '=', propertyId)
      .executeTakeFirst();
    if (!type) throw new NotFoundException('Категория не найдена');
    const plan = await trx
      .selectFrom('rate_plan as p')
      .innerJoin('rate_plan_type as pt', 'pt.rate_plan_id', 'p.id')
      .select(['p.id', 'p.is_active', 'p.prepayment_policy', 'p.cancellation_policy'])
      .where('p.id', '=', req.ratePlanId)
      .where('p.property_id', '=', propertyId)
      .where('pt.accommodation_type_id', '=', req.accommodationTypeId)
      .executeTakeFirst();
    if (!plan || !plan.is_active) throw new UnprocessableEntityException('Тариф не продаётся для этой категории');

    const { today } = await this.propertyToday(propertyId, trx);
    const rules = await this.loadRules(req.accommodationTypeId, req.ratePlanId, req.arrival, req.departure, trx);
    const q = quote(
      rules,
      { baseOccupancy: type.base_occupancy, maxAdults: type.max_adults, maxChildren: type.max_children, maxOccupancy: type.max_occupancy },
      { arrival: req.arrival, departure: req.departure, adults: req.adults, children: req.children, today },
    );
    const prepaymentPolicy = plan.prepayment_policy as unknown as PrepaymentPolicy;
    return {
      ...q,
      prepaymentDueMinor: prepaymentMinor(prepaymentPolicy, q.totalMinor),
      prepaymentPolicy,
      cancellationPolicy: plan.cancellation_policy,
    };
  }

  /** Свободные номера категории: нет активных броней и закрытий на эти ночи. */
  freeUnits(typeId: string, arrival: string, departure: string, trx: Database = this.db) {
    return trx
      .selectFrom('accommodation_unit as u')
      .select(['u.id', 'u.name'])
      .where('u.accommodation_type_id', '=', typeId)
      .where('u.is_active', '=', true)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('booking_stay as s')
              .select(sql`1`.as('x'))
              .whereRef('s.unit_id', '=', 'u.id')
              .where('s.is_active', '=', true)
              .where(sql<boolean>`s.stay && daterange(${arrival}, ${departure})`),
          ),
        ),
      )
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('availability_block as b')
              .select(sql`1`.as('x'))
              .where((w) => w.or([w('b.unit_id', '=', w.ref('u.id')), w('b.accommodation_type_id', '=', w.ref('u.accommodation_type_id'))]))
              .where(sql<boolean>`b.period && daterange(${arrival}, ${departure})`),
          ),
        ),
      )
      .orderBy('u.name')
      .execute();
  }

  async isUnitBlocked(unitId: string, arrival: string, departure: string, trx: Database = this.db) {
    const row = await trx
      .selectFrom('availability_block as b')
      .innerJoin('accommodation_unit as u', (j) =>
        j.on((eb) => eb.or([eb('b.unit_id', '=', eb.ref('u.id')), eb('b.accommodation_type_id', '=', eb.ref('u.accommodation_type_id'))])),
      )
      .select('b.id')
      .where('u.id', '=', unitId)
      .where(sql<boolean>`b.period && daterange(${arrival}, ${departure})`)
      .executeTakeFirst();
    return !!row;
  }

  /** Поиск вариантов для гостя или администратора: категории со свободными номерами и цены по тарифам. */
  async search(propertyId: string, req: { arrival: string; departure: string; adults: number; children: number; publicOnly: boolean }) {
    const types = await this.db
      .selectFrom('accommodation_type')
      .selectAll()
      .where('property_id', '=', propertyId)
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .execute();
    const result = [];
    for (const t of types) {
      const free = await this.freeUnits(t.id, req.arrival, req.departure);
      let plansQ = this.db
        .selectFrom('rate_plan as p')
        .innerJoin('rate_plan_type as pt', 'pt.rate_plan_id', 'p.id')
        .select(['p.id', 'p.code', 'p.name', 'p.meal_plan', 'p.is_refundable'])
        .where('pt.accommodation_type_id', '=', t.id)
        .where('p.is_active', '=', true);
      if (req.publicOnly) plansQ = plansQ.where('p.is_public', '=', true).where('p.promo_only', '=', false);
      const plans = await plansQ.orderBy('p.name').execute();
      const offers = [];
      for (const p of plans) {
        const q = await this.quote(propertyId, { accommodationTypeId: t.id, ratePlanId: p.id, ...req });
        offers.push({ ratePlan: p, ...q });
      }
      result.push({
        accommodationType: {
          id: t.id, code: t.code, name: t.name, kind: t.kind, area_m2: t.area_m2,
          max_occupancy: t.max_occupancy, amenities: t.amenities, photos: t.photos, description: t.description,
        },
        freeUnits: free.length,
        offers,
      });
    }
    return result;
  }
}
