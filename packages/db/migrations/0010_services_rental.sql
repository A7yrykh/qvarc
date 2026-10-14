-- Доп. услуги и прокат: каталог, запись на время, оборудование, выдача и возврат.
-- Услуга с типом оборудования бронируется на время: ресурсы — исправные единицы этого типа.
-- Услуга без оборудования оформляется заявкой: администратор подтверждает её сам.
-- Стоимость услуги добавляется в бронь проживания строкой и оплачивается вместе с остатком.

ALTER TABLE service
  ADD COLUMN rules                  text,
  ADD COLUMN cancellation_text      text,
  ADD COLUMN open_time              time NOT NULL DEFAULT '09:00',
  ADD COLUMN close_time             time NOT NULL DEFAULT '21:00' CHECK (close_time > open_time),
  ADD COLUMN slot_step_minutes      int NOT NULL DEFAULT 60 CHECK (slot_step_minutes BETWEEN 5 AND 720),
  ADD COLUMN max_quantity           int NOT NULL DEFAULT 1 CHECK (max_quantity BETWEEN 1 AND 100),
  ADD COLUMN requires_confirmation  boolean NOT NULL DEFAULT false,
  ADD COLUMN sort_order             int NOT NULL DEFAULT 0,
  ADD COLUMN bookable_online        boolean NOT NULL DEFAULT true,  -- видна гостю в приложении и на сайте
  ADD COLUMN created_at             timestamptz NOT NULL DEFAULT now();
ALTER TABLE service ADD CONSTRAINT service_category_check
  CHECK (category IN ('rental','water','excursion','food','room_extra','custom'));
ALTER TABLE service ADD CONSTRAINT service_duration_check
  CHECK (equipment_type_id IS NULL OR duration_minutes BETWEEN 5 AND 1440);

ALTER TABLE equipment_type ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE service_booking DROP CONSTRAINT service_booking_status_check;
ALTER TABLE service_booking ADD CONSTRAINT service_booking_status_check
  CHECK (status IN ('requested','confirmed','in_use','done','cancelled'));
ALTER TABLE service_booking
  ADD COLUMN property_id      uuid REFERENCES property(id),
  ADD COLUMN booking_item_id  uuid REFERENCES booking_item(id),
  ADD COLUMN source           text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin','guest_app','booking_site')),
  ADD COLUMN idempotency_key  text UNIQUE,
  ADD COLUMN cancelled_at     timestamptz,
  ADD COLUMN created_by       uuid REFERENCES app_user(id);
CREATE INDEX ON service_booking (booking_id);
CREATE INDEX ON service_booking (property_id, created_at);
CREATE INDEX ON service_booking USING gist (period);
CREATE INDEX ON equipment_reservation (service_booking_id);

INSERT INTO permission (code, description) VALUES
  ('rental.read',   'Услуги и прокат: расписание и брони'),
  ('rental.manage', 'Услуги и прокат: каталог, оборудование, выдача и возврат')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code FROM role r CROSS JOIN (VALUES ('rental.read'), ('rental.manage')) p(code)
 WHERE r.is_system AND r.code IN ('owner', 'sysadmin', 'manager', 'rental', 'front_desk', 'reservations')
ON CONFLICT DO NOTHING;

-- Бронь проживания отменена, истекла или гость не заехал: несостоявшиеся услуги отменяются, оборудование освобождается.
-- Строки услуг остаются в брони для истории; удержание при отмене считается только по проживанию.
CREATE FUNCTION service_booking_follow_stay() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'expired', 'no_show') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE service_booking SET status = 'cancelled', cancelled_at = now()
     WHERE booking_id = NEW.id AND status IN ('requested', 'confirmed');
    UPDATE equipment_reservation SET status = 'cancelled'
     WHERE booking_id = NEW.id AND status = 'reserved';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_cancels_services AFTER UPDATE OF status ON booking
  FOR EACH ROW EXECUTE FUNCTION service_booking_follow_stay();
