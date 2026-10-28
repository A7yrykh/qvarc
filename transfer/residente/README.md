# Residente — NIE, TIE y 183 días

Объединение Trámites España и «90/180 Schengen & Tax Days» (28.10.2026, после отклонения 4.3(a)).
Bundle ID `es.avsyrykh.tramites` (ASC 6827280378), версия 1.0, сборка от 10. Приложение 90/180 в ASC не трогаем.

## Структура

- `ResidenteKit/` — ядро без UI, общее для приложения и `swift test`:
  гайды трамитов (Catalog, сроки, формы), учёт дней (Day, Stay, SchengenCalculator, ResidencyCalculator),
  новое: `Absences.swift` (отсутствия для larga duración, no lucrativa, ЕС) и `DayLedger.swift`
  (резидент: Испания — дом, пишутся только поездки; гость: каждое пребывание, Испания в 90/180).
- `Residente/` — приложение SwiftUI + SwiftData, iOS 17. Каркас: `Views/Shell.swift` → `ExpedienteView`
  (одна лента карточек вместо вкладок), разделы Papeles / Bóveda / Días / Ausencias / ¿Puedo viajar? / Ajustes.
  Полная версия — встроенные `UnlockCard` + `UnlockSheet`, разовая покупка `es.avsyrykh.tramites.pro`.
- Языки: es, en, ru, uk — в коде (`LText`, переключатель в приложении) и в `InfoPlist.xcstrings`.
- `icon/` — иконка 1024, своя: контур Испании из Natural Earth (public domain), `tools/make_icon.py ne_10m_admin_0_countries.geojson out.png`.

## Проверка на Mac

```
swift test                       # ядро
xcodebuild -project Residente.xcodeproj -scheme Residente -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build
```

Скриншоты (Debug): `-scene resident|visitor -lang es|en|ru|uk -route days|absences|papers|vault|travel|settings|tramite:renewal`.

## Не делать без отдельного «да» Александра

Отправку в App Store, изменения цены IAP в ASC, удаление чего-либо в ASC.
