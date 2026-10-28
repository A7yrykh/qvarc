import Foundation

enum Countries {
    /// Страны Шенгенской зоны (29 на 2026 год, Болгария и Румыния — полностью с 01.01.2025).
    /// Кипр и Ирландия в Шенген не входят.
    static let schengenMembers: Set<String> = [
        "AT", "BE", "BG", "HR", "CZ", "DK", "EE", "FI", "FR", "DE",
        "GR", "HU", "IS", "IT", "LV", "LI", "LT", "LU", "MT", "NL",
        "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH",
    ]

    /// Микрогосударства без пограничного контроля с Шенгеном: дни там фактически идут в счёт 90/180.
    static let openBorderMicrostates: Set<String> = ["MC", "SM", "VA"]

    static func countsTowardSchengen(_ code: String) -> Bool {
        let c = code.uppercased()
        return schengenMembers.contains(c) || openBorderMicrostates.contains(c)
    }

    /// Флаг-эмодзи из ISO-кода страны.
    static func flag(_ code: String) -> String {
        let base: UInt32 = 0x1F1E6 - 65
        return String(code.uppercased().unicodeScalars.compactMap { UnicodeScalar(base + $0.value) }.map(Character.init))
    }

    static func name(_ code: String, locale: Locale = .current) -> String {
        locale.localizedString(forRegionCode: code.uppercased()) ?? code.uppercased()
    }

    /// Все страны мира (двухбуквенные ISO-коды), отсортированные по названию на языке пользователя.
    static func all(locale: Locale = .current) -> [String] {
        let codes = Locale.Region.isoRegions
            .map(\.identifier)
            .filter { $0.count == 2 && $0.allSatisfy(\.isLetter) }
        return Set(codes)
            .filter { locale.localizedString(forRegionCode: $0) != nil }
            .sorted { name($0, locale: locale).localizedCompare(name($1, locale: locale)) == .orderedAscending }
    }
}
