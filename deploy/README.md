# Рабочий сервер QVARC

Один облачный сервер (Timeweb Cloud, Ubuntu 24.04, 2 ядра, 4 ГБ, от 40 ГБ диска, дата-центр в РФ) с Docker.
На нём: PostgreSQL 16, API, админка, модуль бронирования и Caddy, который сам получает HTTPS-сертификаты.
База каждую ночь в 03:00 копируется в `deploy/backups` (14 дней).

| Адрес | Что там |
|---|---|
| `ADMIN_HOST` (admin.кварц.рус) | админка |
| `BOOKING_HOST` (book.кварц.рус) | модуль бронирования |
| `API_HOST` (api.кварц.рус) | гостевое приложение и уведомления банка |

## Установка

1. В DNS кварц.рус три записи A (admin, book, api) на IP сервера. Без них Caddy не получит сертификаты.
2. На сервере:
   ```sh
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/A7yrykh/qvarc.git && cd qvarc/deploy
   cp .env.example .env && nano .env      # пароли и ключи только здесь
   mkdir -p import                        # выгрузки TravelLine: rate_plans.xlsx и bookings.xlsx
   ./setup.sh
   ```
3. Войти в админку почтой и паролем владельца из `.env`.

`setup.sh` можно запускать повторно: объект второй раз не создаётся, брони TravelLine без дублей, цены TravelLine заменяются.

## Обновление

```sh
cd qvarc && git pull && cd deploy && docker compose build && docker compose up -d
```
Миграции базы применяются при запуске API.

## Восстановление из копии

```sh
docker compose stop api admin booking
docker compose exec -T db pg_restore -U qvarc -d qvarc --clean --if-exists < backups/qvarc-ГГГГ-ММ-ДД.dump
docker compose up -d
```

Копии лежат на том же сервере. Чтобы пережить потерю сервера, их нужно дополнительно забирать наружу (например, в S3 Timeweb).
