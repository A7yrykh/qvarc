-- Зачёт сезонного депозита гостя в оплату новой брони
ALTER TABLE payment DROP CONSTRAINT payment_method_check;
ALTER TABLE payment ADD CONSTRAINT payment_method_check
  CHECK (method IN ('online_card','sbp','payment_link','cash','card_terminal','bank_transfer','certificate','channel_collect','guest_deposit'));

CREATE TABLE guest_deposit_use (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id  uuid NOT NULL REFERENCES guest_deposit(id),
  payment_id  uuid NOT NULL UNIQUE REFERENCES payment(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guest_deposit_use (deposit_id);
