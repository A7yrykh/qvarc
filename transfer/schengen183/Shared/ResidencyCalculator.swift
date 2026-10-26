import Foundation

/// Дни физического присутствия по странам для налогового резидентства (порог 183 дня).
/// День переезда считается в обеих странах.
struct ResidencyCalculator: Sendable {
    static let threshold = 183

    private let byCountry: [String: PresenceIndex]

    init(stays: [Stay]) {
        var ordinals: [String: [Int]] = [:]
        for stay in stays {
            ordinals[stay.country, default: []] += Array(stay.start.ordinal...stay.end.ordinal)
        }
        byCountry = ordinals.mapValues { PresenceIndex($0) }
    }

    func days(in country: String, from: Day, to: Day) -> Int {
        byCountry[country.uppercased()]?.count(from: from.ordinal, to: to.ordinal) ?? 0
    }

    /// Дни по странам за календарный год, по убыванию.
    func totals(year: Int) -> [CountryDays] {
        totals(from: Day(year: year, month: 1, day: 1), to: Day(year: year, month: 12, day: 31))
    }

    /// Дни по странам за последние 365 дней до `day` включительно.
    func rolling12Months(endingOn day: Day) -> [CountryDays] {
        totals(from: day.adding(-364), to: day)
    }

    func totals(from: Day, to: Day) -> [CountryDays] {
        byCountry.compactMap { code, index in
            let n = index.count(from: from.ordinal, to: to.ordinal)
            return n > 0 ? CountryDays(country: code, days: n) : nil
        }
        .sorted { $0.days != $1.days ? $0.days > $1.days : $0.country < $1.country }
    }

    /// Годы, за которые есть данные.
    var years: [Int] {
        let all = byCountry.values.flatMap { [$0.first, $0.last].compactMap { $0?.year } }
        guard let lo = all.min(), let hi = all.max() else { return [] }
        return Array(lo...hi)
    }
}

struct CountryDays: Hashable, Sendable {
    let country: String
    let days: Int

    var reachesThreshold: Bool { days >= ResidencyCalculator.threshold }
    var remainingToThreshold: Int { max(0, ResidencyCalculator.threshold - days) }
}
