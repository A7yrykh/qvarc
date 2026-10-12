import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { toDateRange, validateCancellationPolicy } from '../../../../packages/domain/src';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import type { StaffUser } from '../iam/auth.decorators';
import { BlockBody, RatePlanBody, RateRuleBody, TypeBody, UnitBody } from './inventory.schemas';

type Actor = { user: StaffUser; ip: string | null };

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private log(a: Actor, action: string, entity: string, entityId: string, after: unknown, trx: Database, before?: unknown) {
    return this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action, entity, entityId, before, after, ip: a.ip }, trx);
  }

  /** Проверяет, что запись принадлежит объекту сотрудника. Чужие записи выглядят как отсутствующие. */
  async assertType(propertyId: string, typeId: string, trx: Database = this.db) {
    const t = await trx
      .selectFrom('accommodation_type')
      .selectAll()
      .where('id', '=', typeId)
      .where('property_id', '=', propertyId)
      .executeTakeFirst();
    if (!t) throw new NotFoundException('Категория не найдена');
    return t;
  }

  async assertRatePlan(propertyId: string, planId: string, trx: Database = this.db) {
    const p = await trx
      .selectFrom('rate_plan')
      .selectAll()
      .where('id', '=', planId)
      .where('property_id', '=', propertyId)
      .executeTakeFirst();
    if (!p) throw new NotFoundException('Тариф не найден');
    return p;
  }

  listTypes(propertyId: string) {
    return this.db
      .selectFrom('accommodation_type as t')
      .selectAll('t')
      .select((eb) =>
        eb
          .selectFrom('accommodation_unit as u')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('u.accommodation_type_id', '=', 't.id')
          .where('u.is_active', '=', true)
          .as('active_units'),
      )
      .where('t.property_id', '=', propertyId)
      .orderBy('t.sort_order')
      .orderBy('t.name')
      .execute();
  }

  async createType(a: Actor, input: z.infer<typeof TypeBody>) {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('accommodation_type')
        .values({
          property_id: a.user.propertyId,
          code: input.code,
          name: input.name,
          kind: input.kind,
          area_m2: input.areaM2 ?? null,
          base_occupancy: input.baseOccupancy,
          max_adults: input.maxAdults,
          max_children: input.maxChildren,
          max_occupancy: input.maxOccupancy,
          description: input.description ?? null,
          amenities: input.amenities,
          sort_order: input.sortOrder,
          is_active: input.isActive,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'inventory.type.create', 'accommodation_type', row.id, input, trx);
      return row;
    });
  }

  async updateType(a: Actor, id: string, input: z.infer<typeof TypeBody>) {
    return this.db.transaction().execute(async (trx) => {
      const before = await this.assertType(a.user.propertyId, id, trx);
      const row = await trx
        .updateTable('accommodation_type')
        .set({
          code: input.code,
          name: input.name,
          kind: input.kind,
          area_m2: input.areaM2 ?? null,
          base_occupancy: input.baseOccupancy,
          max_adults: input.maxAdults,
          max_children: input.maxChildren,
          max_occupancy: input.maxOccupancy,
          description: input.description ?? null,
          amenities: input.amenities,
          sort_order: input.sortOrder,
          is_active: input.isActive,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'inventory.type.update', 'accommodation_type', id, input, trx, before);
      return row;
    });
  }

  listUnits(propertyId: string) {
    return this.db
      .selectFrom('accommodation_unit as u')
      .innerJoin('accommodation_type as t', 't.id', 'u.accommodation_type_id')
      .selectAll('u')
      .select(['t.name as type_name', 't.code as type_code'])
      .where('t.property_id', '=', propertyId)
      .orderBy('t.sort_order')
      .orderBy('u.name')
      .execute();
  }

  async createUnit(a: Actor, input: z.infer<typeof UnitBody>) {
    return this.db.transaction().execute(async (trx) => {
      await this.assertType(a.user.propertyId, input.accommodationTypeId, trx);
      const row = await trx
        .insertInto('accommodation_unit')
        .values({
          accommodation_type_id: input.accommodationTypeId,
          name: input.name,
          lock_system_ref: input.lockSystemRef ?? null,
          is_active: input.isActive,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'inventory.unit.create', 'accommodation_unit', row.id, input, trx);
      return row;
    });
  }

  async updateUnit(a: Actor, id: string, input: z.infer<typeof UnitBody>) {
    return this.db.transaction().execute(async (trx) => {
      const before = await this.assertUnit(a.user.propertyId, id, trx);
      await this.assertType(a.user.propertyId, input.accommodationTypeId, trx);
      const row = await trx
        .updateTable('accommodation_unit')
        .set({
          accommodation_type_id: input.accommodationTypeId,
          name: input.name,
          lock_system_ref: input.lockSystemRef ?? null,
          is_active: input.isActive,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'inventory.unit.update', 'accommodation_unit', id, input, trx, before);
      return row;
    });
  }

  async assertUnit(propertyId: string, unitId: string, trx: Database = this.db) {
    const u = await trx
      .selectFrom('accommodation_unit as u')
      .innerJoin('accommodation_type as t', 't.id', 'u.accommodation_type_id')
      .selectAll('u')
      .where('u.id', '=', unitId)
      .where('t.property_id', '=', propertyId)
      .executeTakeFirst();
    if (!u) throw new NotFoundException('Номер не найден');
    return u;
  }

  async listRatePlans(propertyId: string) {
    const plans = await this.db.selectFrom('rate_plan').selectAll().where('property_id', '=', propertyId).orderBy('name').execute();
    const links = await this.db
      .selectFrom('rate_plan_type')
      .select(['rate_plan_id', 'accommodation_type_id'])
      .where('rate_plan_id', 'in', plans.length ? plans.map((p) => p.id) : ['00000000-0000-0000-0000-000000000000'])
      .execute();
    return plans.map((p) => ({
      ...p,
      accommodation_type_ids: links.filter((l) => l.rate_plan_id === p.id).map((l) => l.accommodation_type_id),
    }));
  }

  async createRatePlan(a: Actor, input: z.infer<typeof RatePlanBody>) {
    try {
      validateCancellationPolicy(input.cancellationPolicy);
    } catch (e) {
      throw new UnprocessableEntityException((e as Error).message);
    }
    return this.db.transaction().execute(async (trx) => {
      for (const t of input.accommodationTypeIds) await this.assertType(a.user.propertyId, t, trx);
      const row = await trx
        .insertInto('rate_plan')
        .values({
          property_id: a.user.propertyId,
          code: input.code,
          name: input.name,
          meal_plan: input.mealPlan,
          is_refundable: input.isRefundable,
          cancellation_policy: JSON.stringify(input.cancellationPolicy),
          prepayment_policy: JSON.stringify(input.prepaymentPolicy),
          is_public: input.isPublic,
          is_active: input.isActive,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('rate_plan_type')
        .values(input.accommodationTypeIds.map((t) => ({ rate_plan_id: row.id, accommodation_type_id: t })))
        .execute();
      await this.log(a, 'rates.plan.create', 'rate_plan', row.id, input, trx);
      return { ...row, accommodation_type_ids: input.accommodationTypeIds };
    });
  }

  listRateRules(propertyId: string, filter: { typeId?: string; ratePlanId?: string; from?: string; to?: string }) {
    let q = this.db
      .selectFrom('rate_rule as r')
      .innerJoin('rate_plan as p', 'p.id', 'r.rate_plan_id')
      .selectAll('r')
      .where('p.property_id', '=', propertyId);
    if (filter.typeId) q = q.where('r.accommodation_type_id', '=', filter.typeId);
    if (filter.ratePlanId) q = q.where('r.rate_plan_id', '=', filter.ratePlanId);
    if (filter.from && filter.to) q = q.where(sql<boolean>`r.period && daterange(${filter.from}, ${filter.to})`);
    return q.orderBy('r.priority', 'desc').orderBy('r.created_at', 'desc').execute();
  }

  /** Новое правило не меняет уже подтверждённые брони: их цены сохранены по ночам в booking_night_price. */
  async createRateRule(a: Actor, input: z.infer<typeof RateRuleBody>) {
    return this.db.transaction().execute(async (trx) => {
      await this.assertRatePlan(a.user.propertyId, input.ratePlanId, trx);
      await this.assertType(a.user.propertyId, input.accommodationTypeId, trx);
      const linked = await trx
        .selectFrom('rate_plan_type')
        .select('rate_plan_id')
        .where('rate_plan_id', '=', input.ratePlanId)
        .where('accommodation_type_id', '=', input.accommodationTypeId)
        .executeTakeFirst();
      if (!linked) throw new UnprocessableEntityException('Тариф не продаётся для этой категории');
      const row = await trx
        .insertInto('rate_rule')
        .values({
          rate_plan_id: input.ratePlanId,
          accommodation_type_id: input.accommodationTypeId,
          period: toDateRange(input.from, input.to),
          weekdays: input.weekdays,
          priority: input.priority,
          price_minor: input.priceMinor,
          extra_adult_minor: input.extraAdultMinor,
          extra_child_minor: input.extraChildMinor,
          min_stay: input.minStay,
          max_stay: input.maxStay,
          min_lead_days: input.minLeadDays,
          closed: input.closed,
          closed_to_arrival: input.closedToArrival,
          closed_to_departure: input.closedToDeparture,
          label: input.label,
          created_by: a.user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'rates.rule.create', 'rate_rule', row.id, input, trx);
      return row;
    });
  }

  async deleteRateRule(a: Actor, id: string) {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('rate_rule as r')
        .innerJoin('rate_plan as p', 'p.id', 'r.rate_plan_id')
        .selectAll('r')
        .where('r.id', '=', id)
        .where('p.property_id', '=', a.user.propertyId)
        .executeTakeFirst();
      if (!before) throw new NotFoundException('Правило не найдено');
      await trx.deleteFrom('rate_rule').where('id', '=', id).execute();
      await this.log(a, 'rates.rule.delete', 'rate_rule', id, null, trx, before);
      return { ok: true };
    });
  }

  async createBlock(a: Actor, input: z.infer<typeof BlockBody>) {
    return this.db.transaction().execute(async (trx) => {
      if (input.unitId) await this.assertUnit(a.user.propertyId, input.unitId, trx);
      if (input.accommodationTypeId) await this.assertType(a.user.propertyId, input.accommodationTypeId, trx);
      const row = await trx
        .insertInto('availability_block')
        .values({
          unit_id: input.unitId ?? null,
          accommodation_type_id: input.accommodationTypeId ?? null,
          period: toDateRange(input.from, input.to),
          reason: input.reason,
          excludes_from_inventory: input.excludesFromInventory,
          created_by: a.user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.log(a, 'inventory.block.create', 'availability_block', row.id, input, trx);
      return row;
    });
  }
}
