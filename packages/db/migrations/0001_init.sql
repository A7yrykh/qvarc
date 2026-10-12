-- QVARC: схема базы данных PostgreSQL 16 (проект, версия 0.2 от 12.10.2026, собственное ядро без TravelLine)
-- Деньги хранятся в копейках (bigint *_minor), валюта по умолчанию RUB.
-- Время в timestamptz, даты проживания в date/daterange (выезд не включается: [заезд, выезд)).
-- Записи гостей и финансов не удаляются физически: отмена, сторно, архив.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────── core ─────────────────────────
CREATE TABLE organization (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name    text NOT NULL,                -- «ИП Сырых Н.Р.» и т.п.
  inn           text,
  ogrn          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE property (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  code             text NOT NULL UNIQUE,      -- 'qvarc-uvildy'
  name             text NOT NULL,
  timezone         text NOT NULL DEFAULT 'Asia/Yekaterinburg',
  currency         char(3) NOT NULL DEFAULT 'RUB',
  default_locale   text NOT NULL DEFAULT 'ru',
  check_in_time    time NOT NULL DEFAULT '14:00',
  check_out_time   time NOT NULL DEFAULT '12:00',
  hold_minutes     int  NOT NULL DEFAULT 20 CHECK (hold_minutes BETWEEN 5 AND 1440),
  settings         jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Переводы текстов (название категории, описание услуги) для будущих языков
CREATE TABLE translation (
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  field       text NOT NULL,
  locale      text NOT NULL,
  value       text NOT NULL,
  PRIMARY KEY (entity, entity_id, field, locale)
);

-- ───────────────────────── iam ─────────────────────────
CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES property(id),
  email          citext NOT NULL UNIQUE,
  full_name      text NOT NULL,
  phone          text,
  password_hash  text NOT NULL,               -- argon2id
  totp_secret    bytea,                       -- зашифровано приложением
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES property(id),
  code         text NOT NULL,                 -- owner, manager, front_desk, housekeeping, ...
  name         text NOT NULL,
  is_system    boolean NOT NULL DEFAULT false,
  UNIQUE (property_id, code)
);

CREATE TABLE permission (
  code         text PRIMARY KEY,              -- 'booking.read', 'guest.pii.read', 'payment.refund', ...
  description  text NOT NULL
);

CREATE TABLE role_permission (
  role_id          uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_code  text NOT NULL REFERENCES permission(code),
  limits           jsonb,                     -- например {"refund_max_minor": 1000000}
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_role (
  user_id  uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id  uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

-- ───────────────────────── inventory ─────────────────────────
CREATE TYPE unit_kind AS ENUM ('room', 'cottage', 'apartment', 'other');

CREATE TABLE accommodation_type (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES property(id),
  code          text NOT NULL,
  name          text NOT NULL,
  kind          unit_kind NOT NULL,
  area_m2       numeric(6,1),
  base_occupancy int NOT NULL CHECK (base_occupancy > 0),
  max_adults    int NOT NULL CHECK (max_adults > 0),
  max_children  int NOT NULL DEFAULT 0 CHECK (max_children >= 0),
  max_occupancy int NOT NULL CHECK (max_occupancy >= base_occupancy),
  description   text,
  amenities     text[] NOT NULL DEFAULT '{}',
  photos        jsonb NOT NULL DEFAULT '[]',  -- ключи S3 и подписи
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (property_id, code)
);

CREATE TABLE accommodation_unit (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accommodation_type_id  uuid NOT NULL REFERENCES accommodation_type(id),
  name                   text NOT NULL,       -- «Номер 5», «Коттедж»
  lock_system_ref        text,                -- номер в замковой системе
  is_active              boolean NOT NULL DEFAULT true,
  UNIQUE (accommodation_type_id, name)
);

-- Закрытие единицы на ремонт или категории на продажу
CREATE TABLE availability_block (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id                uuid REFERENCES accommodation_unit(id),
  accommodation_type_id  uuid REFERENCES accommodation_type(id),
  period                 daterange NOT NULL CHECK (NOT isempty(period)),
  reason                 text NOT NULL,       -- out_of_order | owner_use | stop_sale
  excludes_from_inventory boolean NOT NULL DEFAULT true, -- исключать из доступного фонда в RevPAR
  created_by             uuid REFERENCES app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((unit_id IS NOT NULL) <> (accommodation_type_id IS NOT NULL))
);
CREATE INDEX ON availability_block USING gist (unit_id, period);

CREATE TYPE meal_plan AS ENUM ('none', 'breakfast', 'half_board', 'full_board');

CREATE TABLE rate_plan (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         uuid NOT NULL REFERENCES property(id),
  code                text NOT NULL,
  name                text NOT NULL,
  meal_plan           meal_plan NOT NULL DEFAULT 'none',
  is_refundable       boolean NOT NULL DEFAULT true,
  cancellation_policy jsonb NOT NULL,         -- [{"days_before":7,"penalty_pct":0}, ...]
  prepayment_policy   jsonb NOT NULL,         -- {"pct":30,"due":"at_booking"}
  is_public           boolean NOT NULL DEFAULT true,  -- false: закрытый/корпоративный
  promo_only          boolean NOT NULL DEFAULT false,
  included_services   uuid[] NOT NULL DEFAULT '{}',
  is_active           boolean NOT NULL DEFAULT true,
  UNIQUE (property_id, code)
);

CREATE TABLE rate_plan_type (
  rate_plan_id           uuid NOT NULL REFERENCES rate_plan(id) ON DELETE CASCADE,
  accommodation_type_id  uuid NOT NULL REFERENCES accommodation_type(id),
  PRIMARY KEY (rate_plan_id, accommodation_type_id)
);

-- Цены и ограничения по датам. Более высокий priority перекрывает более низкий.
CREATE TABLE rate_rule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_plan_id           uuid NOT NULL REFERENCES rate_plan(id),
  accommodation_type_id  uuid NOT NULL REFERENCES accommodation_type(id),
  period                 daterange NOT NULL CHECK (NOT isempty(period)),
  weekdays               int[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}', -- ISO: 1=пн
  priority               int NOT NULL DEFAULT 0,
  price_minor            bigint CHECK (price_minor >= 0),          -- за ночь при base_occupancy
  extra_adult_minor      bigint CHECK (extra_adult_minor >= 0),
  extra_child_minor      bigint CHECK (extra_child_minor >= 0),
  min_stay               int CHECK (min_stay > 0),
  max_stay               int CHECK (max_stay > 0),
  min_lead_days          int CHECK (min_lead_days >= 0),
  closed                 boolean NOT NULL DEFAULT false,
  closed_to_arrival      boolean NOT NULL DEFAULT false,
  closed_to_departure    boolean NOT NULL DEFAULT false,
  label                  text,                 -- «Лето 2027», «Новый год»
  created_by             uuid REFERENCES app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rate_rule USING gist (accommodation_type_id, period);

CREATE TABLE price_recommendation (           -- динамические цены: только рекомендации
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accommodation_type_id  uuid NOT NULL REFERENCES accommodation_type(id),
  rate_plan_id           uuid NOT NULL REFERENCES rate_plan(id),
  night                  date NOT NULL,
  current_minor          bigint NOT NULL,
  suggested_minor        bigint NOT NULL,
  reasons                jsonb NOT NULL,
  status                 text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected','expired')),
  decided_by             uuid REFERENCES app_user(id),
  decided_at             timestamptz
);

-- ───────────────────────── guest (CRM) ─────────────────────────
CREATE TABLE guest (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES property(id),
  last_name       text NOT NULL,
  first_name      text NOT NULL,
  middle_name     text,
  phone_e164      text,
  email           citext,
  birth_date      date,
  preferences     jsonb NOT NULL DEFAULT '{}',
  tags            text[] NOT NULL DEFAULT '{}',
  merged_into_id  uuid REFERENCES guest(id),  -- при объединении дубликатов
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guest (property_id, phone_e164);
CREATE INDEX ON guest (property_id, email);
CREATE INDEX ON guest (property_id, lower(last_name));

-- Документы гостя: только для заселения, поля зашифрованы приложением
CREATE TABLE guest_document (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id      uuid NOT NULL REFERENCES guest(id),
  doc_type      text NOT NULL,                -- passport_rf, foreign_passport, birth_certificate
  payload_enc   bytea NOT NULL,               -- серия, номер, кем выдан и т.д.
  scan_key      text,                         -- ключ в закрытом бакете
  retain_until  date NOT NULL,
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guest_consent (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id      uuid NOT NULL REFERENCES guest(id),
  kind          text NOT NULL CHECK (kind IN ('pd_processing','marketing_email','marketing_sms','marketing_messenger','pd_transfer_third_party')),
  text_version  text NOT NULL,                -- версия текста согласия
  granted_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  source        text NOT NULL,                -- booking_widget, front_desk, guest_cabinet
  ip            inet
);
CREATE INDEX ON guest_consent (guest_id, kind);

CREATE TABLE guest_note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id    uuid NOT NULL REFERENCES guest(id),
  kind        text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','complaint','request')),
  body        text NOT NULL,
  author_id   uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guest_merge_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id   uuid NOT NULL REFERENCES guest(id),
  merged_id     uuid NOT NULL REFERENCES guest(id),
  snapshot      jsonb NOT NULL,               -- данные слитого профиля до объединения
  merged_by     uuid REFERENCES app_user(id),
  merged_at     timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── channels ─────────────────────────
CREATE TABLE integration (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES property(id),
  kind          text NOT NULL,                -- travelline, payment, fiscal, iiko, locks, sms, email
  provider      text NOT NULL,                -- 'travelline', 'yookassa', ...
  status        text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','test','live','error','disabled')),
  config        jsonb NOT NULL DEFAULT '{}',  -- без секретов: секреты в менеджере секретов
  secret_ref    text,                         -- имя секрета
  last_ok_at    timestamptz,
  last_error    text,
  UNIQUE (property_id, kind, provider)
);

CREATE TABLE channel (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES property(id),
  code            text NOT NULL,              -- direct_site, front_desk, phone, travelline_be, yandex_travel, ostrovok, ...
  name            text NOT NULL,
  integration_id  uuid REFERENCES integration(id),
  commission_pct  numeric(5,2),
  UNIQUE (property_id, code)
);

CREATE TABLE channel_mapping (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES channel(id),
  entity        text NOT NULL CHECK (entity IN ('accommodation_type','rate_plan','service','unit')),
  local_id      uuid NOT NULL,
  external_id   text NOT NULL,
  UNIQUE (channel_id, entity, local_id),
  UNIQUE (channel_id, entity, external_id)
);

CREATE TABLE channel_event (
  id                 bigserial PRIMARY KEY,
  channel_id         uuid NOT NULL REFERENCES channel(id),
  direction          text NOT NULL CHECK (direction IN ('inbound','outbound')),
  external_event_id  text NOT NULL,           -- id события или "номер брони:версия"
  event_type         text NOT NULL,           -- booking_created, booking_modified, booking_cancelled, ari_push
  payload            jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','done','failed','ignored_duplicate')),
  attempts           int NOT NULL DEFAULT 0,
  next_retry_at      timestamptz,
  error              text,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  UNIQUE (channel_id, direction, external_event_id)   -- повторное событие не обрабатывается
);
CREATE INDEX ON channel_event (status, next_retry_at);

-- ───────────────────────── booking ─────────────────────────
CREATE TYPE booking_status AS ENUM (
  'draft', 'pending_payment', 'pending_confirmation', 'confirmed',
  'checked_in', 'checked_out', 'cancelled', 'no_show', 'expired'
);
CREATE TYPE payment_state AS ENUM ('unpaid', 'partially_paid', 'paid', 'overpaid', 'refund_pending', 'refunded');

CREATE TABLE booking (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        uuid NOT NULL REFERENCES property(id),
  number             text NOT NULL UNIQUE,    -- QV-2027-000123
  status             booking_status NOT NULL DEFAULT 'draft',
  payment_state      payment_state NOT NULL DEFAULT 'unpaid',
  channel_id         uuid NOT NULL REFERENCES channel(id),
  external_ref       text,                    -- номер брони в TravelLine / площадке
  external_version   text,                    -- для отбрасывания устаревших изменений
  group_id           uuid,                    -- связанные брони (объединение)
  booker_guest_id    uuid NOT NULL REFERENCES guest(id),
  arrival            date NOT NULL,
  departure          date NOT NULL,
  adults             int NOT NULL CHECK (adults > 0),
  children_ages      int[] NOT NULL DEFAULT '{}',
  special_requests   text,
  total_minor        bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  prepayment_due_minor bigint NOT NULL DEFAULT 0 CHECK (prepayment_due_minor >= 0),
  prepayment_due_at  timestamptz,
  hold_expires_at    timestamptz,             -- удержание на время оплаты
  manage_token_hash  bytea UNIQUE,            -- ссылка гостя на управление бронью
  promo_code_id      uuid,
  idempotency_key    text UNIQUE,             -- повторная отправка формы не создаёт дубль
  utm                jsonb,                   -- источник перехода, без ПДн
  created_by         uuid REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (departure > arrival),
  UNIQUE (channel_id, external_ref)
);
CREATE INDEX ON booking (property_id, arrival);
CREATE INDEX ON booking (property_id, departure);
CREATE INDEX ON booking (status, hold_expires_at);

-- Размещение по физическим единицам. Ограничение исключения не даёт
-- двум активным броням занять одну единицу на пересекающиеся ночи.
CREATE TABLE booking_stay (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid NOT NULL REFERENCES booking(id),
  accommodation_type_id  uuid NOT NULL REFERENCES accommodation_type(id),
  unit_id                uuid REFERENCES accommodation_unit(id),  -- NULL: единица ещё не назначена
  rate_plan_id           uuid REFERENCES rate_plan(id),
  stay                   daterange NOT NULL CHECK (NOT isempty(stay) AND lower_inc(stay) AND NOT upper_inc(stay)),
  adults                 int NOT NULL CHECK (adults > 0),
  children               int NOT NULL DEFAULT 0 CHECK (children >= 0),
  is_active              boolean NOT NULL DEFAULT true,  -- поддерживается триггером по статусу брони
  actual_check_in        timestamptz,
  actual_check_out       timestamptz,
  EXCLUDE USING gist (unit_id WITH =, stay WITH &&) WHERE (is_active AND unit_id IS NOT NULL)
);
CREATE INDEX ON booking_stay (booking_id);
CREATE INDEX ON booking_stay USING gist (accommodation_type_id, stay) WHERE is_active;

-- Цена каждой ночи фиксируется в момент брони: изменение тарифа не меняет подтверждённые брони
CREATE TABLE booking_night_price (
  booking_stay_id  uuid NOT NULL REFERENCES booking_stay(id),
  night            date NOT NULL,
  amount_minor     bigint NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (booking_stay_id, night)
);

CREATE TABLE booking_guest (
  booking_id   uuid NOT NULL REFERENCES booking(id),
  guest_id     uuid NOT NULL REFERENCES guest(id),
  stay_id      uuid REFERENCES booking_stay(id),
  is_primary   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (booking_id, guest_id)
);

CREATE TYPE booking_item_kind AS ENUM ('accommodation', 'service', 'rental', 'food', 'fee', 'tourist_tax', 'discount', 'package');

-- Состав брони, который видит гость в итоговой цене
CREATE TABLE booking_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES booking(id),
  kind          booking_item_kind NOT NULL,
  ref_id        uuid,                         -- stay / service_booking / equipment_reservation / food_order
  title         text NOT NULL,
  quantity      numeric(10,2) NOT NULL DEFAULT 1,
  amount_minor  bigint NOT NULL,              -- скидка отрицательная
  vat_code      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON booking_item (booking_id);

CREATE TABLE booking_status_transition (
  from_status  booking_status NOT NULL,
  to_status    booking_status NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO booking_status_transition VALUES
  ('draft','pending_payment'), ('draft','pending_confirmation'), ('draft','confirmed'), ('draft','cancelled'),
  ('pending_payment','confirmed'), ('pending_payment','cancelled'), ('pending_payment','expired'),
  ('pending_confirmation','confirmed'), ('pending_confirmation','cancelled'),
  ('expired','confirmed'),                     -- поздняя оплата, если единица ещё свободна
  ('confirmed','checked_in'), ('confirmed','cancelled'), ('confirmed','no_show'),
  ('checked_in','checked_out'),
  ('no_show','confirmed');                     -- исправление ошибки администратора

CREATE TABLE booking_status_history (
  id           bigserial PRIMARY KEY,
  booking_id   uuid NOT NULL REFERENCES booking(id),
  from_status  booking_status,
  to_status    booking_status NOT NULL,
  reason       text,
  changed_by   uuid REFERENCES app_user(id),
  source       text NOT NULL DEFAULT 'app',   -- app, channel, payment_webhook, job
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION booking_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (SELECT 1 FROM booking_status_transition
                   WHERE from_status = OLD.status AND to_status = NEW.status) THEN
      RAISE EXCEPTION 'Недопустимый переход статуса брони % → %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- освобождение или повторный захват единиц
    UPDATE booking_stay SET is_active = NEW.status NOT IN ('cancelled','expired')
     WHERE booking_id = NEW.id;
    INSERT INTO booking_status_history (booking_id, from_status, to_status, reason, changed_by, source)
    VALUES (NEW.id, OLD.status, NEW.status,
            current_setting('qvarc.reason', true),
            nullif(current_setting('qvarc.user_id', true), '')::uuid,
            coalesce(nullif(current_setting('qvarc.source', true), ''), 'app'));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
-- AFTER INSERT для истории (FK), BEFORE UPDATE для проверки
CREATE FUNCTION booking_insert_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, source)
  VALUES (NEW.id, NULL, NEW.status,
          nullif(current_setting('qvarc.user_id', true), '')::uuid,
          coalesce(nullif(current_setting('qvarc.source', true), ''), 'app'));
  RETURN NULL;
END $$;
CREATE TRIGGER booking_status_guard BEFORE UPDATE ON booking
  FOR EACH ROW EXECUTE FUNCTION booking_status_guard();
CREATE TRIGGER booking_insert_history AFTER INSERT ON booking
  FOR EACH ROW EXECUTE FUNCTION booking_insert_history();

-- ───────────────────────── services, packages, promo ─────────────────────────
CREATE TABLE service (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        uuid NOT NULL REFERENCES property(id),
  category           text NOT NULL,           -- rental, water, excursion, food, room_extra, custom
  name               text NOT NULL,
  description        text,
  photos             jsonb NOT NULL DEFAULT '[]',
  pricing            text NOT NULL CHECK (pricing IN ('per_item','per_hour','per_day','per_person','per_stay')),
  price_minor        bigint NOT NULL CHECK (price_minor >= 0),
  duration_minutes   int,
  daily_capacity     int,                     -- NULL: без ограничения
  requires_slot      boolean NOT NULL DEFAULT false,
  min_age            int,
  cancellation_policy jsonb,
  responsible_role_id uuid REFERENCES role(id),
  equipment_type_id  uuid,                    -- если услуга = прокат
  is_active          boolean NOT NULL DEFAULT true
);

CREATE TABLE service_booking (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    uuid NOT NULL REFERENCES service(id),
  booking_id    uuid REFERENCES booking(id),  -- NULL: гость без проживания
  guest_id      uuid NOT NULL REFERENCES guest(id),
  period        tstzrange,
  quantity      int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_minor  bigint NOT NULL,
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','done','cancelled')),
  assignee_id   uuid REFERENCES app_user(id),
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE package (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES property(id),
  name          text NOT NULL,
  rate_plan_id  uuid REFERENCES rate_plan(id),
  description   text,
  is_active     boolean NOT NULL DEFAULT true
);
CREATE TABLE package_item (
  package_id  uuid NOT NULL REFERENCES package(id) ON DELETE CASCADE,
  service_id  uuid NOT NULL REFERENCES service(id),
  quantity    int NOT NULL DEFAULT 1,
  PRIMARY KEY (package_id, service_id)
);

CREATE TABLE promo_code (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES property(id),
  code           citext NOT NULL,
  discount_pct   numeric(5,2),
  discount_minor bigint,
  valid          daterange NOT NULL,
  stay_valid     daterange,
  max_uses       int,
  used_count     int NOT NULL DEFAULT 0,
  rate_plan_ids  uuid[] NOT NULL DEFAULT '{}',
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (property_id, code),
  CHECK ((discount_pct IS NULL) <> (discount_minor IS NULL))
);
ALTER TABLE booking ADD FOREIGN KEY (promo_code_id) REFERENCES promo_code(id);

CREATE TABLE gift_certificate (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES property(id),
  code_hash      bytea NOT NULL UNIQUE,
  initial_minor  bigint NOT NULL CHECK (initial_minor > 0),
  balance_minor  bigint NOT NULL CHECK (balance_minor >= 0),
  valid_until    date NOT NULL,
  buyer_guest_id uuid REFERENCES guest(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── rental ─────────────────────────
CREATE TABLE equipment_type (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES property(id),
  name          text NOT NULL,                -- катамаран, SUP, велосипед взрослый
  deposit_minor bigint NOT NULL DEFAULT 0,
  buffer_minutes int NOT NULL DEFAULT 0,      -- время на осмотр между выдачами
  is_active     boolean NOT NULL DEFAULT true
);
ALTER TABLE service ADD FOREIGN KEY (equipment_type_id) REFERENCES equipment_type(id);

CREATE TABLE equipment_unit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_type_id  uuid NOT NULL REFERENCES equipment_type(id),
  inventory_no       text NOT NULL UNIQUE,
  condition          text NOT NULL DEFAULT 'ok' CHECK (condition IN ('ok','needs_check','damaged','retired')),
  notes              text
);

CREATE TABLE equipment_reservation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_unit_id  uuid NOT NULL REFERENCES equipment_unit(id),
  service_booking_id uuid REFERENCES service_booking(id),
  guest_id           uuid NOT NULL REFERENCES guest(id),
  booking_id         uuid REFERENCES booking(id),
  period             tstzrange NOT NULL CHECK (NOT isempty(period)),
  status             text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','issued','returned','cancelled','no_show')),
  deposit_minor      bigint NOT NULL DEFAULT 0,
  deposit_state      text NOT NULL DEFAULT 'none' CHECK (deposit_state IN ('none','held','returned','withheld')),
  issued_at          timestamptz,
  issued_by          uuid REFERENCES app_user(id),
  returned_at        timestamptz,
  returned_by        uuid REFERENCES app_user(id),
  EXCLUDE USING gist (equipment_unit_id WITH =, period WITH &&) WHERE (status IN ('reserved','issued'))
);

CREATE TABLE equipment_condition_log (
  id                 bigserial PRIMARY KEY,
  equipment_unit_id  uuid NOT NULL REFERENCES equipment_unit(id),
  reservation_id     uuid REFERENCES equipment_reservation(id),
  condition          text NOT NULL,
  damage_note        text,
  photos             jsonb NOT NULL DEFAULT '[]',
  recorded_by        uuid REFERENCES app_user(id),
  recorded_at        timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── restaurant ─────────────────────────
CREATE TABLE restaurant_table (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES property(id),
  name         text NOT NULL,
  seats        int NOT NULL CHECK (seats > 0),
  zone         text,                          -- зал, терраса
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (property_id, name)
);

CREATE TABLE table_reservation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES property(id),
  guest_id     uuid NOT NULL REFERENCES guest(id),
  booking_id   uuid REFERENCES booking(id),
  period       tstzrange NOT NULL CHECK (NOT isempty(period)),
  party_size   int NOT NULL CHECK (party_size > 0),
  status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','seated','completed','cancelled','no_show')),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Столик(и), назначенные брони. Несколько строк = объединённые столики.
CREATE TABLE table_assignment (
  table_reservation_id  uuid NOT NULL REFERENCES table_reservation(id),
  table_id              uuid NOT NULL REFERENCES restaurant_table(id),
  period                tstzrange NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  PRIMARY KEY (table_reservation_id, table_id),
  EXCLUDE USING gist (table_id WITH =, period WITH &&) WHERE (is_active)
);

CREATE TABLE menu (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES property(id),
  name          text NOT NULL,                -- основное, завтрак, бар, детское
  available_from time,
  available_to   time,
  room_delivery  boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE menu_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id         uuid NOT NULL REFERENCES menu(id),
  section         text NOT NULL,
  name            text NOT NULL,
  description     text,
  composition     text,
  allergens       text[] NOT NULL DEFAULT '{}',
  weight_g        int,
  price_minor     bigint NOT NULL CHECK (price_minor >= 0),
  photo_key       text,
  iiko_product_id text,                       -- связь с номенклатурой iiko
  is_available    boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0
);

CREATE TABLE food_order (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES property(id),
  number          text NOT NULL UNIQUE,
  guest_id        uuid REFERENCES guest(id),
  booking_id      uuid REFERENCES booking(id),
  fulfilment      text NOT NULL CHECK (fulfilment IN ('dine_in','room_delivery','takeaway')),
  unit_id         uuid REFERENCES accommodation_unit(id),
  table_id        uuid REFERENCES restaurant_table(id),
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','cooking','ready','out_for_delivery','delivered','cancelled')),
  payment_mode    text NOT NULL CHECK (payment_mode IN ('online','on_site','charge_to_room')),
  total_minor     bigint NOT NULL CHECK (total_minor >= 0),
  comment         text,
  iiko_order_id   text,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (fulfilment <> 'room_delivery' OR unit_id IS NOT NULL),
  CHECK (payment_mode <> 'charge_to_room' OR booking_id IS NOT NULL)
);
CREATE INDEX ON food_order (property_id, status, created_at);

CREATE TABLE food_order_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  food_order_id  uuid NOT NULL REFERENCES food_order(id),
  menu_item_id   uuid NOT NULL REFERENCES menu_item(id),
  name_snapshot  text NOT NULL,
  price_minor    bigint NOT NULL,             -- цена на момент заказа
  quantity       int NOT NULL CHECK (quantity > 0),
  comment        text
);

CREATE TABLE food_order_status_history (
  id             bigserial PRIMARY KEY,
  food_order_id  uuid NOT NULL REFERENCES food_order(id),
  status         text NOT NULL,
  changed_by     uuid REFERENCES app_user(id),
  changed_at     timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── payment ─────────────────────────
-- Счёт гостя (фолио): все начисления и оплаты по проживанию
CREATE TABLE folio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES booking(id),
  payer_guest_id uuid REFERENCES guest(id),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at    timestamptz
);

CREATE TABLE folio_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id          uuid NOT NULL REFERENCES folio(id),
  kind              booking_item_kind NOT NULL,
  source_ref        uuid,                     -- food_order / service_booking / equipment_reservation
  title             text NOT NULL,
  amount_minor      bigint NOT NULL,
  reverses_line_id  uuid REFERENCES folio_line(id),  -- сторно вместо удаления
  posted_by         uuid REFERENCES app_user(id),
  posted_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE payment_status AS ENUM ('created', 'pending', 'authorized', 'succeeded', 'failed', 'cancelled');

CREATE TABLE payment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id          uuid NOT NULL REFERENCES property(id),
  booking_id           uuid REFERENCES booking(id),
  folio_id             uuid REFERENCES folio(id),
  food_order_id        uuid REFERENCES food_order(id),
  purpose              text NOT NULL CHECK (purpose IN ('prepayment','balance','services','food','deposit','gift_certificate')),
  method               text NOT NULL CHECK (method IN ('online_card','sbp','payment_link','cash','card_terminal','bank_transfer','certificate','channel_collect')),
  provider             text,                  -- NULL для наличных
  provider_payment_id  text,
  status               payment_status NOT NULL DEFAULT 'created',
  amount_minor         bigint NOT NULL CHECK (amount_minor > 0),
  currency             char(3) NOT NULL DEFAULT 'RUB',
  idempotency_key      text NOT NULL UNIQUE,
  confirmation_url     text,
  paid_at              timestamptz,
  created_by           uuid REFERENCES app_user(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX ON payment (booking_id);

CREATE TABLE payment_status_transition (
  from_status payment_status NOT NULL,
  to_status   payment_status NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO payment_status_transition VALUES
  ('created','pending'), ('created','succeeded'), ('created','failed'), ('created','cancelled'),
  ('pending','authorized'), ('pending','succeeded'), ('pending','failed'), ('pending','cancelled'),
  ('authorized','succeeded'), ('authorized','cancelled');

CREATE FUNCTION payment_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
     SELECT 1 FROM payment_status_transition WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'Недопустимый переход статуса платежа % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.amount_minor <> NEW.amount_minor AND OLD.status <> 'created' THEN
    RAISE EXCEPTION 'Сумму платежа нельзя менять после отправки провайдеру';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_status_guard BEFORE UPDATE ON payment
  FOR EACH ROW EXECUTE FUNCTION payment_status_guard();

-- Каждое уведомление провайдера сохраняется один раз
CREATE TABLE payment_event (
  id                 bigserial PRIMARY KEY,
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,
  payment_id         uuid REFERENCES payment(id),
  event_type         text NOT NULL,
  payload            jsonb NOT NULL,
  signature_valid    boolean NOT NULL,
  processed_at       timestamptz,
  received_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE refund (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          uuid NOT NULL REFERENCES payment(id),
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','pending','succeeded','failed','rejected')),
  provider_refund_id  text,
  idempotency_key     text NOT NULL UNIQUE,
  requested_by        uuid REFERENCES app_user(id),
  approved_by         uuid REFERENCES app_user(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

-- Не даём вернуть больше, чем оплачено
CREATE FUNCTION refund_amount_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid bigint; refunded bigint;
BEGIN
  SELECT amount_minor INTO paid FROM payment WHERE id = NEW.payment_id AND status = 'succeeded' FOR UPDATE;
  IF paid IS NULL THEN
    RAISE EXCEPTION 'Возврат возможен только по успешному платежу';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO refunded FROM refund
   WHERE payment_id = NEW.payment_id AND status NOT IN ('failed','rejected') AND id <> NEW.id;
  IF refunded + NEW.amount_minor > paid THEN
    RAISE EXCEPTION 'Сумма возвратов (%) превышает платёж (%)', refunded + NEW.amount_minor, paid;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_amount_guard BEFORE INSERT OR UPDATE OF amount_minor, status ON refund
  FOR EACH ROW EXECUTE FUNCTION refund_amount_guard();

CREATE TABLE fiscal_receipt (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id       uuid REFERENCES payment(id),
  refund_id        uuid REFERENCES refund(id),
  receipt_type     text NOT NULL CHECK (receipt_type IN ('prepayment','full_payment','refund','offset')),
  provider         text NOT NULL,
  provider_receipt_id text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','registered','failed')),
  fiscal_data      jsonb,                     -- ФН, ФД, ФП
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Ссылка на документы во внешней учётной системе (1С и т.п.)
CREATE TABLE invoice_reference (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id      uuid REFERENCES folio(id),
  external_system text NOT NULL,
  external_id   text NOT NULL,
  doc_type      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_system, external_id)
);

-- ───────────────────────── ops ─────────────────────────
CREATE TABLE staff_task (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES property(id),
  kind          text NOT NULL,                -- cleaning_checkout, prepare_arrival, inspect_equipment, deliver_food, issue_rental, maintenance
  title         text NOT NULL,
  unit_id       uuid REFERENCES accommodation_unit(id),
  booking_id    uuid REFERENCES booking(id),
  source_ref    uuid,
  assignee_id   uuid REFERENCES app_user(id),
  role_id       uuid REFERENCES role(id),
  priority      int NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
  due_at        timestamptz,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  comment       text,
  dedupe_key    text UNIQUE,                  -- автозадача не создаётся дважды на одно событие
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON staff_task (property_id, status, due_at);

CREATE TABLE staff_task_history (
  id          bigserial PRIMARY KEY,
  task_id     uuid NOT NULL REFERENCES staff_task(id),
  change      jsonb NOT NULL,
  changed_by  uuid REFERENCES app_user(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unit_status_log (
  id          bigserial PRIMARY KEY,
  unit_id     uuid NOT NULL REFERENCES accommodation_unit(id),
  status      text NOT NULL CHECK (status IN ('dirty','cleaning','clean','inspected','out_of_order')),
  changed_by  uuid REFERENCES app_user(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── access (замки) ─────────────────────────
CREATE TABLE lock_device (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL REFERENCES accommodation_unit(id),
  integration_id uuid NOT NULL REFERENCES integration(id),
  external_id   text NOT NULL,
  battery_pct   int,
  last_seen_at  timestamptz,
  UNIQUE (integration_id, external_id)
);

CREATE TABLE access_grant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_device_id  uuid NOT NULL REFERENCES lock_device(id),
  booking_stay_id uuid NOT NULL REFERENCES booking_stay(id),
  valid           tstzrange NOT NULL,
  external_grant_id text,                     -- сам код хранится у производителя, не в QVARC
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','failed','expired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

CREATE TABLE lock_event (
  id              bigserial PRIMARY KEY,
  lock_device_id  uuid NOT NULL REFERENCES lock_device(id),
  access_grant_id uuid REFERENCES access_grant(id),
  event_type      text NOT NULL,
  payload         jsonb,
  occurred_at     timestamptz NOT NULL
);


-- ───────────────────────── миграционный учёт ─────────────────────────
CREATE TABLE migration_notification (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_stay_id  uuid NOT NULL REFERENCES booking_stay(id),
  guest_id         uuid NOT NULL REFERENCES guest(id),
  kind             text NOT NULL CHECK (kind IN ('arrival','departure')),
  due_at           timestamptz NOT NULL,      -- срок подачи
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','accepted','rejected','failed')),
  provider         text,                      -- gosuslugi, сервис-посредник, manual
  provider_ref     text,
  submitted_by     uuid REFERENCES app_user(id),
  submitted_at     timestamptz,
  error            text,
  UNIQUE (booking_stay_id, guest_id, kind)
);

-- ───────────────────────── messaging ─────────────────────────
CREATE TABLE message_template (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES property(id),
  code         text NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('email','sms','telegram','max','whatsapp')),
  locale       text NOT NULL DEFAULT 'ru',
  is_marketing boolean NOT NULL DEFAULT false,
  subject      text,
  body         text NOT NULL,
  UNIQUE (property_id, code, channel, locale)
);

CREATE TABLE message_rule (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES property(id),
  trigger_event  text NOT NULL,               -- booking_confirmed, days_before_arrival, checked_out, ...
  offset_minutes int NOT NULL DEFAULT 0,
  template_code  text NOT NULL,
  conditions     jsonb NOT NULL DEFAULT '{}',
  cancel_if      jsonb NOT NULL DEFAULT '{}',
  max_attempts   int NOT NULL DEFAULT 3,
  is_active      boolean NOT NULL DEFAULT true
);

CREATE TABLE notification (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES property(id),
  guest_id       uuid REFERENCES guest(id),
  user_id        uuid REFERENCES app_user(id),
  booking_id     uuid REFERENCES booking(id),
  rule_id        uuid REFERENCES message_rule(id),
  channel        text NOT NULL,
  template_code  text NOT NULL,
  is_marketing   boolean NOT NULL DEFAULT false,
  scheduled_at   timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','delivered','failed','cancelled','suppressed_no_consent')),
  attempts       int NOT NULL DEFAULT 0,
  provider_msg_id text,
  error          text,
  dedupe_key     text UNIQUE,
  sent_at        timestamptz
);
CREATE INDEX ON notification (status, scheduled_at);

-- ───────────────────────── analytics ─────────────────────────
CREATE TABLE funnel_event (                    -- события воронки сайта без ПДн
  id          bigserial PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES property(id),
  session_id  text NOT NULL,                  -- случайный id браузерной сессии
  step        text NOT NULL CHECK (step IN ('page_view','search','results','select','checkout_start','payment_start','booked','abandon')),
  meta        jsonb NOT NULL DEFAULT '{}',    -- даты, категория, utm; без имени, телефона, почты
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON funnel_event (property_id, occurred_at);

-- ───────────────────────── audit ─────────────────────────
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  property_id uuid,
  actor_type  text NOT NULL CHECK (actor_type IN ('user','guest','system','channel','provider')),
  actor_id    text,
  action      text NOT NULL,                  -- booking.move, rate.update, guest.pii.view, refund.approve ...
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          inet,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (entity, entity_id);
CREATE INDEX ON audit_log (occurred_at);

-- ───────────────────────── защита от удаления ─────────────────────────
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Операция % запрещена для таблицы %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER payment_no_delete BEFORE DELETE ON payment FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER refund_no_delete BEFORE DELETE ON refund FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER folio_line_no_change BEFORE UPDATE OR DELETE ON folio_line FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER payment_event_no_delete BEFORE DELETE ON payment_event FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER status_history_no_change BEFORE UPDATE OR DELETE ON booking_status_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE FUNCTION booking_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Бронь % в статусе % удалить нельзя, только отменить', OLD.number, OLD.status;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER booking_delete_guard BEFORE DELETE ON booking FOR EACH ROW EXECUTE FUNCTION booking_delete_guard();

-- ───────────────────────── отчёты: загрузка, ADR, RevPAR ─────────────────────────
-- Доступный фонд: активные единицы × ночи минус ночи закрытия с excludes_from_inventory.
-- Проданные ночи: ночи активных броней в статусах confirmed, checked_in, checked_out, no_show.
-- Выручка номеров: сумма booking_night_price за эти ночи (без услуг, еды и туристического налога).
-- Occupancy = проданные / доступные; ADR = выручка / проданные; RevPAR = выручка / доступные.
CREATE FUNCTION room_kpis(p_property uuid, p_from date, p_to date)
RETURNS TABLE (available_nights bigint, sold_nights bigint, room_revenue_minor bigint,
               occupancy numeric, adr_minor numeric, revpar_minor numeric)
LANGUAGE sql STABLE AS $$
  WITH nights AS (
    SELECT d::date AS night FROM generate_series(p_from, p_to - 1, interval '1 day') d
  ),
  units AS (
    SELECT u.id FROM accommodation_unit u
    JOIN accommodation_type t ON t.id = u.accommodation_type_id
    WHERE t.property_id = p_property AND u.is_active
  ),
  avail AS (
    SELECT count(*) AS n FROM units u CROSS JOIN nights n
    WHERE NOT EXISTS (
      SELECT 1 FROM availability_block b
      WHERE b.excludes_from_inventory AND b.period @> n.night
        AND (b.unit_id = u.id OR b.accommodation_type_id =
             (SELECT accommodation_type_id FROM accommodation_unit WHERE id = u.id)))
  ),
  sold AS (
    SELECT count(*) AS n, coalesce(sum(np.amount_minor), 0) AS rev
    FROM booking_night_price np
    JOIN booking_stay s ON s.id = np.booking_stay_id
    JOIN booking b ON b.id = s.booking_id
    WHERE b.property_id = p_property AND s.is_active
      AND b.status IN ('confirmed','checked_in','checked_out','no_show')
      AND np.night >= p_from AND np.night < p_to
  )
  SELECT a.n, s.n, s.rev,
         round(s.n::numeric / nullif(a.n, 0), 4),
         round(s.rev::numeric / nullif(s.n, 0), 2),
         round(s.rev::numeric / nullif(a.n, 0), 2)
  FROM avail a, sold s
$$;
