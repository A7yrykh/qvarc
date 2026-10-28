import Foundation

/// Дни в Испании для резидента. Если Испания — дом, записывать нужно только поездки за границу:
/// все остальные дни с `since` считаются днями в Испании. Дни выезда и возвращения — тоже в Испании
/// (как в 90/180, день переезда идёт в обе страны).
struct SpainPresence: Sendable {
    static let spain = "ES"

    let since: Day
    let through: Day
    /// Дни полного отсутствия (без дня выезда и дня возвращения).
    let absent: PresenceIndex

    init(stays: [Stay], since: Day, through: Day) {
        self.since = since
        self.through = through
        let home = Set(stays.filter { $0.country == Self.spain }.flatMap { $0.start.ordinal...$0.end.ordinal })
        var away: [Int] = []
        for stay in stays where stay.country != Self.spain && stay.length > 2 {
            away += (stay.start.ordinal + 1)...(stay.end.ordinal - 1)
        }
        absent = PresenceIndex(away.filter { !home.contains($0) && $0 >= since.ordinal && $0 <= through.ordinal })
    }

    func absentDays(from: Day, to: Day) -> Int {
        absent.count(from: max(from, since).ordinal, to: min(to, through).ordinal)
    }

    func presentDays(from: Day, to: Day) -> Int {
        let lo = max(from, since), hi = min(to, through)
        guard lo <= hi else { return 0 }
        return (lo...hi).dayCount - absentDays(from: lo, to: hi)
    }

    /// Непрерывные отрезки отсутствия в [from, to], по порядку.
    func gaps(from: Day, to: Day) -> [ClosedRange<Day>] {
        var result: [ClosedRange<Day>] = []
        var start: Int?
        var previous = Int.min
        for ordinal in absent.sorted where ordinal >= from.ordinal && ordinal <= to.ordinal {
            if let s = start, ordinal != previous + 1 {
                result.append(Day(ordinal: s)...Day(ordinal: previous))
                start = ordinal
            } else if start == nil {
                start = ordinal
            }
            previous = ordinal
        }
        if let s = start { result.append(Day(ordinal: s)...Day(ordinal: previous)) }
        return result
    }
}

/// Правила об отсутствии в Испании, которые влияют на продление и новые статусы.
/// Месяцы считаются днями с запасом: 6 месяцев = 180 дней, 10 месяцев = 300 дней,
/// чтобы приложение предупреждало раньше, а не позже.
enum AbsenceRule: String, CaseIterable, Codable, Sendable, Identifiable {
    /// Продление residencia no lucrativa (RD 1155/2024): не меньше 183 дней в Испании за каждый год.
    case nonLucrativeRenewal
    /// Larga duración: 5 лет без отсутствий дольше 6 месяцев подряд и не больше 10 месяцев всего.
    case longTerm
    /// Постоянное проживание граждан ЕС и их семей (RD 240/2007, ст. 10): не больше 6 месяцев за год.
    case euPermanent

    var id: String { rawValue }

    static let sixMonths = 180
    static let tenMonths = 300
    static let year = 365
    static let fiveYears = 5 * 365 + 1
}

struct AbsenceCheck: Sendable {
    enum Status: Int, Comparable, Sendable {
        case ok, close, broken
        static func < (l: Status, r: Status) -> Bool { l.rawValue < r.rawValue }
    }

    struct Line: Sendable, Hashable {
        /// Что измеряем: длина самого долгого отсутствия, сумма отсутствий, дни в Испании за год.
        enum Measure: Sendable, Hashable { case longestAbsence, totalAbsence, daysInSpain(year: Int) }
        let measure: Measure
        let value: Int
        let limit: Int
        let status: Status
    }

    let rule: AbsenceRule
    let period: ClosedRange<Day>
    let lines: [Line]

    var status: Status { lines.map(\.status).max() ?? .ok }
}

enum Absences {
    /// Доля лимита, с которой показываем предупреждение.
    static let warnShare = 0.8

    static func status(used: Int, limit: Int) -> AbsenceCheck.Status {
        if used > limit { return .broken }
        return Double(used) >= Double(limit) * warnShare ? .close : .ok
    }

    /// Проверка правила на `today`. `residenceStart` — дата первой резолюции или въезда по визе.
    static func check(_ rule: AbsenceRule, stays: [Stay], residenceStart: Day, today: Day) -> AbsenceCheck {
        let presence = SpainPresence(stays: stays, since: residenceStart, through: today)
        switch rule {
        case .longTerm:
            let from = max(residenceStart, today.adding(-(AbsenceRule.fiveYears - 1)))
            let longest = presence.gaps(from: from, to: today).map(\.dayCount).max() ?? 0
            let total = presence.absentDays(from: from, to: today)
            return AbsenceCheck(rule: rule, period: from...today, lines: [
                .init(measure: .longestAbsence, value: longest, limit: AbsenceRule.sixMonths,
                      status: status(used: longest, limit: AbsenceRule.sixMonths)),
                .init(measure: .totalAbsence, value: total, limit: AbsenceRule.tenMonths,
                      status: status(used: total, limit: AbsenceRule.tenMonths)),
            ])
        case .euPermanent:
            let years = residenceYears(start: residenceStart, today: today).suffix(5)
            let lines = years.map { index, range -> AbsenceCheck.Line in
                let away = presence.absentDays(from: range.lowerBound, to: range.upperBound)
                return .init(measure: .totalAbsence, value: away, limit: AbsenceRule.sixMonths,
                             status: status(used: away, limit: AbsenceRule.sixMonths))
            }
            return AbsenceCheck(rule: rule, period: (years.first?.1.lowerBound ?? residenceStart)...today, lines: lines)
        case .nonLucrativeRenewal:
            let need = ResidencyCalculator.threshold
            let lines = residenceYears(start: residenceStart, today: today).map { index, range -> AbsenceCheck.Line in
                let here = presence.presentDays(from: range.lowerBound, to: min(range.upperBound, today))
                // В текущем году смотрим, можно ли ещё набрать 183 дня до конца года разрешения.
                let reachable = here + max(0, range.upperBound - today)
                let status: AbsenceCheck.Status
                if reachable < need { status = .broken }
                else if here >= need { status = .ok }
                else { status = reachable - need < 30 ? .close : .ok }
                return .init(measure: .daysInSpain(year: index + 1), value: here, limit: need, status: status)
            }
            return AbsenceCheck(rule: rule, period: residenceStart...today, lines: lines)
        }
    }

    /// Годы разрешения от даты начала: [start, start+364], [start+365, …], последний — текущий.
    static func residenceYears(start: Day, today: Day) -> [(Int, ClosedRange<Day>)] {
        guard start <= today else { return [] }
        let count = (today - start) / AbsenceRule.year + 1
        return (0..<count).map { i in
            let lo = start.adding(i * AbsenceRule.year)
            return (i, lo...lo.adding(AbsenceRule.year - 1))
        }
    }

    /// До какого дня можно уехать из Испании, начиная с `departure`, не нарушив правило.
    /// nil — уже нарушено или нельзя уехать даже на одну ночь.
    static func latestReturn(_ rule: AbsenceRule, stays: [Stay], residenceStart: Day, departure: Day) -> Day? {
        var best: Day?
        // Поездка с одной полной ночью за границей — минимум три календарных дня.
        var end = departure.adding(2)
        while end - departure <= AbsenceRule.year {
            let trip = Stay(country: "XX", start: departure, end: end)
            let result = check(rule, stays: stays + [trip], residenceStart: residenceStart, today: end)
            if result.status == .broken { break }
            best = end
            end = end.adding(1)
        }
        return best
    }
}
