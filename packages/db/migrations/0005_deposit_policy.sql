-- Сезонный депозит по договору-оферте: при поздней отмене в сезон оплата остаётся на депозите гостя.
ALTER TABLE rate_plan ADD COLUMN deposit_policy jsonb; -- {"days_before":14,"seasons":[{"name":"…","from":"06-01","to":"08-31"}]}

CREATE TABLE guest_deposit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       uuid NOT NULL REFERENCES property(id),
  guest_id          uuid NOT NULL REFERENCES guest(id),
  source_booking_id uuid NOT NULL UNIQUE REFERENCES booking(id),
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0),
  balance_minor     bigint NOT NULL CHECK (balance_minor >= 0 AND balance_minor <= amount_minor),
  season            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_deposit_guest_idx ON guest_deposit (guest_id);
