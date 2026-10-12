# QVARC

Собственная система бронирования и управления «Места отдыха Кварц». Архитектура и план — в папке проекта `qvarc/` (документы 04–06).

## Что готово (этап 1, ядро)

- Вход сотрудников: пароли argon2id, серверные сессии, CSRF-защита, ограничение попыток входа.
- 12 системных ролей из ТЗ с правами; доступ к контактам гостя только у ролей с правом `guest.contacts.read`.
- Категории и номера, тарифы с условиями отмены и предоплаты, «Цены и ограничения» (цена, доплаты за взрослых и детей, мин./макс. срок, срок до заезда, закрытие продаж, заезда и выезда) по периодам, дням недели и приоритетам — по образцу TravelLine.
- Закрытие номеров и категорий (ремонт, личное использование, стоп-продажа).
- Поиск свободных вариантов с итоговой ценой, расчёт цены и предоплаты.
- Брони: создание с автоматическим выбором номера, ключ идемпотентности, перенос в другой номер, изменение дат (продление и сокращение) с сохранением подтверждённых цен, смена статуса по допустимым переходам.
- Шахматка: номера, брони, закрытия, долг по каждой брони.
- Карточка гостя с историей, поиск.
- Журнал аудита всех изменений и отказов в доступе, запрет удаления подтверждённых броней и изменения журнала на уровне базы.

Двойная бронь одного номера невозможна: это гарантирует ограничение исключения PostgreSQL, проверено тестом с 10 одновременными бронями.

## Запуск

```bash
npm ci
docker compose up -d                 # или свой PostgreSQL 16
cp .env.example .env && set -a && . ./.env && set +a
npm run db:migrate
QVARC_LEGAL_NAME="ИП ..." QVARC_PROPERTY_NAME="Место отдыха Кварц" \
QVARC_OWNER_EMAIL=... QVARC_OWNER_NAME=... QVARC_OWNER_PASSWORD=... \
  npx tsx apps/api/src/cli/bootstrap.ts
npm run build && npm run start:api
```

## Админка (apps/admin)

