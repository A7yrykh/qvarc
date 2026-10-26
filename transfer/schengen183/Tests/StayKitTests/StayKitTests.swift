import XCTest
@testable import StayKit

final class DayTests: XCTestCase {
    func testRoundTrip() {
        let d = Day(year: 2026, month: 4, day: 10)
        XCTAssertEqual(d.components.year, 2026)
        XCTAssertEqual(d.components.month, 4)
        XCTAssertEqual(d.components.day, 10)
        XCTAssertEqual(d.iso, "2026-04-10")
        XCTAssertEqual(Day(iso: "2026-04-10"), d)
    }

    func testLeapYearAndDifference() {
        XCTAssertEqual(Day(year: 2028, month: 3, day: 1) - Day(year: 2028, month: 2, day: 28), 2)
        XCTAssertEqual(Day(year: 2027, month: 1, day: 1) - Day(year: 2026, month: 12, day: 31), 1)
        XCTAssertEqual(Day(year: 2026, month: 12, day: 31).adding(1).iso, "2027-01-01")
    }

    func testDateConversionKeepsCalendarDay() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Pacific/Auckland")!
        let d = Day(year: 2026, month: 10, day: 26)
        XCTAssertEqual(Day(d.date(calendar: cal), calendar: cal), d)
    }
}

final class SchengenTests: XCTestCase {
    let jan1 = Day(year: 2026, month: 1, day: 1)

    func stay(_ start: Day, _ length: Int, _ country: String = "ES") -> Stay {
        Stay(country: country, start: start, end: start.adding(length - 1))
    }

    func testEntryAndExitDaysCount() {
        let calc = SchengenCalculator(stays: [stay(jan1, 10)])
        XCTAssertEqual(calc.used(on: jan1.adding(9)), 10)
        XCTAssertEqual(calc.remaining(on: jan1.adding(9)), 80)
    }

    func testNonSchengenIgnored() {
        let calc = SchengenCalculator(stays: [stay(jan1, 30, "GB"), stay(jan1, 30, "CY"), stay(jan1, 30, "IE")])
        XCTAssertEqual(calc.used(on: jan1.adding(29)), 0)
    }

    func testMicrostatesCount() {
        XCTAssertTrue(Countries.countsTowardSchengen("mc"))
        XCTAssertTrue(Countries.countsTowardSchengen("RO"))
        XCTAssertFalse(Countries.countsTowardSchengen("AD"))
    }

    func testOverlappingStaysCountedOnce() {
        let calc = SchengenCalculator(stays: [stay(jan1, 10, "ES"), stay(jan1.adding(9), 5, "FR")])
        XCTAssertEqual(calc.used(on: jan1.adding(20)), 14)
    }

    func testWindowRollsOff() {
        let calc = SchengenCalculator(stays: [stay(jan1, 90)])
        XCTAssertEqual(calc.used(on: jan1.adding(89)), 90)
        // День 180 (jan1+179) — окно ещё включает jan1.
        XCTAssertEqual(calc.used(on: jan1.adding(179)), 90)
        // День 181: jan1 выпал из окна.
        XCTAssertEqual(calc.used(on: jan1.adding(180)), 89)
        XCTAssertEqual(calc.available(enteringOn: jan1.adding(180)), 1)
    }

    func testLastAllowedDayFromScratch() {
        let calc = SchengenCalculator(stays: [])
        XCTAssertEqual(calc.lastAllowedDay(stayingFrom: jan1), jan1.adding(89))
    }

    func testLastAllowedDayWithHistory() {
        // 60 дней в январе-феврале, затем перерыв; въезд 1 апреля.
        let calc = SchengenCalculator(stays: [stay(jan1, 60)])
        let apr1 = Day(year: 2026, month: 4, day: 1)
        let last = calc.lastAllowedDay(stayingFrom: apr1)!
        let check = SchengenCalculator(stays: [stay(jan1, 60), Stay(country: "ES", start: apr1, end: last)])
        XCTAssertNil(check.firstViolation(from: apr1, to: last.adding(179)))
        let over = SchengenCalculator(stays: [stay(jan1, 60), Stay(country: "ES", start: apr1, end: last.adding(1))])
        XCTAssertNotNil(over.firstViolation(from: apr1, to: last.adding(180)))
        // С 1 апреля в окне 60 старых дней, но они начинают выпадать с 30 июня.
        XCTAssertGreaterThan(last - apr1 + 1, 30)
    }

    func testFullyUsedNoEntry() {
        let calc = SchengenCalculator(stays: [stay(jan1, 90)])
        XCTAssertNil(calc.lastAllowedDay(stayingFrom: jan1.adding(100)))
        XCTAssertEqual(calc.available(enteringOn: jan1.adding(100)), 0)
    }

