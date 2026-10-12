import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { DB } from '../common/tokens';
import type { StaffUser } from '../iam/auth.decorators';
import type { GuestPrincipal } from './guest.guard';
import { guestProfileId, shortNumber } from './guest-profile';
import { RestaurantService } from './restaurant.service';
import { GuestStayService } from './stay.service';

export const FOOD_STATUSES = ['new', 'accepted', 'cooking', 'ready', 'out_for_delivery', 'delivered', 'cancelled'] as const;
export type FoodStatus = (typeof FOOD_STATUSES)[number];
const TRANSITIONS: Record<FoodStatus, FoodStatus[]> = {
  new: ['accepted', 'cancelled'],
  accepted: ['cooking', 'cancelled'],
  cooking: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};
const LABELS: Record<string, string> = {
  new: 'Заказ получен',
  accepted: 'Принят кухней',
  cooking: 'Готовится',
  ready: 'Готов',
  delivering: 'Везём к вам',
  handed_over: 'Выдан',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

export interface FoodOrderInput {
  restaurantId: string;
  bookingId?: string;
  fulfillment: 'delivery' | 'pickup';
  paymentMethod: 'online' | 'on_delivery';
  items: { menuItemId: string; quantity: number; comment?: string }[];
  comment?: string;
}

type OrderView = {
  id: string; number: string; status: string; fulfilment: string; payment_mode: string; payment_status: string; total_minor: number;
  comment: string | null; created_at: Date; restaurant: string | null; unit_code: string | null; booking_id: string | null;
};

/**
 * Меню и заказ еды из приложения. Цена берётся только из меню на сервере, цена из приложения не принимается.
 * Заказ с оплатой при получении сразу виден кухне, онлайн-заказ — после подтверждённой оплаты.
 */
@Injectable()
export class FoodService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly restaurants: RestaurantService,
    private readonly stay: GuestStayService,
    private readonly audit: AuditService,
  ) {}

  /** Ресторан открыт сейчас: приём заказов заканчивается за 30 минут до закрытия */
  private async isOpen(trx: Database, restaurantId: string, timezone: string) {
    const r = await sql<{ ok: boolean }>`
      SELECT EXISTS (SELECT 1 FROM restaurant_hours h
                      WHERE h.restaurant_id = ${restaurantId}
                        AND h.weekday = extract(isodow FROM (now() AT TIME ZONE ${timezone}))
                        AND (now() AT TIME ZONE ${timezone})::time >= h.opens_at
                        AND (now() AT TIME ZONE ${timezone})::time < h.closes_at - interval '30 minutes') AS ok`.execute(trx);
    return r.rows[0].ok;
  }

  async menu(propertyId: string, restaurantId: string) {
    const r = await this.restaurants.restaurant(propertyId, restaurantId);
    const items = await this.db
      .selectFrom('menu_item as i')
      .innerJoin('menu as m', 'm.id', 'i.menu_id')
      .select(['i.id', 'i.section', 'i.name', 'i.description', 'i.weight_g', 'i.volume_ml', 'i.price_minor', 'i.is_available', 'i.photos', 'i.allergens', 'm.id as menu_id'])
      .where('m.restaurant_id', '=', r.id)
      .where('m.is_active', '=', true)
      .where('i.is_active', '=', true)
      .orderBy('m.name')
      .orderBy('i.sort_order')
      .orderBy('i.name')
      .execute();
    const categories: { id: string; name: string; items: unknown[] }[] = [];
    for (const i of items) {
      const catId = `${i.menu_id}:${i.section}`;
      let c = categories.find((x) => x.id === catId);
      if (!c) categories.push((c = { id: catId, name: i.section, items: [] }));
      c.items.push({
        id: i.id, name: i.name, description: i.description, weightGrams: i.weight_g, volumeMl: i.volume_ml, price: i.price_minor,
        isAvailable: i.is_available, photos: i.photos, allergens: i.allergens,
      });
    }
    return { restaurantId: r.id, acceptsDelivery: r.accepts_delivery, isOpenNow: await this.isOpen(this.db, r.id, r.timezone), categories };
  }

  async create(g: GuestPrincipal, input: FoodOrderInput, key: string) {
    const existing = await this.db.selectFrom('food_order').select('id').where('idempotency_key', '=', key).executeTakeFirst();
    if (existing) return this.getForGuest(g, existing.id);
    const id = await this.db.transaction().execute(async (trx) => {
      const r = await this.restaurants.restaurant(g.propertyId, input.restaurantId, trx);
      if (!(await this.isOpen(trx, r.id, r.timezone))) {
        throw new ConflictException({ message: 'Ресторан сейчас не принимает заказы. Посмотрите часы работы или позвоните.', code: 'restaurant_closed' });
      }
      let bookingId: string | null = null;
      let unitId: string | null = null;
      if (input.bookingId) {
        const b = await this.stay.getOwn(g, input.bookingId, trx);
        const f = await this.stay.facts(b, trx);
        bookingId = b.id;
        unitId = b.unit_id;
        // Доставка в номер — с часа до заезда и до выезда
        const staying = f.bookingState === 'active' && !f.checkedOutAt && f.departureAt > f.now && f.arrivalAt.getTime() - 3_600_000 <= f.now.getTime();
        if (input.fulfillment === 'delivery' && !staying) {
          throw new ConflictException({ message: 'Доставка в номер работает во время проживания. Сейчас можно заказать с собой.', code: 'booking_not_active' });
        }
      }
      if (input.fulfillment === 'delivery') {
        if (!r.accepts_delivery) throw new ConflictException({ message: 'Ресторан сейчас не доставляет. Можно забрать заказ самому.', code: 'delivery_unavailable' });
        // Адрес доставки — номер из брони, а не из ввода гостя
        if (!unitId) throw new ConflictException({ message: 'Номер ещё не назначен, доставка недоступна. Можно забрать заказ самому.', code: 'no_unit' });
      }

      // Одна позиция могла прийти дважды — объединяем
      const qty = new Map<string, { quantity: number; comment?: string }>();
      for (const it of input.items) {
        const prev = qty.get(it.menuItemId);
        qty.set(it.menuItemId, { quantity: (prev?.quantity ?? 0) + it.quantity, comment: [prev?.comment, it.comment].filter(Boolean).join('; ') || undefined });
      }
      const rows = await trx
        .selectFrom('menu_item as i')
        .innerJoin('menu as m', 'm.id', 'i.menu_id')
        .select(['i.id', 'i.name', 'i.price_minor', 'i.is_available'])
        .where('i.id', 'in', [...qty.keys()])
        .where('m.restaurant_id', '=', r.id)
        .where('m.is_active', '=', true)
        .where('i.is_active', '=', true)
        .execute();
      const byId = new Map(rows.map((x) => [x.id, x]));
      const missing = [...qty.keys()].filter((k) => !byId.has(k));
      if (missing.length) throw new UnprocessableEntityException({ message: 'Части блюд больше нет в меню. Обновите меню.', code: 'menu_item_not_found', menuItemIds: missing });
      const stopped = rows.filter((x) => !x.is_available);
      if (stopped.length) {
        throw new ConflictException({ message: `Сейчас нет: ${stopped.map((x) => x.name).join(', ')}`, code: 'menu_item_unavailable', menuItemIds: stopped.map((x) => x.id) });
      }
      const lines = [...qty.entries()].map(([itemId, v]) => ({ itemId, item: byId.get(itemId)!, ...v }));
      const total = lines.reduce((s, l) => s + l.item.price_minor * l.quantity, 0);
      if (total <= 0) throw new UnprocessableEntityException({ message: 'В заказе нет блюд', code: 'empty_order' });

      const order = await trx
        .insertInto('food_order')
        .values({
          property_id: g.propertyId,
          restaurant_id: r.id,
          number: shortNumber('F'),
          guest_id: await guestProfileId(trx, g),
          guest_account_id: g.accountId,
          booking_id: bookingId,
          fulfilment: input.fulfillment === 'delivery' ? 'room_delivery' : 'takeaway',
          unit_id: input.fulfillment === 'delivery' ? unitId : null,
          payment_mode: input.paymentMethod === 'online' ? 'online' : 'on_site',
          total_minor: total,
          comment: input.comment ?? null,
          idempotency_key: key,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('food_order_item')
        .values(lines.map((l) => ({ food_order_id: order.id, menu_item_id: l.itemId, name_snapshot: l.item.name, price_minor: l.item.price_minor, quantity: l.quantity, comment: l.comment ?? null })))
        .execute();
      await trx.insertInto('food_order_status_history').values({ food_order_id: order.id, status: 'new' }).execute();
      await this.audit.write(
        { propertyId: g.propertyId, actorType: 'guest', actorId: g.accountId, action: 'food_order.create', entity: 'food_order', entityId: order.id, after: { total, paymentMethod: input.paymentMethod } },
        trx,
      );
      return order.id;
    });
    return this.getForGuest(g, id);
  }

  private base() {
    return this.db
      .selectFrom('food_order as o')
      .leftJoin('restaurant as rs', 'rs.id', 'o.restaurant_id')
      .leftJoin('accommodation_unit as u', 'u.id', 'o.unit_id')
      .select(['o.id', 'o.number', 'o.status', 'o.fulfilment', 'o.payment_mode', 'o.payment_status', 'o.total_minor', 'o.comment', 'o.created_at', 'o.booking_id', 'rs.name as restaurant', 'u.name as unit_code']);
  }

  private async views(rows: OrderView[]) {
    if (!rows.length) return [];
    const items = await this.db.selectFrom('food_order_item').selectAll().where('food_order_id', 'in', rows.map((r) => r.id)).orderBy('name_snapshot').execute();
    return rows.map((o) => {
      // Названия статусов и способов — как в приложении
      const status = o.status === 'out_for_delivery' ? 'delivering' : o.status === 'delivered' && o.fulfilment === 'takeaway' ? 'handed_over' : o.status;
      const paymentMethod = o.payment_mode === 'online' ? 'online' : 'on_delivery';
      const awaitingPayment = paymentMethod === 'online' && o.status === 'new' && o.payment_status !== 'paid';
      return {
        id: o.id,
        number: o.number,
        status,
        statusLabel: awaitingPayment ? 'Ждёт оплаты' : (LABELS[status] ?? status),
        fulfillment: o.fulfilment === 'room_delivery' ? 'delivery' : 'pickup',
        paymentMethod,
        paymentStatus: o.payment_status,
        total: o.total_minor,
        comment: o.comment,
        createdAt: o.created_at,
        restaurant: o.restaurant ?? '',
        unitCode: o.unit_code,
        bookingId: o.booking_id,
        items: items
          .filter((i) => i.food_order_id === o.id)
          .map((i) => ({ menuItemId: i.menu_item_id, name: i.name_snapshot, unitPrice: i.price_minor, quantity: i.quantity, lineTotal: i.price_minor * i.quantity, comment: i.comment })),
      };
    });
  }

  async getForGuest(g: GuestPrincipal, id: string) {
    const o = await this.base().where('o.id', '=', id).where('o.guest_account_id', '=', g.accountId).executeTakeFirst();
    if (!o) throw new NotFoundException({ message: 'Заказ не найден', code: 'not_found' });
    return (await this.views([o]))[0];
  }

  async listForGuest(g: GuestPrincipal) {
    return this.views(await this.base().where('o.guest_account_id', '=', g.accountId).orderBy('o.created_at', 'desc').limit(30).execute());
  }

  /** Гость отменяет заказ, пока кухня его не приняла */
  async cancelByGuest(g: GuestPrincipal, id: string) {
    const o = await this.db.selectFrom('food_order').select('id').where('id', '=', id).where('guest_account_id', '=', g.accountId).executeTakeFirst();
    if (!o) throw new NotFoundException({ message: 'Заказ не найден', code: 'not_found' });
    await this.applyStatus(g.propertyId, id, 'cancelled', { type: 'guest', id: g.accountId }, 'Отменён гостем', ['new']);
    return this.getForGuest(g, id);
  }

  // ── Кухня ──

  /** Кухонный экран: активные заказы; онлайн-заказы видны только после оплаты */
  async kitchen(user: StaffUser, restaurantId?: string) {
    let q = this.base()
      .where('o.property_id', '=', user.propertyId)
      .where('o.status', 'not in', ['delivered', 'cancelled'])
      .where((eb) => eb.or([eb('o.payment_mode', '<>', 'online'), eb('o.payment_status', '=', 'paid')]));
    if (restaurantId) q = q.where('o.restaurant_id', '=', restaurantId);
    const rows = await q.orderBy('o.created_at').execute();
    const views = await this.views(rows);
    return views.map((v, i) => ({ ...v, staffStatus: rows[i].status }));
  }

  async setStatus(user: StaffUser, id: string, to: FoodStatus, reason?: string) {
    await this.applyStatus(user.propertyId, id, to, { type: 'user', id: user.id }, reason);
    const o = await this.base().where('o.id', '=', id).executeTakeFirstOrThrow();
    return { ...(await this.views([o]))[0], staffStatus: o.status };
  }

  private async applyStatus(propertyId: string, id: string, to: FoodStatus, actor: { type: 'guest' | 'user'; id: string }, reason?: string, onlyFrom?: FoodStatus[]) {
    await this.db.transaction().execute(async (trx) => {
      const o = await trx.selectFrom('food_order').selectAll().where('id', '=', id).where('property_id', '=', propertyId).forUpdate().executeTakeFirst();
      if (!o) throw new NotFoundException('Заказ не найден');
      const from = o.status as FoodStatus;
      if (onlyFrom && !onlyFrom.includes(from)) {
        throw new ConflictException({ message: 'Кухня уже приняла заказ. Чтобы отменить, позвоните в ресторан.', code: 'cannot_cancel' });
      }
      if (!TRANSITIONS[from].includes(to)) throw new ConflictException({ message: `Нельзя перевести заказ из «${from}» в «${to}»`, code: 'invalid_transition' });
      if (actor.type === 'user' && o.payment_mode === 'online' && o.payment_status !== 'paid' && to !== 'cancelled') {
        throw new ConflictException({ message: 'Заказ ещё не оплачен', code: 'not_paid' });
      }
      if (to === 'out_for_delivery' && o.fulfilment !== 'room_delivery') throw new ConflictException({ message: 'Это заказ на вынос', code: 'invalid_transition' });
      await trx
        .updateTable('food_order')
        .set({ status: to, updated_at: new Date(), cancel_reason: to === 'cancelled' ? (reason ?? null) : o.cancel_reason })
        .where('id', '=', id)
        .execute();
      await trx.insertInto('food_order_status_history').values({ food_order_id: id, status: to, changed_by: actor.type === 'user' ? actor.id : null }).execute();
      await this.audit.write(
        { propertyId, actorType: actor.type, actorId: actor.id, action: 'food_order.status', entity: 'food_order', entityId: id, before: { status: from }, after: { status: to, reason } },
        trx,
      );
      // Оплаченный и отменённый заказ: возврат оформляет администратор, задача ставится автоматически
      if (to === 'cancelled' && o.payment_status === 'paid') {
        await trx
          .insertInto('staff_task')
          .values({ property_id: propertyId, kind: 'refund_food', title: `Вернуть деньги за отменённый заказ ${o.number}`, source_ref: id, priority: 1, dedupe_key: `refund_food:${id}` })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      }
    });
  }

  /** Стоп-лист и цена позиции. Цена в уже оформленных заказах не меняется: она сохранена в строках заказа. */
  async updateItem(user: StaffUser, id: string, input: { priceMinor?: number; isAvailable?: boolean; isActive?: boolean }) {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('menu_item as i')
        .innerJoin('menu as m', 'm.id', 'i.menu_id')
        .select(['i.id', 'i.price_minor', 'i.is_available', 'i.is_active'])
        .where('i.id', '=', id)
        .where('m.property_id', '=', user.propertyId)
        .executeTakeFirst();
      if (!before) throw new NotFoundException({ message: 'Позиция меню не найдена', code: 'not_found' });
      const after = await trx
        .updateTable('menu_item')
        .set({
          ...(input.priceMinor !== undefined ? { price_minor: input.priceMinor } : {}),
          ...(input.isAvailable !== undefined ? { is_available: input.isAvailable } : {}),
          ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        })
        .where('id', '=', id)
        .returning(['id', 'name', 'price_minor', 'is_available', 'is_active'])
        .executeTakeFirstOrThrow();
      await this.audit.write(
        { propertyId: user.propertyId, actorId: user.id, action: 'menu_item.update', entity: 'menu_item', entityId: id, before, after: input },
        trx,
      );
      return { id: after.id, name: after.name, price: after.price_minor, isAvailable: after.is_available, isActive: after.is_active };
    });
  }
}
