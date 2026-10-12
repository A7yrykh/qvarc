#!/usr/bin/env bash
# Первичная загрузка на новом сервере: объект и владелец, номера и тарифы, сведения для приложения,
# затем цены и брони из выгрузок TravelLine, если они лежат в deploy/import:
#   deploy/import/rate_plans.xlsx — шахматка тарифов, deploy/import/bookings.xlsx — отчёт по бронированиям.
# Повторный запуск безопасен: объект не создаётся второй раз, перенесённые брони пропускаются, правила TravelLine заменяются.
set -euo pipefail
cd "$(dirname "$0")"
run() { docker compose run --rm -T api "$@"; }

docker compose build
docker compose up -d db
run npm run -s db:migrate
if run node -e "
  const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => c.query(\"select 1 from property where code = 'kvarc'\")).then((r) => process.exit(r.rowCount ? 0 : 1));
"; then
  echo 'Объект kvarc уже создан'
else
  run env QVARC_PROPERTY_CODE=kvarc npx tsx apps/api/src/cli/bootstrap.ts
fi
run npx tsx apps/api/src/cli/import-rooms.ts kvarc data/kvarc-rooms.json
run npx tsx apps/api/src/cli/import-guest-app.ts kvarc data/kvarc-guest-app.json
if [ -f import/rate_plans.xlsx ]; then run npx tsx apps/api/src/cli/import-travelline-rates.ts kvarc /import/rate_plans.xlsx; fi
if [ -f import/bookings.xlsx ]; then run npx tsx apps/api/src/cli/import-travelline.ts kvarc /import/bookings.xlsx; fi
docker compose up -d
docker compose ps
