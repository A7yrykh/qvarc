-- Приложение гостя (apps/ios): вход по SMS-коду, онлайн-заселение, паспортные данные.

-- Время заезда и выезда как на сайте базы: заезд после 17:00, выезд до 14:00.
-- Объекты, где время уже поменяли вручную, не трогаем.
ALTER TABLE property ALTER COLUMN check_in_time SET DEFAULT '17:00', ALTER COLUMN check_out_time SET DEFAULT '14:00';
UPDATE property SET check_in_time = '17:00', check_out_time = '14:00'
 WHERE check_in_time = '14:00' AND check_out_time = '12:00';

-- Учётная запись гостя в приложении — это подтверждённый номер телефона.
-- Брони гостя: те, где телефон бронирующего совпадает с этим номером.
CREATE TABLE guest_account (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES property(id),
  phone_e164    text NOT NULL,
  verified_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, phone_e164)
);

-- Одноразовые коды из SMS. Хранится только HMAC кода.
CREATE TABLE guest_otp (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES property(id),
  phone_e164    text NOT NULL,
  code_hash     bytea NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  request_ip    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guest_otp (property_id, phone_e164, created_at);

-- Сессии приложения: короткий токен доступа и долгий токен обновления, оба хранятся хешами.
CREATE TABLE guest_session (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES guest_account(id) ON DELETE CASCADE,
  access_hash        bytea NOT NULL UNIQUE,
  access_expires_at  timestamptz NOT NULL,
  refresh_hash       bytea NOT NULL UNIQUE,
  expires_at         timestamptz NOT NULL,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz
);
CREATE INDEX ON guest_session (account_id);

-- Онлайн-регистрация по брони: какие шаги гость прошёл
CREATE TABLE checkin_record (
  booking_id               uuid PRIMARY KEY REFERENCES booking(id),
  started_at               timestamptz NOT NULL DEFAULT now(),
  guests_submitted_at      timestamptz,
  documents_submitted_at   timestamptz,
  rules_accepted_at        timestamptz,
  rules_version            text,
  consent_at               timestamptz,
  admin_approval_required  boolean NOT NULL DEFAULT false,
  admin_approval_reason    text,
  admin_approved_at        timestamptz,
  admin_approved_by        uuid REFERENCES app_user(id),
  completed_at             timestamptz,
  unit_ready_at            timestamptz,
  unit_ready_by            uuid REFERENCES app_user(id)
);

-- Состав гостей брони, который вводит гость
ALTER TABLE booking_guest
  ADD COLUMN is_child  boolean NOT NULL DEFAULT false,
  ADD COLUMN position  int NOT NULL DEFAULT 0;

-- Документ привязан к брони, чтобы его можно было заменить или удалить вместе с заселением.
-- Гостю показываются только последние 4 символа номера.
ALTER TABLE guest_document
  ADD COLUMN booking_id    uuid REFERENCES booking(id),
  ADD COLUMN number_last4  text;
CREATE INDEX ON guest_document (booking_id);
CREATE INDEX ON guest_document (retain_until);

ALTER TABLE guest_consent DROP CONSTRAINT guest_consent_kind_check;
ALTER TABLE guest_consent ADD CONSTRAINT guest_consent_kind_check
  CHECK (kind IN ('pd_processing','marketing_email','marketing_sms','marketing_messenger','pd_transfer_third_party','stay_rules'));

INSERT INTO permission (code, description) VALUES
  ('guest.documents.read', 'Паспортные данные гостей (каждый просмотр в журнале)');

-- Владелец, системный администратор и управляющий получают все права, в том числе новое
INSERT INTO role_permission (role_id, permission_code)
SELECT id, 'guest.documents.read' FROM role WHERE is_system AND code IN ('owner', 'sysadmin', 'manager')
ON CONFLICT DO NOTHING;
