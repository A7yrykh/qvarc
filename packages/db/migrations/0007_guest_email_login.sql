-- Вход гостя в приложение по коду на e-mail вместо SMS (решение владельца 12.10.2026).
-- Телефон в учётной записи больше не обязателен; брони гостя находятся по e-mail.
ALTER TABLE guest_account ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE guest_account ADD COLUMN email citext;
ALTER TABLE guest_account ADD CONSTRAINT guest_account_email_key UNIQUE (property_id, email);
ALTER TABLE guest_account ADD CONSTRAINT guest_account_login_check CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL);

ALTER TABLE guest_otp ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE guest_otp ADD COLUMN email citext;
ALTER TABLE guest_otp ADD CONSTRAINT guest_otp_target_check CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL);
CREATE INDEX ON guest_otp (property_id, email, created_at DESC);
