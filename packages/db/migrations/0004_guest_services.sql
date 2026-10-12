-- Приложение гостя: ресторан (меню, заказ еды, столики) и услуги с прокатом.

-- ───────── ресторан ─────────
CREATE TABLE restaurant (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id               uuid NOT NULL REFERENCES property(id),
  name                      text NOT NULL,
  description               text,
  phone                     text,
  photos                    jsonb NOT NULL DEFAULT '[]',
  seating_minutes           int NOT NULL DEFAULT 120 CHECK (seating_minutes BETWEEN 15 AND 720),
  turnover_minutes          int NOT NULL DEFAULT 15 CHECK (turnover_minutes BETWEEN 0 AND 240),
  auto_confirm_reservations boolean NOT NULL DEFAULT true,
  accepts_delivery          boolean NOT NULL DEFAULT true,
  is_active                 boolean NOT NULL DEFAULT true,
  UNIQUE (property_id, name)
);

-- Часы работы по дням недели (ISO: 1 = понедельник). Нет строки — в этот день закрыто.
CREATE TABLE restaurant_hours (
  restaurant_id  uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  weekday        int NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  opens_at       time NOT NULL,
  closes_at      time NOT NULL CHECK (closes_at > opens_at),
  last_seating   time,
  PRIMARY KEY (restaurant_id, weekday)
);

ALTER TABLE menu ADD COLUMN restaurant_id uuid REFERENCES restaurant(id);
ALTER TABLE menu_item
  ADD COLUMN volume_ml  int,
  ADD COLUMN photos     jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN is_active  boolean NOT NULL DEFAULT true;  -- позиции не удаляются: на них ссылаются старые заказы

ALTER TABLE restaurant_table ADD COLUMN restaurant_id uuid REFERENCES restaurant(id);

ALTER TABLE food_order
  ADD COLUMN restaurant_id     uuid REFERENCES restaurant(id),
  ADD COLUMN guest_account_id  uuid REFERENCES guest_account(id),
  ADD COLUMN payment_status    text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','pending','paid','refunded','partially_refunded')),
  ADD COLUMN cancel_reason     text,
  ADD COLUMN updated_at        timestamptz NOT NULL DEFAULT now();
CREATE INDEX ON food_order (guest_account_id, created_at);

ALTER TABLE table_reservation
  ADD COLUMN restaurant_id     uuid REFERENCES restaurant(id),
  ADD COLUMN guest_account_id  uuid REFERENCES guest_account(id),
  ADD COLUMN number            text UNIQUE,
  ADD COLUMN wishes            text,
  ADD COLUMN allergies         text,
  ADD COLUMN idempotency_key   text UNIQUE;
CREATE INDEX ON table_reservation (restaurant_id, period);

-- ───────── услуги и прокат ─────────
-- Ресурсы услуги с прокатом — единицы оборудования (equipment_unit) её типа; пересечения запрещает
-- ограничение на equipment_reservation. Время работы и шаг записи — у самой услуги.
ALTER TABLE service
  ADD COLUMN rules                  text,
  ADD COLUMN cancellation_text      text,
  ADD COLUMN open_time              time NOT NULL DEFAULT '09:00',
  ADD COLUMN close_time             time NOT NULL DEFAULT '21:00',
  ADD COLUMN slot_step_minutes      int NOT NULL DEFAULT 60 CHECK (slot_step_minutes > 0),
  ADD COLUMN max_quantity           int NOT NULL DEFAULT 1 CHECK (max_quantity > 0),
  ADD COLUMN requires_confirmation  boolean NOT NULL DEFAULT false,
  ADD COLUMN hold_minutes           int NOT NULL DEFAULT 15 CHECK (hold_minutes BETWEEN 5 AND 120),
  ADD COLUMN sort_order             int NOT NULL DEFAULT 0;

ALTER TABLE service_booking DROP CONSTRAINT service_booking_status_check;
ALTER TABLE service_booking ADD CONSTRAINT service_booking_status_check
  CHECK (status IN ('requested','hold','confirmed','in_use','done','cancelled','expired'));
ALTER TABLE service_booking
  ADD COLUMN guest_account_id  uuid REFERENCES guest_account(id),
  ADD COLUMN hold_expires_at   timestamptz,
  ADD COLUMN idempotency_key   text UNIQUE,
  ADD COLUMN cancelled_at      timestamptz,
  ADD COLUMN payment_status    text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','pending','paid','refunded','partially_refunded'));
CREATE INDEX ON service_booking (guest_account_id, created_at);

INSERT INTO permission (code, description) VALUES
  ('restaurant.manage', 'Ресторан: часы, столики, меню, брони столиков'),
  ('kitchen.manage',    'Кухня: заказы еды и их статусы'),
  ('rental.manage',     'Услуги и прокат: каталог, выдача и возврат');

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code FROM role r CROSS JOIN (VALUES ('restaurant.manage'), ('kitchen.manage'), ('rental.manage')) p(code)
 WHERE r.is_system AND r.code IN ('owner', 'sysadmin', 'manager')
UNION ALL
SELECT r.id, p.code FROM role r CROSS JOIN (VALUES ('restaurant.manage'), ('kitchen.manage')) p(code)
 WHERE r.is_system AND r.code = 'restaurant'
UNION ALL
SELECT r.id, 'rental.manage' FROM role r WHERE r.is_system AND r.code = 'rental'
ON CONFLICT DO NOTHING;
