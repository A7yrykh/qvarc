import Foundation

/// Календарный день без времени и часового пояса.
/// ordinal — номер дня по юлианскому счёту (JDN), поэтому разница дней — простое вычитание.
struct Day: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    let ordinal: Int

    init(ordinal: Int) {
        self.ordinal = ordinal
    }

    init(year: Int, month: Int, day: Int) {
        let a = (14 - month) / 12
        let y = year + 4800 - a
        let m = month + 12 * a - 3
        ordinal = day + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045
    }

    init(_ date: Date, calendar: Calendar = .current) {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        self.init(year: c.year!, month: c.month!, day: c.day!)
    }

    static func today(calendar: Calendar = .current) -> Day {
        Day(Date(), calendar: calendar)
    }

    var components: (year: Int, month: Int, day: Int) {
        let a = ordinal + 32044
        let b = (4 * a + 3) / 146097
        let c = a - 146097 * b / 4
        let d = (4 * c + 3) / 1461
        let e = c - 1461 * d / 4
        let m = (5 * e + 2) / 153
        let day = e - (153 * m + 2) / 5 + 1
        let month = m + 3 - 12 * (m / 10)
        let year = 100 * b + d - 4800 + m / 10
        return (year, month, day)
    }

    var year: Int { components.year }

    /// Полдень этого дня в заданном календаре: безопасно для DatePicker и смены часового пояса.
    func date(calendar: Calendar = .current) -> Date {
        let c = components
        return calendar.date(from: DateComponents(year: c.year, month: c.month, day: c.day, hour: 12))!
    }

    func adding(_ days: Int) -> Day {
        Day(ordinal: ordinal + days)
    }

    static func - (lhs: Day, rhs: Day) -> Int {
        lhs.ordinal - rhs.ordinal
    }

    static func < (lhs: Day, rhs: Day) -> Bool {
        lhs.ordinal < rhs.ordinal
    }

    /// ISO 8601: 2026-04-10.
    var iso: String {
        let c = components
        return String(format: "%04d-%02d-%02d", c.year, c.month, c.day)
    }

    var description: String { iso }

    init?(iso: String) {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }
}

extension ClosedRange where Bound == Day {
    var dayCount: Int { upperBound - lowerBound + 1 }

    var days: [Day] {
        (lowerBound.ordinal...upperBound.ordinal).map(Day.init(ordinal:))
    }
}
