import Foundation

/// Все счётчики дней из одного списка поездок. Зависит от того, живёт ли человек в Испании:
/// у резидента Испания — дом (пишутся только поездки за границу, дни в Испании в 90/180 не идут),
/// у гостя без ВНЖ каждое пребывание записывается явно, и Испания считается в 90/180, как любая страна Шенгена.
struct DayLedger: Sendable {
    enum Mode: Sendable, Equatable {
        case resident(since: Day)
        case visitor
    }

    let mode: Mode
    let stays: [Stay]
    let today: Day
    let schengen: SchengenCalculator

    init(stays: [Stay], mode: Mode, today: Day) {
        self.mode = mode
        self.stays = stays
        self.today = today
        switch mode {
        case .resident:
            schengen = SchengenCalculator(stays: stays.filter { $0.country != SpainPresence.spain })
        case .visitor:
            schengen = SchengenCalculator(stays: stays)
        }
    }

    /// Дни в Испании за календарный год (до сегодняшнего дня включительно).
    func daysInSpain(year: Int) -> Int {
        let from = Day(year: year, month: 1, day: 1)
        let to = min(Day(year: year, month: 12, day: 31), today)
        guard from <= to else { return 0 }
        switch mode {
        case .resident(let since):
            return SpainPresence(stays: stays, since: since, through: today).presentDays(from: from, to: to)
        case .visitor:
            return ResidencyCalculator(stays: stays).days(in: SpainPresence.spain, from: from, to: to)
        }
    }

    /// Станет ли человек налоговым резидентом Испании в этом году (183 дня и больше).
    var isTaxResidentThisYear: Bool { daysInSpain(year: today.year) >= ResidencyCalculator.threshold }

    /// Дни Шенгена за последние 180 дней: у резидента — только вне Испании.
    var schengenUsed: Int { schengen.used(on: today) }
    var schengenLeft: Int { schengen.remaining(on: today) }

    /// Можно ли поездку: для резидента — по 90/180 за пределами Испании, для гостя — по общему 90/180.
    func evaluate(trip: Stay) -> PlanResult? {
        guard trip.isSchengen, !(trip.country == SpainPresence.spain && mode != .visitor) else { return nil }
        return schengen.evaluate(trip: trip.range)
    }
}
