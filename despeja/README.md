# Despeja — limpiar fotos (iOS)

Очиститель медиатеки: дубликаты, серии похожих фото, снимки экрана, большие видео. Всё на устройстве,
без сети и сбора данных. SwiftUI, iOS 17+, разработчик AVSyrykh SL (команда V5JHT7CV4X).

- Bundle ID: `es.avsyrykh.despeja`
- Подписки (группа «Despeja Pro»): `es.avsyrykh.despeja.pro.weekly` 4,99 €/нед,
  `es.avsyrykh.despeja.pro.yearly` 29,99 €/год с 3 днями бесплатно.
- Бесплатно: анализ галереи и до 20 удалений в день (`CleanerKit/DailyQuota.swift`).

## Структура

- `CleanerKit/` — ядро без PhotoKit: dHash, группировка дубликатов и серий, лимит. `swift test` на Mac.
- `Despeja/App` — PhotoKit (`LibraryScanner`, `LibraryStore`), StoreKit 2 (`PurchaseManager`), демо-данные.
- `Despeja/Views` — экраны. Строки: `Localizable.xcstrings` (es, en, ru, uk) генерирует `tools/make_strings.py`.
- `Supporting/Products.storekit` — тестовые подписки для симулятора (подключены в общей схеме).
- `appstore/` — тексты карточки, политика, скриншоты.

## Снимки экрана

Аргументы запуска: `-demoData` (примерная медиатека), `-demoScreen paywall` (сразу экран Pro).

## Сборка и отправка

На Mac: `~/Developer/appstore-automation/release.sh despeja --version 1.0`.
