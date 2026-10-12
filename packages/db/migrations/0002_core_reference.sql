-- Номер брони и справочник прав доступа

CREATE SEQUENCE booking_number_seq;

INSERT INTO permission (code, description) VALUES
  ('inventory.read',       'Просмотр номеров и категорий'),
  ('inventory.write',      'Изменение номеров, категорий и закрытий'),
  ('rates.read',           'Просмотр тарифов и цен'),
  ('rates.write',          'Изменение тарифов и цен'),
  ('calendar.read',        'Шахматка: номера, даты, статусы'),
  ('booking.read',         'Просмотр броней'),
  ('booking.write',        'Создание и изменение броней'),
  ('booking.status',       'Смена статуса брони: заселение, выезд, отмена'),
  ('guest.read',           'Карточки гостей без контактов'),
  ('guest.contacts.read',  'Телефон и почта гостя'),
  ('guest.write',          'Создание и изменение гостей'),
  ('payment.read',         'Просмотр оплат и долгов'),
  ('payment.refund',       'Возвраты'),
  ('reports.read',         'Отчёты'),
  ('audit.read',           'Журнал аудита'),
  ('users.manage',         'Сотрудники и роли');
