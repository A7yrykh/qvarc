import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { addDays, decideNight, diffDays, nightsBetween, parseDateRange, pickFloor, resolveRules, toDateRange, todayIn, type CompetitorQuote, type PricingParams } from '../../../../packages/domain/src';
import type { Database } from '../../../../packages/db/src';
import { AvailabilityService } from '../bookings/availability.service';
import { AuditService } from '../common/audit.service';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import type { StaffUser } from '../iam/auth.decorators';
import { InventoryService } from '../inventory/inventory.service';
import { CategoryBody, CompetitorBody, FloorBody, ManualPriceBody, SettingsBody } from './pricing.schemas';
import { UVILDY_COMPETITORS } from './presets';
import { COMPETITOR_SOURCES, type CompetitorSources, type FetchFn } from './sources';

type Actor = { user: StaffUser; ip: string | null };

/** Правило цены, выставленной по соседям, перекрывает ручные правила (у них приоритет 100). */
export const AUTO_PRIORITY = 1000;
export const AUTO_LABEL = 'Цена от соседей';
/** Собранные автоматически цены соседей старше этого в расчёт не берутся; внесённые вручную действуют, пока их не заменят */
const FRESH_DAYS = 3;

@Injectable()
export class PricingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Pricing');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  fetchFn: FetchFn = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(COMPETITOR_SOURCES) private readonly sources: CompetitorSources,
    private readonly audit: AuditService,
    private readonly inv: InventoryService,
    private readonly availability: AvailabilityService,
  ) {}

  onModuleInit() {
    if (!this.config.jobs) return;
    // Раз в 10 минут проверяем, не пора ли собрать цены; сам сбор — раз в collect_every_hours
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.tick()
        .catch((e) => this.logger.error(e instanceof Error ? e.stack : String(e)))
        .finally(() => (this.running = false));
    }, 600_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Плановый запуск. Несколько копий API не задваиваются: объект захватывается обновлением last_run_at. */
  async tick() {
    const due = await sql<{ property_id: string }>`
      UPDATE pricing_settings SET last_run_at = now()
       WHERE last_run_at IS NULL OR last_run_at < now() - collect_every_hours * interval '1 hour'
       RETURNING property_id`.execute(this.db);
    for (const { property_id } of due.rows) {
      await this.collectAll(property_id);
      await this.recompute(property_id, null);
    }
    // Новые брони пересчитывают цены сразу, не дожидаясь сбора: так ажиотаж поднимает цену в течение 10 минут
    const booked = await sql<{ property_id: string }>`
      UPDATE pricing_settings ps SET last_recompute_at = now()
       WHERE ps.rate_plan_id IS NOT NULL
         AND ps.last_recompute_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM booking b WHERE b.property_id = ps.property_id AND b.created_at > ps.last_recompute_at)
       RETURNING property_id`.execute(this.db);
    for (const { property_id } of booked.rows) await this.recompute(property_id, null);
    return due.rows.length;
  }

  // ───────────── настройки ─────────────

  async settings(propertyId: string) {
    await this.db.insertInto('pricing_settings').values({ property_id: propertyId }).onConflict((oc) => oc.column('property_id').doNothing()).execute();
    return this.db.selectFrom('pricing_settings').selectAll().where('property_id', '=', propertyId).executeTakeFirstOrThrow();
  }

  async updateSettings(a: Actor, input: z.infer<typeof SettingsBody>) {
    const before = await this.settings(a.user.propertyId);
    if (input.ratePlanId) await this.inv.assertRatePlan(a.user.propertyId, input.ratePlanId);
    if (input.autoApply && !(input.ratePlanId ?? before.rate_plan_id)) throw new UnprocessableEntityException('Сначала выберите тариф, цены которого считать');
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('pricing_settings')
        .set({
          auto_apply: input.autoApply,
          rate_plan_id: input.ratePlanId ?? null,
          min_discount_pct: String(input.minDiscountPct),
          max_discount_pct: String(input.maxDiscountPct),
          reference: input.reference,
          horizon_days: input.horizonDays,
          occupancy_low_pct: input.occupancyLowPct,
          occupancy_high_pct: input.occupancyHighPct,
          last_minute_days: input.lastMinuteDays,
          collect_every_hours: input.collectEveryHours,
          round_to_minor: input.roundToMinor,
          surge_window_hours: input.surgeWindowHours,
          surge_min_bookings: input.surgeMinBookings,
          surge_markup_pct: String(input.surgeMarkupPct),
          updated_by: a.user.id,
          updated_at: new Date(),
        })
        .where('property_id', '=', a.user.propertyId)
        .returningAll()
        .executeTakeFirstOrThrow();
      const action = before.auto_apply !== input.autoApply ? (input.autoApply ? 'pricing.auto_on' : 'pricing.auto_off') : 'pricing.settings';
      await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action, entity: 'pricing_settings', entityId: a.user.propertyId, before, after: input, ip: a.ip }, trx);
      return row;
    });
  }

  private params(s: Awaited<ReturnType<PricingService['settings']>>): PricingParams {
    return {
      minDiscountPct: Number(s.min_discount_pct),
      maxDiscountPct: Number(s.max_discount_pct),
      reference: s.reference as 'min' | 'avg',
      occupancyLowPct: s.occupancy_low_pct,
      occupancyHighPct: s.occupancy_high_pct,
      lastMinuteDays: s.last_minute_days,
      roundToMinor: s.round_to_minor,
      surgeMinBookings: s.surge_min_bookings,
      surgeMarkupPct: Number(s.surge_markup_pct),
    };
  }

  // ───────────── соседи и их категории ─────────────

  async listCompetitors(propertyId: string) {
    const comps = await this.db.selectFrom('competitor').selectAll().where('property_id', '=', propertyId).orderBy('name').execute();
    const ids = comps.length ? comps.map((c) => c.id) : ['00000000-0000-0000-0000-000000000000'];
    const cats = await this.db.selectFrom('competitor_category').selectAll().where('competitor_id', 'in', ids).orderBy('name').execute();
    const runs = await this.db
      .selectFrom('competitor_fetch_run')
      .selectAll()
      .where('competitor_id', 'in', ids)
      .where(sql<boolean>`started_at > now() - interval '30 days'`)
      .orderBy('started_at', 'desc')
      .execute();
    return comps.map((c) => ({
      ...c,
      categories: cats.filter((x) => x.competitor_id === c.id),
      lastRun: runs.find((r) => r.competitor_id === c.id) ?? null,
    }));
  }

  private async assertCompetitor(propertyId: string, id: string, trx: Database = this.db) {
    const c = await trx.selectFrom('competitor').selectAll().where('id', '=', id).where('property_id', '=', propertyId).executeTakeFirst();
    if (!c) throw new NotFoundException('Сосед не найден');
    return c;
  }

  async createCompetitor(a: Actor, input: z.infer<typeof CompetitorBody>) {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('competitor')
        .values({ property_id: a.user.propertyId, name: input.name, site_url: input.siteUrl ?? null, source_kind: input.sourceKind, source_ref: input.sourceRef ?? null, is_active: input.isActive, note: input.note ?? null })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.competitor.create', entity: 'competitor', entityId: row.id, after: input, ip: a.ip }, trx);
      return row;
    });
  }

  async updateCompetitor(a: Actor, id: string, input: z.infer<typeof CompetitorBody>) {
    return this.db.transaction().execute(async (trx) => {
      const before = await this.assertCompetitor(a.user.propertyId, id, trx);
      const row = await trx
        .updateTable('competitor')
        .set({ name: input.name, site_url: input.siteUrl ?? null, source_kind: input.sourceKind, source_ref: input.sourceRef ?? null, is_active: input.isActive, note: input.note ?? null })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.competitor.update', entity: 'competitor', entityId: id, before, after: input, ip: a.ip }, trx);
      return row;
    });
  }

  /** «Верт» и «Гости» с категориями, сопоставленными нашим по коду категории. Уже заведённые соседи не трогаются. */
  async addPresets(a: Actor) {
    const types = await this.db.selectFrom('accommodation_type').select(['id', 'code']).where('property_id', '=', a.user.propertyId).execute();
    const byCode = new Map(types.map((t) => [t.code, t.id]));
    const added: string[] = [];
    await this.db.transaction().execute(async (trx) => {
      for (const p of UVILDY_COMPETITORS) {
        const exists = await trx.selectFrom('competitor').select('id').where('property_id', '=', a.user.propertyId).where('name', '=', p.name).executeTakeFirst();
        if (exists) continue;
        const c = await trx
          .insertInto('competitor')
          .values({ property_id: a.user.propertyId, name: p.name, site_url: p.siteUrl, source_kind: p.sourceKind, source_ref: p.sourceRef ?? null, note: p.note })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('competitor_category')
          .values(p.categories.map((x) => ({ competitor_id: c.id, external_ref: x.externalRef, name: x.name, accommodation_type_id: (x.typeCode && byCode.get(x.typeCode)) || null, factor: String(x.factor ?? 1) })))
          .execute();
        await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.competitor.create', entity: 'competitor', entityId: c.id, after: p, ip: a.ip }, trx);
        added.push(p.name);
      }
    });
    return { added };
  }

  /** Категория соседа и наша категория, с которой её сравнивать */
  async upsertCategory(a: Actor, competitorId: string, input: z.infer<typeof CategoryBody>) {
    await this.assertCompetitor(a.user.propertyId, competitorId);
    if (input.accommodationTypeId) await this.inv.assertType(a.user.propertyId, input.accommodationTypeId);
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('competitor_category')
        .values({ competitor_id: competitorId, external_ref: input.externalRef, name: input.name, accommodation_type_id: input.accommodationTypeId ?? null, factor: String(input.factor) })
        .onConflict((oc) => oc.columns(['competitor_id', 'external_ref']).doUpdateSet({ name: input.name, accommodation_type_id: input.accommodationTypeId ?? null, factor: String(input.factor) }))
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.category.map', entity: 'competitor_category', entityId: row.id, after: input, ip: a.ip }, trx);
      return row;
    });
  }

  /** Цены, внесённые вручную (с сайта соседа, по телефону): одна цена на все ночи периода */
  async addManualPrices(a: Actor, input: z.infer<typeof ManualPriceBody>) {
    await this.assertCompetitor(a.user.propertyId, input.competitorId);
    const cat = await this.db.selectFrom('competitor_category').select(['external_ref']).where('competitor_id', '=', input.competitorId).where('external_ref', '=', input.externalRef).executeTakeFirst();
    if (!cat) throw new UnprocessableEntityException('Сначала добавьте категорию соседа');
    const today = await this.today(a.user.propertyId);
    const nights = nightsBetween(input.from, input.to);
    if (nights.length > 366) throw new UnprocessableEntityException('Период не больше года');
    await this.savePrices(input.competitorId, today, nights.map((night) => ({ externalRef: input.externalRef, name: '', night, priceMinor: input.priceMinor })), 'manual');
    await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.competitor.manual_prices', entity: 'competitor', entityId: input.competitorId, after: input, ip: a.ip });
    return { saved: nights.length };
  }

  private async savePrices(competitorId: string, collectedOn: string, prices: { externalRef: string; night: string; priceMinor: number | null }[], source: 'auto' | 'manual') {
    for (let i = 0; i < prices.length; i += 500) {
      const chunk = prices.slice(i, i + 500);
      await this.db
        .insertInto('competitor_price')
        .values(chunk.map((p) => ({ competitor_id: competitorId, external_ref: p.externalRef, night: p.night, price_minor: p.priceMinor, available: p.priceMinor !== null, collected_on: collectedOn, source })))
        .onConflict((oc) =>
          oc.columns(['competitor_id', 'external_ref', 'night', 'collected_on']).doUpdateSet((eb) => ({
            price_minor: eb.ref('excluded.price_minor'),
            available: eb.ref('excluded.available'),
            source: eb.ref('excluded.source'),
            collected_at: sql`now()`,
          })),
        )
        .execute();
    }
  }

  private async today(propertyId: string) {
    const p = await this.db.selectFrom('property').select('timezone').where('id', '=', propertyId).executeTakeFirstOrThrow();
    return todayIn(p.timezone);
  }

  // ───────────── сбор цен ─────────────

  async collectAll(propertyId: string) {
    const s = await this.settings(propertyId);
    const comps = await this.db.selectFrom('competitor').selectAll().where('property_id', '=', propertyId).where('is_active', '=', true).where('source_kind', '!=', 'manual').execute();
    const results = [];
    for (const c of comps) results.push(await this.collectOne(propertyId, c.id, s.horizon_days));
    return results;
  }

  async collectOne(propertyId: string, competitorId: string, horizonDays?: number) {
    const c = await this.assertCompetitor(propertyId, competitorId);
    const source = this.sources[c.source_kind];
    if (!source || !c.source_ref) throw new UnprocessableEntityException('Для этого соседа цены вносятся вручную');
    const horizon = horizonDays ?? (await this.settings(propertyId)).horizon_days;
    const today = await this.today(propertyId);
    const nights = nightsBetween(today, addDays(today, horizon));
    const run = await this.db.insertInto('competitor_fetch_run').values({ competitor_id: c.id }).returning('id').executeTakeFirstOrThrow();
    try {
      const categories = await this.db.selectFrom('competitor_category').select(['external_ref as externalRef', 'name']).where('competitor_id', '=', c.id).execute();
      const prices = await source.collect(c.source_ref, nights, { fetchFn: this.fetchFn, categories });
      // Новые категории соседа появляются в списке без привязки: владелец сам решает, с чем сравнивать
      const seen = new Map(prices.map((p) => [p.externalRef, p.name || p.externalRef]));
      for (const [ref, name] of seen) {
        await this.db
          .insertInto('competitor_category')
          .values({ competitor_id: c.id, external_ref: ref, name })
          .onConflict((oc) => oc.columns(['competitor_id', 'external_ref']).doNothing())
          .execute();
      }
      await this.savePrices(c.id, today, prices, 'auto');
      await this.db.updateTable('competitor_fetch_run').set({ status: 'ok', finished_at: new Date(), prices: prices.length }).where('id', '=', run.id).execute();
      return { competitorId: c.id, name: c.name, status: 'ok' as const, prices: prices.length };
    } catch (e) {
      const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : '';
      const error = e instanceof Error ? (e.message === 'fetch failed' ? `сайт не отвечает${cause ? ` (${cause})` : ''}` : e.message) : String(e);
      this.logger.warn(`Цены «${c.name}» не собраны: ${error}`);
      await this.db.updateTable('competitor_fetch_run').set({ status: 'error', finished_at: new Date(), error: error.slice(0, 1000) }).where('id', '=', run.id).execute();
      return { competitorId: c.id, name: c.name, status: 'error' as const, error };
    }
  }

  /** Последние цены соседей по ночам: для таблицы в админке и для расчёта */
  async latestPrices(propertyId: string, from: string, to: string) {
    const rows = await sql<{ competitor_id: string; competitor: string; external_ref: string; category: string; accommodation_type_id: string | null; factor: string; night: string; price_minor: number | null; collected_at: Date; source: string }>`
      SELECT DISTINCT ON (p.competitor_id, p.external_ref, p.night)
             p.competitor_id, c.name AS competitor, p.external_ref, coalesce(cc.name, p.external_ref) AS category,
             cc.accommodation_type_id, coalesce(cc.factor, 1)::text AS factor, p.night::text AS night, p.price_minor, p.collected_at, p.source
        FROM competitor_price p
        JOIN competitor c ON c.id = p.competitor_id
        LEFT JOIN competitor_category cc ON cc.competitor_id = p.competitor_id AND cc.external_ref = p.external_ref
       WHERE c.property_id = ${propertyId} AND c.is_active
         AND p.night >= ${from}::date AND p.night < ${to}::date
         AND (p.source = 'manual' OR p.collected_at > now() - ${FRESH_DAYS} * interval '1 day')
       ORDER BY p.competitor_id, p.external_ref, p.night, p.collected_at DESC`.execute(this.db);
    return rows.rows;
  }

  // ───────────── минимальные цены ─────────────

  listFloors(propertyId: string) {
    return this.db.selectFrom('pricing_floor').selectAll().where('property_id', '=', propertyId).orderBy('created_at', 'desc').execute();
  }

  async createFloor(a: Actor, input: z.infer<typeof FloorBody>) {
    await this.inv.assertType(a.user.propertyId, input.accommodationTypeId);
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('pricing_floor')
        .values({ property_id: a.user.propertyId, accommodation_type_id: input.accommodationTypeId, period: toDateRange(input.from, input.to), min_price_minor: input.minPriceMinor, label: input.label ?? null, created_by: a.user.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.floor.create', entity: 'pricing_floor', entityId: row.id, after: input, ip: a.ip }, trx);
      return row;
    });
  }

  async deleteFloor(a: Actor, id: string) {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('pricing_floor').selectAll().where('id', '=', id).where('property_id', '=', a.user.propertyId).executeTakeFirst();
      if (!before) throw new NotFoundException('Минимум не найден');
      await trx.deleteFrom('pricing_floor').where('id', '=', id).execute();
      await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.floor.delete', entity: 'pricing_floor', entityId: id, before, ip: a.ip }, trx);
      return { ok: true };
    });
  }

  // ───────────── расчёт цен ─────────────

  /**
   * Предложения цен на horizon_days вперёд. Если включено автоприменение — цены сразу ставятся в тариф.
   * userId: кто запустил пересчёт вручную (NULL — по расписанию).
   */
  async recompute(propertyId: string, userId: string | null) {
    const s = await this.settings(propertyId);
    await this.db.updateTable('pricing_settings').set({ last_recompute_at: new Date() }).where('property_id', '=', propertyId).execute();
    if (!s.rate_plan_id) return { proposed: 0, applied: 0, skipped: {} as Record<string, number>, message: 'Не выбран тариф' };
    const params = this.params(s);
    const today = await this.today(propertyId);
    const to = addDays(today, s.horizon_days);
    const types = await this.db
      .selectFrom('accommodation_type as t')
      .innerJoin('rate_plan_type as pt', 'pt.accommodation_type_id', 't.id')
      .select(['t.id', 't.name'])
      .where('pt.rate_plan_id', '=', s.rate_plan_id)
      .where('t.is_active', '=', true)
      .execute();
    const prices = await this.latestPrices(propertyId, today, to);
    const floors = (await this.listFloors(propertyId)).map((f) => ({ typeId: f.accommodation_type_id, ...parseDateRange(f.period), minPriceMinor: f.min_price_minor, createdAt: f.created_at }));
    const open = await this.db
      .selectFrom('price_recommendation')
      .selectAll()
      .where('rate_plan_id', '=', s.rate_plan_id)
      .where('status', '=', 'proposed')
      .where('night', '>=', today)
      .execute();
    const openKey = new Map(open.map((r) => [`${r.accommodation_type_id}|${r.night}`, r]));

    let proposed = 0;
    let applied = 0;
    const skipped: Record<string, number> = {};
    for (const t of types) {
      const rules = await this.availability.loadRules(t.id, s.rate_plan_id, today, to);
      const occ = await this.occupancy(t.id, today, to, s.surge_window_hours);
      const typeFloors = floors.filter((f) => f.typeId === t.id);
      for (const night of nightsBetween(today, to)) {
        const resolved = resolveRules(rules, night);
        const prev = openKey.get(`${t.id}|${night}`);
        if (resolved.closed) {
          skipped.closed = (skipped.closed ?? 0) + 1;
          continue;
        }
        const quotes = this.quotesFor(prices, t.id, night);
        const o = occ.get(night) ?? { occupied: 0, total: 0, recentBookings: 0 };
        const decision = decideNight({ ...o, leadDays: diffDays(today, night), quotes, floorMinor: pickFloor(typeFloors, night), currentMinor: resolved.priceMinor }, params);
        if (decision.kind === 'skip') {
          skipped[decision.reason] = (skipped[decision.reason] ?? 0) + 1;
          if (prev) await this.expire(prev.id);
          continue;
        }
        if (decision.suggestedMinor === resolved.priceMinor) {
          if (prev) await this.expire(prev.id);
          continue;
        }
        let recId = prev?.id;
        if (!prev || Number(prev.suggested_minor) !== decision.suggestedMinor) {
          if (prev) await this.expire(prev.id);
          const rec = await this.db
            .insertInto('price_recommendation')
            .values({
              property_id: propertyId,
              accommodation_type_id: t.id,
              rate_plan_id: s.rate_plan_id,
              night,
              current_minor: resolved.priceMinor ?? 0,
              suggested_minor: decision.suggestedMinor,
              reasons: JSON.stringify({ ...decision.reasons, typeName: t.name }),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          recId = rec.id;
          proposed++;
        }
        if (s.auto_apply && recId) {
          await this.apply(propertyId, recId, null, true);
          applied++;
        }
      }
    }
    await this.audit.write({ propertyId, actorType: userId ? 'user' : 'system', actorId: userId, action: 'pricing.recompute', entity: 'pricing_settings', entityId: propertyId, after: { proposed, applied, skipped, autoApply: s.auto_apply } });
    return { proposed, applied, skipped };
  }

  /** По каждому соседу — самая дешёвая из его категорий, сопоставленных с нашей, с поправочным коэффициентом */
  private quotesFor(prices: Awaited<ReturnType<PricingService['latestPrices']>>, typeId: string, night: string): CompetitorQuote[] {
    const byComp = new Map<string, { competitor: string; values: (number | null)[] }>();
    for (const p of prices) {
      if (p.accommodation_type_id !== typeId || p.night !== night) continue;
      const e = byComp.get(p.competitor_id) ?? { competitor: p.competitor, values: [] };
      e.values.push(p.price_minor === null ? null : Math.round(p.price_minor * Number(p.factor)));
      byComp.set(p.competitor_id, e);
    }
    return [...byComp.values()].map((e) => {
      const avail = e.values.filter((v): v is number => v !== null);
      return { competitor: e.competitor, priceMinor: avail.length ? Math.min(...avail) : null };
    });
  }

  /** Занятость категории по ночам: брони (в том числе без номера) и закрытые номера; и сколько броней на ночь сделано за последние часы */
  private async occupancy(typeId: string, from: string, to: string, surgeWindowHours: number) {
    const r = await sql<{ night: string; occupied: number; total: number; recent: number }>`
      SELECT n::date::text AS night,
             (SELECT count(*) FROM booking_stay s JOIN booking b ON b.id = s.booking_id
               WHERE s.accommodation_type_id = ${typeId} AND s.is_active AND s.stay @> n::date
                 AND b.created_at > now() - ${surgeWindowHours} * interval '1 hour')::int AS recent,
             (SELECT count(*) FROM accommodation_unit u WHERE u.accommodation_type_id = ${typeId} AND u.is_active)::int AS total,
             ((SELECT count(*) FROM booking_stay s WHERE s.accommodation_type_id = ${typeId} AND s.is_active AND s.stay @> n::date)
              + (SELECT count(*) FROM accommodation_unit u WHERE u.accommodation_type_id = ${typeId} AND u.is_active
                   AND EXISTS (SELECT 1 FROM availability_block b
                                WHERE (b.unit_id = u.id OR b.accommodation_type_id = u.accommodation_type_id) AND b.period @> n::date)))::int AS occupied
        FROM generate_series(${from}::date, ${to}::date - 1, interval '1 day') n`.execute(this.db);
    return new Map(r.rows.map((x) => [x.night, { occupied: Math.min(x.occupied, x.total), total: x.total, recentBookings: x.recent }]));
  }

  private expire(id: string) {
    return this.db.updateTable('price_recommendation').set({ status: 'expired', decided_at: new Date() }).where('id', '=', id).where('status', '=', 'proposed').execute();
  }

  /** Ставит предложенную цену в тариф отдельным правилом на одну ночь. Прежнее автоправило на эту ночь снимается. */
  async apply(propertyId: string, recId: string, userId: string | null, auto: boolean) {
    return this.db.transaction().execute(async (trx) => {
      const rec = await trx.selectFrom('price_recommendation').selectAll().where('id', '=', recId).where('property_id', '=', propertyId).forUpdate().executeTakeFirst();
      if (!rec) throw new NotFoundException('Предложение не найдено');
      if (rec.status !== 'proposed') throw new UnprocessableEntityException('Предложение уже рассмотрено или устарело');
      const period = toDateRange(rec.night, addDays(rec.night, 1));
      await trx
        .deleteFrom('rate_rule')
        .where('rate_plan_id', '=', rec.rate_plan_id)
        .where('accommodation_type_id', '=', rec.accommodation_type_id)
        .where('source', '=', 'auto_pricing')
        .where(sql<boolean>`period = ${period}::daterange`)
        .execute();
      const rule = await trx
        .insertInto('rate_rule')
        .values({ rate_plan_id: rec.rate_plan_id, accommodation_type_id: rec.accommodation_type_id, period, priority: AUTO_PRIORITY, price_minor: rec.suggested_minor, label: AUTO_LABEL, source: 'auto_pricing', created_by: userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('price_recommendation')
        .set({ status: 'accepted', decided_by: userId, decided_at: new Date(), applied_auto: auto, rate_rule_id: rule.id })
        .where('id', '=', recId)
        .execute();
      await this.audit.write(
        { propertyId, actorType: userId ? 'user' : 'system', actorId: userId, action: auto ? 'pricing.auto_apply' : 'pricing.accept', entity: 'price_recommendation', entityId: recId, before: { priceMinor: rec.current_minor }, after: { priceMinor: rec.suggested_minor, night: rec.night } },
        trx,
      );
      return { id: recId, rateRuleId: rule.id };
    });
  }

  async decide(a: Actor, ids: string[], accept: boolean) {
    let done = 0;
    for (const id of ids) {
      if (accept) await this.apply(a.user.propertyId, id, a.user.id, false);
      else {
        const r = await this.db
          .updateTable('price_recommendation')
          .set({ status: 'rejected', decided_by: a.user.id, decided_at: new Date() })
          .where('id', '=', id)
          .where('property_id', '=', a.user.propertyId)
          .where('status', '=', 'proposed')
          .executeTakeFirst();
        if (!r.numUpdatedRows) throw new UnprocessableEntityException('Предложение уже рассмотрено или устарело');
        await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.reject', entity: 'price_recommendation', entityId: id, ip: a.ip });
      }
      done++;
    }
    return { done };
  }

  /** Снимает все цены, выставленные по соседям, на будущие ночи: снова действуют ручные цены тарифа */
  async removeAutoPrices(a: Actor) {
    const today = await this.today(a.user.propertyId);
    return this.db.transaction().execute(async (trx) => {
      const r = await trx
        .deleteFrom('rate_rule')
        .where('source', '=', 'auto_pricing')
        .where('rate_plan_id', 'in', (eb) => eb.selectFrom('rate_plan').select('id').where('property_id', '=', a.user.propertyId))
        .where(sql<boolean>`lower(period) >= ${today}::date`)
        .executeTakeFirst();
      const removed = Number(r.numDeletedRows);
      await this.audit.write({ propertyId: a.user.propertyId, actorId: a.user.id, action: 'pricing.auto_remove', entity: 'rate_rule', after: { removed, from: today }, ip: a.ip }, trx);
      return { removed };
    });
  }

  listRecommendations(propertyId: string, filter: { status?: string; from?: string; to?: string }) {
    let q = this.db
      .selectFrom('price_recommendation as r')
      .innerJoin('accommodation_type as t', 't.id', 'r.accommodation_type_id')
      .leftJoin('app_user as u', 'u.id', 'r.decided_by')
      .selectAll('r')
      .select(['t.name as type_name', 'u.full_name as decided_by_name'])
      .where('r.property_id', '=', propertyId);
    if (filter.status) q = q.where('r.status', '=', filter.status);
    if (filter.from) q = q.where('r.night', '>=', filter.from);
    if (filter.to) q = q.where('r.night', '<', filter.to);
    return q.orderBy(filter.status === 'proposed' ? 'r.night' : 'r.decided_at', filter.status === 'proposed' ? 'asc' : 'desc').orderBy('t.sort_order').limit(1000).execute();
  }

  /** Журнал: изменения цен, настроек и сборы цен соседей */
  async journal(propertyId: string) {
    const events = await this.db
      .selectFrom('audit_log as l')
      .leftJoin('app_user as u', (j) => j.on(sql`u.id::text`, '=', sql.ref('l.actor_id')))
      .select(['l.id', 'l.occurred_at as at', 'l.action', 'l.entity_id', 'l.before', 'l.after', 'l.actor_type', 'u.full_name as actor_name'])
      .where('l.property_id', '=', propertyId)
      .where('l.action', 'like', 'pricing.%')
      .orderBy('l.occurred_at', 'desc')
      .limit(300)
      .execute();
    const runs = await this.db
      .selectFrom('competitor_fetch_run as r')
      .innerJoin('competitor as c', 'c.id', 'r.competitor_id')
      .selectAll('r')
      .select('c.name')
      .where('c.property_id', '=', propertyId)
      .orderBy('r.started_at', 'desc')
      .limit(100)
      .execute();
    return { events, runs };
  }
}
