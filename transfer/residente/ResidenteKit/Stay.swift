import Foundation

/// Пребывание в стране: день въезда и день выезда включительно (оба дня считаются в 90/180).
struct Stay: Hashable, Codable, Sendable {
    var country: String
    var start: Day
    var end: Day

    init(country: String, start: Day, end: Day) {
        self.country = country.uppercased()
        self.start = min(start, end)
        self.end = max(start, end)
    }

    var range: ClosedRange<Day> { start...end }
    var length: Int { range.dayCount }
    var isSchengen: Bool { Countries.countsTowardSchengen(country) }
}

/// Отсортированный набор дней присутствия с быстрым подсчётом в интервале.
struct PresenceIndex: Sendable {
    private(set) var sorted: [Int]

    init<S: Sequence>(_ ordinals: S) where S.Element == Int {
        sorted = Array(Set(ordinals)).sorted()
    }

    var isEmpty: Bool { sorted.isEmpty }
    var first: Day? { sorted.first.map(Day.init(ordinal:)) }
    var last: Day? { sorted.last.map(Day.init(ordinal:)) }

    func contains(_ day: Day) -> Bool {
        let i = lowerBound(day.ordinal)
        return i < sorted.count && sorted[i] == day.ordinal
    }

    /// Сколько дней набора лежит в [from, to].
    func count(from: Int, to: Int) -> Int {
        guard from <= to else { return 0 }
        return lowerBound(to + 1) - lowerBound(from)
    }

    func adding(_ range: ClosedRange<Day>) -> PresenceIndex {
        PresenceIndex(sorted + (range.lowerBound.ordinal...range.upperBound.ordinal))
    }

    private func lowerBound(_ value: Int) -> Int {
        var lo = 0, hi = sorted.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if sorted[mid] < value { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }
}
