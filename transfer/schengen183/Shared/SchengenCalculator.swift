import Foundation

/// Правило 90/180: в любом скользящем окне из 180 дней (день проверки и 179 предыдущих)
/// можно находиться в Шенгене не более 90 дней. Дни въезда и выезда считаются целиком.
struct SchengenCalculator: Sendable {
    static let limit = 90
    static let window = 180
    /// Дальше этого горизонта не ищем: за 90 + 180 дней окно гарантированно обновляется.
    static let horizon = limit + window

    let presence: PresenceIndex

    init(presence: PresenceIndex) {
        self.presence = presence
    }

    init(stays: [Stay]) {
        presence = PresenceIndex(stays.filter(\.isSchengen).flatMap { $0.start.ordinal...$0.end.ordinal })
    }

    /// Дней в Шенгене в окне, которое заканчивается этим днём (включая его).
    func used(on day: Day) -> Int {
        presence.count(from: day.ordinal - Self.window + 1, to: day.ordinal)
    }

    func remaining(on day: Day) -> Int {
        max(0, Self.limit - used(on: day))
    }

    func isPresent(on day: Day) -> Bool {
        presence.contains(day)
    }

    /// Сколько дней свободно для въезда в этот день: лимит минус дни за 179 предыдущих дней.
    func available(enteringOn day: Day) -> Int {
        max(0, Self.limit - presence.count(from: day.ordinal - Self.window + 1, to: day.ordinal - 1))
    }

    /// Первый день присутствия в [from, to], на который превышен лимит.
    func firstViolation(from: Day, to: Day) -> Day? {
        guard from <= to else { return nil }
        for ordinal in from.ordinal...to.ordinal {
            let day = Day(ordinal: ordinal)
            if presence.contains(day), used(on: day) > Self.limit { return day }
        }
        return nil
    }

    /// Дней превышения (дни присутствия сверх лимита) в [from, to].
    func overstayDays(from: Day, to: Day) -> Int {
        guard from <= to else { return 0 }
        return (from.ordinal...to.ordinal).reduce(0) { total, ordinal in
            let day = Day(ordinal: ordinal)
            return total + (presence.contains(day) && used(on: day) > Self.limit ? 1 : 0)
        }
    }

    /// Последний день, до которого можно непрерывно оставаться (или пробыть, въехав в `start`),
    /// не нарушая правило ни в один день — с учётом уже запланированных будущих поездок.
    /// nil — нельзя находиться даже в сам день `start`.
    func lastAllowedDay(stayingFrom start: Day) -> Day? {
        var best: Day?
        var end = start
        while end - start < Self.horizon {
            let candidate = SchengenCalculator(presence: presence.adding(start...end))
            if candidate.firstViolation(from: start, to: end.adding(Self.window - 1)) != nil { break }
            best = end
            end = end.adding(1)
        }
        return best
    }

    /// Проверка будущей поездки.
    func evaluate(trip: ClosedRange<Day>) -> PlanResult {
        let with = SchengenCalculator(presence: presence.adding(trip))
        let checkTo = trip.upperBound.adding(Self.window - 1)
        let violation = with.firstViolation(from: trip.lowerBound, to: checkTo)
        let maxUsed = trip.days.map(with.used(on:)).max() ?? 0
        return PlanResult(
            trip: trip,
            firstViolation: violation,
            overstayDays: with.overstayDays(from: trip.lowerBound, to: checkTo),
            maxUsed: maxUsed,
            lastAllowedDay: lastAllowedDay(stayingFrom: trip.lowerBound))
    }

    func allows(trip: ClosedRange<Day>) -> Bool {
        SchengenCalculator(presence: presence.adding(trip))
            .firstViolation(from: trip.lowerBound, to: trip.upperBound.adding(Self.window - 1)) == nil
    }

    /// Самая ранняя дата не раньше `from`, с которой можно пробыть `length` дней подряд.
    func earliestEntry(forDays length: Int, from: Day) -> Day? {
        guard length >= 1, length <= Self.limit else { return nil }
        for offset in 0...(Self.horizon + Self.window) {
            let start = from.adding(offset)
            if allows(trip: start...start.adding(length - 1)) { return start }
        }
        return nil
    }

    /// Даты, когда количество свободных дней для въезда растёт (если не въезжать до этого).
    func recoveryTimeline(from: Day, days: Int = window) -> [(day: Day, available: Int)] {
        var result: [(Day, Int)] = []
        var previous = available(enteringOn: from)
        for offset in 1...days {
            let day = from.adding(offset)
            let value = available(enteringOn: day)
            if value > previous { result.append((day, value)) }
            previous = value
        }
        return result
    }
}

struct PlanResult: Sendable {
    let trip: ClosedRange<Day>
    let firstViolation: Day?
    let overstayDays: Int
    let maxUsed: Int
    let lastAllowedDay: Day?

    var isAllowed: Bool { firstViolation == nil }
}
