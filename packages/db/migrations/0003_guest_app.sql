-- Гостевое приложение: вход по коду из SMS, сессии приложения, документы объекта

-- Учётная запись гостя в приложении — это номер телефона. Брони находятся по нему.
CREATE TABLE guest_account (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES property(id),
  phone_e164   text NOT NULL CHECK (phone_e164 ~ '^\+7\d{10}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (property_id, phone_e164)
);

-- Одноразовые коды. Хранится только хэш кода.
CREATE TABLE guest_otp (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES property(id),
  phone_e164   text NOT NULL,
  code_hash    bytea NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guest_otp (property_id, phone_e164, created_at DESC);

-- Сессия приложения: короткий токен доступа и долгий токен обновления, оба только хэшами.
-- При обновлении выдаётся новая пара, старая перестаёт действовать.
CREATE TABLE guest_app_session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES guest_account(id),
  access_hash         bytea NOT NULL UNIQUE,
  access_expires_at   timestamptz NOT NULL,
  refresh_hash        bytea NOT NULL UNIQUE,
  refresh_expires_at  timestamptz NOT NULL,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guest_app_session (account_id);

-- Документы объекта для гостей (правила проживания, политика, оферта), по разделам
CREATE TABLE legal_document (
  property_id  uuid NOT NULL REFERENCES property(id),
  code         text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_-]{1,40}$'),
  title        text NOT NULL,
  version      text NOT NULL,
  issuer       text NOT NULL,
  sections     jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, code)
);
