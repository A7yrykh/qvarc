import Foundation

/// Даты показываем во времени базы отдыха (Челябинская область, UTC+5), а не телефона гостя.
enum Fmt {
    static let timeZone = TimeZone(identifier: "Asia/Yekaterinburg") ?? .current
    static let locale = Locale(identifier: "ru_RU")

    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        c.locale = locale
        return c
    }

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = timeZone
        f.dateFormat = format
        return f
    }

    private static let dayMonthF = formatter("d MMMM")
    private static let timeF = formatter("HH:mm")
    private static let weekdayF = formatter("EE")
    private static let apiDateF = formatter("yyyy-MM-dd")
    private static let fullDateF = formatter("d MMMM yyyy")

    /// «3 июля»
    static func dayMonth(_ d: Date) -> String { dayMonthF.string(from: d) }
    /// «15:00»
    static func time(_ d: Date) -> String { timeF.string(from: d) }
    /// «3 июля, 15:00»
    static func dayMonthTime(_ d: Date) -> String { "\(dayMonth(d)), \(time(d))" }
    /// «Пт»
    static func weekdayShort(_ d: Date) -> String { weekdayF.string(from: d).capitalized(with: locale) }
    /// «3 июля 2026»
    static func fullDate(_ d: Date) -> String { fullDateF.string(from: d) }
    /// Дата для запросов к серверу: «2026-07-03» (по времени базы)
    static func apiDate(_ d: Date) -> String { apiDateF.string(from: d) }

    /// Копейки → «7 000 ₽»
    static func money(_ kopecks: Int) -> String {
        let f = NumberFormatter()
        f.locale = locale
        f.numberStyle = .decimal
        f.groupingSeparator = "\u{00A0}"
        f.maximumFractionDigits = kopecks % 100 == 0 ? 0 : 2
        f.minimumFractionDigits = kopecks % 100 == 0 ? 0 : 2
        let rub = Double(kopecks) / 100
        return (f.string(from: NSNumber(value: rub)) ?? "\(rub)") + "\u{00A0}₽"
    }

    /// Ближайшие дни, начиная с сегодняшнего (по времени базы)
    static func upcomingDays(_ count: Int, from start: Date = Date()) -> [Date] {
        let cal = calendar
        let today = cal.startOfDay(for: start)
        return (0..<count).compactMap { cal.date(byAdding: .day, value: $0, to: today) }
    }

    /// «Анна» → склонение не делаем, просто имя
    static func nights(_ from: Date, _ to: Date) -> Int {
        let cal = calendar
        let a = cal.startOfDay(for: from)
        let b = cal.startOfDay(for: to)
        return max(1, cal.dateComponents([.day], from: a, to: b).day ?? 1)
    }

    static func nightsWord(_ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        if m10 == 1 && m100 != 11 { return "\(n) ночь" }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return "\(n) ночи" }
        return "\(n) ночей"
    }
}

/// Даты в ответах сервера: ISO 8601 с миллисекундами («2026-07-03T10:00:00.000Z»).
enum ISODate {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ s: String) -> Date? { fractional.date(from: s) ?? plain.date(from: s) }
    static func string(_ d: Date) -> String { fractional.string(from: d) }
}