    func testPlanRespectsFutureTrips() {
        // Будущая поездка 80 дней с 1 июня: короткая поездка в мае на 20 дней её «ломает».
        let jun1 = Day(year: 2026, month: 6, day: 1)
        let calc = SchengenCalculator(stays: [stay(jun1, 80)])
        let may1 = Day(year: 2026, month: 5, day: 1)
        let plan = calc.evaluate(trip: may1...may1.adding(19))
        XCTAssertFalse(plan.isAllowed)
        XCTAssertTrue(calc.evaluate(trip: may1...may1.adding(9)).isAllowed)
    }

    func testOverstayDays() {
        let calc = SchengenCalculator(stays: [stay(jan1, 95)])
        XCTAssertEqual(calc.overstayDays(from: jan1, to: jan1.adding(200)), 5)
        XCTAssertEqual(calc.firstViolation(from: jan1, to: jan1.adding(200)), jan1.adding(90))
    }

    func testEarliestEntry() {
        let calc = SchengenCalculator(stays: [stay(jan1, 90)])
        // Чтобы пробыть 10 дней, нужно дождаться, пока выпадут 10 дней: jan1+180 … jan1+189.
        let earliest = calc.earliestEntry(forDays: 10, from: jan1.adding(90))!
        XCTAssertEqual(earliest, jan1.adding(180))
        XCTAssertNil(calc.earliestEntry(forDays: 91, from: jan1))
    }

    func testRecoveryTimeline() {
        let calc = SchengenCalculator(stays: [stay(jan1, 3)])
        let points = calc.recoveryTimeline(from: jan1.adding(3), days: 200)
        XCTAssertEqual(points.map(\.day), [jan1.adding(180), jan1.adding(181), jan1.adding(182)])
        XCTAssertEqual(points.last?.available, 90)
    }
}

final class ResidencyTests: XCTestCase {
    func testCalendarYearTotalsAndTravelDay() {
        let stays = [
            Stay(country: "ES", start: Day(year: 2025, month: 12, day: 20), end: Day(year: 2026, month: 7, day: 1)),
            Stay(country: "GB", start: Day(year: 2026, month: 7, day: 1), end: Day(year: 2026, month: 8, day: 31)),
        ]
        let calc = ResidencyCalculator(stays: stays)
        let totals = calc.totals(year: 2026)
        XCTAssertEqual(totals.first?.country, "ES")
        XCTAssertEqual(totals.first?.days, 182) // 1 янв – 1 июл 2026
        XCTAssertFalse(totals.first!.reachesThreshold)
        XCTAssertEqual(totals.first?.remainingToThreshold, 1)
        XCTAssertEqual(calc.days(in: "GB", from: Day(year: 2026, month: 1, day: 1), to: Day(year: 2026, month: 12, day: 31)), 62)
        XCTAssertEqual(calc.years, [2025, 2026])
    }

    func testRolling() {
        let calc = ResidencyCalculator(stays: [Stay(country: "PT", start: Day(year: 2025, month: 1, day: 1), end: Day(year: 2026, month: 12, day: 31))])
        XCTAssertEqual(calc.rolling12Months(endingOn: Day(year: 2026, month: 6, day: 30)).first?.days, 365)
    }
}

final class AutoTrackTests: XCTestCase {
    let d = Day(year: 2026, month: 5, day: 5)

    func testOpenMoveAndIgnore() {
        XCTAssertEqual(AutoTrack.action(current: nil, observed: "es", on: d), .open(country: "ES", on: d))
        XCTAssertEqual(AutoTrack.action(current: ("ES", d), observed: "ES", on: d.adding(3)), .none)
        XCTAssertEqual(AutoTrack.action(current: ("ES", d), observed: "FR", on: d.adding(3)), .move(closeOn: d.adding(3), country: "FR"))
        XCTAssertEqual(AutoTrack.action(current: ("ES", d), observed: "FR", on: d.adding(-1)), .none)
        XCTAssertEqual(AutoTrack.action(current: ("ES", d), observed: "", on: d), .none)
    }
}

final class ReportTests: XCTestCase {
    func testCSVQuoting() {
        let stay = Stay(country: "es", start: Day(year: 2026, month: 1, day: 1), end: Day(year: 2026, month: 1, day: 3))
        let csv = ReportBuilder.csv(rows: [.init(traveler: "Ann, \"A\"", stay: stay, ongoing: false)],
                                    header: ["Traveller", "Code", "Country", "Schengen", "Entry", "Exit", "Days"])
        XCTAssertTrue(csv.contains("\"Ann, \"\"A\"\"\",ES,Spain,yes,2026-01-01,2026-01-03,3"))
    }
}
