-- Цены соседей и автоматическая цена «на X% дешевле соседей, но не ниже минимума»

-- Соседняя база отдыха и откуда берутся её цены
CREATE TABLE competitor (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES property(id),
  name           text NOT NULL,
  site_url       text,
  -- manual: цены вносятся вручную; page: цены «от … за ночь» со страницы номеров на сайте соседа
  source_kind    text NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('manual','page')),
  source_ref     text,                 -- для page: адрес страницы с ценами
  is_active      boolean NOT NULL DEFAULT true,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

-- Какая категория соседа соответствует нашей. Коэффициент выравнивает разницу (их дом больше — 0.8)
CREATE TABLE competitor_category (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id          uuid NOT NULL REFERENCES competitor(id) ON DELETE CASCADE,
  external_ref           text NOT NULL,   -- код или название категории у соседа
  name                   text NOT NULL,
  accommodation_type_id  uuid REFERENCES accommodation_type(id),
  factor                 numeric(5,3) NOT NULL DEFAULT 1 CHECK (factor > 0 AND factor <= 5),
  UNIQUE (competitor_id, external_ref)
);

-- Наблюдённая цена: за одну ночь при заезде в эту дату, за base_occupancy гостей. Одна запись на день сбора.
CREATE TABLE competitor_price (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id       uuid NOT NULL REFERENCES competitor(id) ON DELETE CASCADE,
  external_ref        text NOT NULL,
  night               date NOT NULL,
  price_minor         bigint CHECK (price_minor >= 0),   -- NULL: мест нет
  available           boolean NOT NULL DEFAULT true,
  collected_on        date NOT NULL,
  collected_at        timestamptz NOT NULL DEFAULT now(),
  source              text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  UNIQUE (competitor_id, external_ref, night, collected_on)
);
CREATE INDEX ON competitor_price (competitor_id, night, collected_at DESC);

-- Журнал сбора цен
CREATE TABLE competitor_fetch_run (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id   uuid NOT NULL REFERENCES competitor(id) ON DELETE CASCADE,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  prices          int NOT NULL DEFAULT 0,
  error           text
);
CREATE INDEX ON competitor_fetch_run (competitor_id, started_at DESC);

-- Настройки автоцены объекта. По умолчанию цены только предлагаются, сами не меняются.
CREATE TABLE pricing_settings (
  property_id          uuid PRIMARY KEY REFERENCES property(id),
  auto_apply           boolean NOT NULL DEFAULT false,
  rate_plan_id         uuid REFERENCES rate_plan(id),       -- тариф, цены которого считаются
  min_discount_pct     numeric(5,2) NOT NULL DEFAULT 20 CHECK (min_discount_pct >= 0 AND min_discount_pct < 90),
  max_discount_pct     numeric(5,2) NOT NULL DEFAULT 30 CHECK (max_discount_pct >= 0 AND max_discount_pct < 90),
  reference            text NOT NULL DEFAULT 'min' CHECK (reference IN ('min','avg')),
  horizon_days         int NOT NULL DEFAULT 90 CHECK (horizon_days BETWEEN 1 AND 365),
  occupancy_low_pct    int NOT NULL DEFAULT 30 CHECK (occupancy_low_pct BETWEEN 0 AND 100),
  occupancy_high_pct   int NOT NULL DEFAULT 80 CHECK (occupancy_high_pct BETWEEN 0 AND 100),
  last_minute_days     int NOT NULL DEFAULT 3 CHECK (last_minute_days >= 0),
  collect_every_hours  int NOT NULL DEFAULT 12 CHECK (collect_every_hours BETWEEN 1 AND 168),
  round_to_minor       bigint NOT NULL DEFAULT 10000 CHECK (round_to_minor > 0),
  -- Ажиотаж: столько новых броней на ночь за последние surge_window_hours часов поднимает цену на surge_markup_pct
  surge_window_hours   int NOT NULL DEFAULT 48 CHECK (surge_window_hours BETWEEN 1 AND 720),
  surge_min_bookings   int NOT NULL DEFAULT 2 CHECK (surge_min_bookings >= 1),
  surge_markup_pct     numeric(5,2) NOT NULL DEFAULT 10 CHECK (surge_markup_pct >= 0 AND surge_markup_pct <= 100),
  last_run_at          timestamptz,
  last_recompute_at    timestamptz,
  updated_by           uuid REFERENCES app_user(id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (min_discount_pct <= max_discount_pct),
  CHECK (occupancy_low_pct < occupancy_high_pct)
);

-- Минимальная цена ночи по категории и датам. Без минимума цена не предлагается.
CREATE TABLE pricing_floor (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id            uuid NOT NULL REFERENCES property(id),
  accommodation_type_id  uuid NOT NULL REFERENCES accommodation_type(id),
  period                 daterange NOT NULL CHECK (NOT isempty(period)),
  min_price_minor        bigint NOT NULL CHECK (min_price_minor > 0),
  label                  text,
  created_by             uuid REFERENCES app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pricing_floor USING gist (accommodation_type_id, period);

-- Предложения цен: откуда взялась цена и что с ней сделали
ALTER TABLE price_recommendation
  ADD COLUMN property_id      uuid REFERENCES property(id),
  ADD COLUMN created_at       timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN applied_auto     boolean NOT NULL DEFAULT false,
  ADD COLUMN rate_rule_id     uuid;
CREATE INDEX ON price_recommendation (property_id, status, night);

-- Цена, выставленная автоматически или по принятому предложению, — отдельное правило на одну ночь
ALTER TABLE rate_rule ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto_pricing'));
CREATE INDEX ON rate_rule (rate_plan_id, accommodation_type_id) WHERE source = 'auto_pricing';
