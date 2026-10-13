-- Перенос броней из TravelLine: оплата «при заселении», способ которой в выгрузке не указан
ALTER TABLE payment DROP CONSTRAINT payment_method_check;
ALTER TABLE payment ADD CONSTRAINT payment_method_check
  CHECK (method IN ('online_card','sbp','payment_link','cash','card_terminal','bank_transfer','certificate','channel_collect','guest_deposit','on_site'));
