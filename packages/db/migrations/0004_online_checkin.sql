-- Онлайн-регистрация из приложения: состав гостей, документы, принятие правил

ALTER TABLE booking_guest
  ADD COLUMN is_child   boolean NOT NULL DEFAULT false,
  ADD COLUMN sort_order int NOT NULL DEFAULT 0;

-- Для показа гостю и сотрудникам без расшифровки: «•••• 1234»
ALTER TABLE guest_document ADD COLUMN number_masked text;
CREATE INDEX ON guest_document (guest_id, created_at DESC);

CREATE TABLE booking_checkin (
  booking_id            uuid PRIMARY KEY REFERENCES booking(id),
  guests_submitted_at   timestamptz,
  rules_version         text,
  rules_accepted_at     timestamptz,
  pd_consent_at         timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