Next.js 15. Экраны: шахматка, брони, карта брони, новая бронь, гости, «Цены и ограничения», номера, тарифы. Обращается к API по `/admin/v1/*` (переменная `API_URL`, по умолчанию http://localhost:3000).

```
cd apps/admin && npm install
npm run build && npx next start -p 3100
```

## Приложение гостя для iPhone (apps/ios)

SwiftUI, iOS 17+, Xcode 16. Откройте `apps/ios/Kvarc.xcodeproj`. Без адреса сервера приложение работает в демо-режиме. Подробности — в `apps/ios/README.md`.

Сервер приложения — этот же API, адреса `/guest/v1/...` (`apps/api/src/guest`). Гость входит по коду из SMS и видит брони, где телефон бронирующего совпадает с его номером. Онлайн-регистрация: состав гостей, паспортные данные, правила проживания и согласие на обработку ПДн.

| Переменная | Что делает |
|---|---|
| `GUEST_DATA_KEY` | 32 байта в base64 (`openssl rand -base64 32`). Шифрует паспортные данные и подписывает SMS-коды. Без ключа вход в приложение отвечает «не настроено», остальной API работает как раньше. Ключ нельзя терять: без него сохранённые паспорта не расшифровать. |
| `GUEST_PROPERTY_CODE` | Объект приложения, по умолчанию `qvarc-uvildy` |
| `SMS_PROVIDER` | `test`: SMS не уходит, код пишется в журнал сервера (по умолчанию вне рабочей среды). `none`: вход выключен (по умолчанию в рабочей среде, пока не подключён SMS-сервис). |

Паспортные данные: шифрование AES-256-GCM, гостю показываются только последние 4 цифры, сотруднику — с правом `guest.documents.read`, каждый просмотр пишется в журнал. Удаляются через 30 дней после выезда (`property.settings.guestApp.documentsRetentionDays`). Там же настраиваются `registrationOpensDaysBefore` (7), `documentsRequired` (да) и `paymentRequiredBeforeAccess` (да).

Тексты для приложения: `data/kvarc-guest-info.json` (о базе, контакты, ответы на вопросы) и `data/legal-documents.json` (правила проживания; новая версия правил требует принять их заново).

## Модуль бронирования для сайта (apps/booking)

Next.js 15, порт 3200. Поиск по датам и гостям, выбор категории и тарифа, оформление с согласием на обработку ПДн, переход к оплате, страница брони гостя `/b/<ссылка>` (статус, доплата, отмена по условиям тарифа с автоматическим возвратом).

Ссылка с сайта может сразу открыть поиск: `/?arrival=2027-07-01&departure=2027-07-03&adults=2&children=5,10`.
Встраивание во фрейм разрешено только для кварц.рус (переменная `FRAME_ANCESTORS`). Изменения на самом сайте согласуются с владельцем отдельно.

Переменные: `API_URL`, `NEXT_PUBLIC_PROPERTY_CODE`, `NEXT_PUBLIC_PRIVACY_URL` (политика ПДн), `NEXT_PUBLIC_OFFER_URL` (условия бронирования).

### Оплата

Эквайер подключается через интерфейс `apps/api/src/payments/provider.ts`. Сейчас работает тестовый провайдер `sandbox`: страница оплаты без списания денег, подписанные уведомления, возвраты. В рабочей среде он запрещён. Настоящий банк добавляется отдельным классом после выбора эквайера; ключи только в переменных окружения.

- Бронь с предоплатой удерживает номер `hold_minutes` минут (по умолчанию 20), фоновая задача снимает просроченные удержания.
- Статус платежа из уведомления перепроверяется запросом к эквайеру; повтор уведомления ничего не меняет.
- Оплата, пришедшая после снятия удержания, восстанавливает бронь, если номер свободен, иначе деньги возвращаются автоматически.
- Чеки 54-ФЗ: предоплата («предоплата» или «предоплата 100%») и возврат.

## Номера с сайта

`data/kvarc-rooms.json` — категории, описания, удобства и фото с кварц.рус (собрано 12.10.2026), время заезда и выезда и основной тариф «Проживание с завтраком» (отмена за сутки бесплатно, позже — стоимость первой ночи). Фото лежат в `apps/booking/public/rooms/`.

```bash
DATABASE_URL=... npx tsx apps/api/src/cli/import-rooms.ts qvarc-uvildy data/kvarc-rooms.json
```

Повторный запуск обновляет категории по коду и добавляет недостающие номера, ничего не удаляя. Цен на сайте нет: их задают в админке, в «Ценах и ограничениях».

## Оплата через Сбербанк

`PAYMENT_PROVIDER=sber` включает интернет-эквайринг Сбербанка (`apps/api/src/payments/sber.provider.ts`), одностадийная оплата:

- бронь → `register.do` (номер заказа в банке = id платежа QVARC, сумма в копейках) → гость платит на странице банка → возвращается на страницу брони;
- банк присылает уведомление на `/public/v1/payments/webhook` (GET или POST). Если задан `SBER_CALLBACK_SECRET`, проверяется контрольная сумма, но статус в любом случае берётся запросом `getOrderStatusExtended.do`;
- возвраты (отмена гостем, кнопка «Вернуть» в админке, поздняя оплата без свободного номера) идут через `refund.do`;
- неоплаченный заказ закрывается `decline.do`, иначе истекает сам через `SBER_SESSION_TIMEOUT_SECS`.

Чеки 54-ФЗ через Сбер не передаются: они пойдут через отдельную онлайн-кассу. Настройки — в `.env.example`.

Перед запуском на настоящих деньгах: получить в Сбере тестовый доступ (ecomtest), пройти с ним бронь, оплату, отмену и возврат, затем сменить адрес и логин на рабочие.

## Тесты

```bash
npm run typecheck
DATABASE_URL_TEST=... npm test        # тесты пересоздают схему тестовой базы
```

## Структура

```
apps/api/src/        NestJS API: iam, inventory, guests, bookings, common, cli
packages/domain/src/ расчёт цены, ограничения тарифов, условия отмены и предоплаты (без базы)
packages/db/         SQL-миграции, мигратор, типы Kysely (npm run db:types)
tests/               интеграционные тесты на настоящем PostgreSQL
```

## API (этап 1)

| Метод | Путь | Право |
|---|---|---|
| POST | /admin/v1/auth/login, /logout; GET /me | — |
| GET/POST | /admin/v1/users | users.manage |
| GET/POST/PUT | /admin/v1/accommodation-types, /units | inventory.read / inventory.write |
| POST | /admin/v1/availability-blocks | inventory.write |
| GET/POST | /admin/v1/rate-plans | rates.read / rates.write |
| GET/POST/DELETE | /admin/v1/rate-rules | rates.read / rates.write |
| GET | /admin/v1/availability?arrival&departure&adults&children | booking.read |
| POST | /admin/v1/quotes | booking.read |
| GET | /admin/v1/calendar?from&to | calendar.read |
| GET/POST | /admin/v1/bookings | booking.read / booking.write |
| GET | /admin/v1/bookings/:id | booking.read |
| PATCH | /admin/v1/bookings/:id/unit, /dates | booking.write |
| POST | /admin/v1/bookings/:id/status | booking.status |
| GET/POST/PUT | /admin/v1/guests | guest.read / guest.write |
| GET | /admin/v1/bookings/:id/checkin | booking.read |
| GET | /admin/v1/bookings/:id/guest-documents | booking.read + guest.documents.read |
| POST | /admin/v1/bookings/:id/checkin/approve, /checkin/unit-ready | booking.status |

Приложение гостя (вход по токену `Authorization: Bearer`):

| Метод | Путь | |
|---|---|---|
| POST | /guest/v1/auth/otp/request, /otp/verify, /refresh, /logout | без входа |
| GET | /guest/v1/property, /documents, /documents/:code | без входа |
| GET | /guest/v1/bookings/my, /bookings/:id | гость |
| GET, POST | /guest/v1/checkin/:id, /checkin/:id/start, /checkin/:id/rules | гость |
| PUT | /guest/v1/checkin/:id/guests, /checkin/:id/documents | гость |

Все суммы в копейках, даты в формате ГГГГ-ММ-ДД, выезд не включается в ночи.
