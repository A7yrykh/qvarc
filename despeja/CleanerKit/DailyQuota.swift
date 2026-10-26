import Foundation

/// Бесплатный лимит удалений в день. Хранится в UserDefaults, сбрасывается в полночь по местному времени.
public struct DailyQuota {
    public static let freeLimit = 20

    private let defaults: UserDefaults
    private let limit: Int
    private let calendar: Calendar
    private let dayKey = "quota.day"
    private let usedKey = "quota.used"

    public init(defaults: UserDefaults = .standard, limit: Int = DailyQuota.freeLimit,
                calendar: Calendar = .current) {
        self.defaults = defaults
        self.limit = limit
        self.calendar = calendar
    }

    private func stamp(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return "\(c.year!)-\(c.month!)-\(c.day!)"
    }

    public func used(on date: Date = Date()) -> Int {
        defaults.string(forKey: dayKey) == stamp(date) ? defaults.integer(forKey: usedKey) : 0
    }

    public func remaining(on date: Date = Date()) -> Int {
        max(0, limit - used(on: date))
    }

    /// Записать удаление `count` файлов.
    public func consume(_ count: Int, on date: Date = Date()) {
        let total = used(on: date) + count
        defaults.set(stamp(date), forKey: dayKey)
        defaults.set(total, forKey: usedKey)
    }
}
