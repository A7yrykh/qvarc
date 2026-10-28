import XCTest
@testable import ResidenteKit

final class NIETests: XCTestCase {
    func testValidNIE() {
        XCTAssertTrue(NIE.isValid("X1234567L"))
        XCTAssertTrue(NIE.isValid("x-1234567-l"))
        XCTAssertTrue(NIE.isValid("Y 0000000 Z")) // 10000000 % 23 = 14 → Z
        XCTAssertTrue(NIE.isValid("Z0000000M"))   // 20000000 % 23 = 5 → M
    }

    func testInvalidNIE() {
        XCTAssertFalse(NIE.isValid("X1234567A"))
        XCTAssertFalse(NIE.isValid("12345678Z")) // это DNI, а не NIE
        XCTAssertFalse(NIE.isValid("X123456L"))
        XCTAssertFalse(NIE.isValid(""))
    }

    func testFormatted() {
        XCTAssertEqual(NIE.formatted("x1234567l"), "X-1234567-L")
    }

    func testFindInText() {
        let text = "NIE: X-1234567-L  otro X1234567A  NUM Y0000000Z"
        XCTAssertEqual(NIE.find(in: text), ["X1234567L", "Y0000000Z"])
    }
}

final class DocumentTextTests: XCTestCase {
    let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Madrid")!
        return c
    }()

    func ymd(_ d: Date?) -> String? {
        guard let d else { return nil }
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    func testDatesInLine() {
        XCTAssertEqual(DocumentText.dates(in: "Válido hasta 31/12/2027").map { ymd($0) }, ["2027-12-31"])
        XCTAssertEqual(DocumentText.dates(in: "15.03.2026 y 01-02-2030").map { ymd($0) }, ["2026-03-15", "2030-02-01"])
        XCTAssertEqual(DocumentText.dates(in: "VALIDEZ 05 06 2028").map { ymd($0) }, ["2028-06-05"])
        XCTAssertTrue(DocumentText.dates(in: "31/02/2027").isEmpty)
    }

    func testTIEWithLabels() {
        let text = """
        TARJETA DE IDENTIDAD DE EXTRANJERO
        NIE X1234567L
        VALIDEZ
        14 08 2028
        FECHA DE EXPEDICIÓN 20/08/2026
        """
        let a = DocumentText.analyze(text, now: cal.date(from: DateComponents(year: 2026, month: 10, day: 25))!)
        XCTAssertEqual(ymd(a.expiryDate), "2028-08-14")
        XCTAssertEqual(ymd(a.issueDate), "2026-08-20")
        XCTAssertEqual(a.nies, ["X1234567L"])
    }

    func testMRZTD1() {
        // Строка 2 TD1: дата рождения 900115, контроль, пол F, срок 300601.
        let text = """
        IDESPE12345678<<<<<<<<<<<<<<<<
        9001154F3006019ESP<<<<<<<<<<<6
        GARCIA<<ANA<<<<<<<<<<<<<<<<<<<
        """
        let a = DocumentText.analyze(text)
        XCTAssertEqual(ymd(a.expiryDate), "2030-06-01")
    }

    func testMRZTD3() {
        let text = """
        P<UKRSHEVCHENKO<<TARAS<<<<<<<<<<<<<<<<<<<<<<
        FE1234567<UKR8503091M3201157<<<<<<<<<<<<<<04
        """
        let a = DocumentText.analyze(text)
        XCTAssertEqual(ymd(a.expiryDate), "2032-01-15")
    }

    func testFallbackLatestFutureDate() {
        let now = cal.date(from: DateComponents(year: 2026, month: 10, day: 25))!
        let a = DocumentText.analyze("Emitido 01/01/2026\nOtro 10/10/2029\n05/05/2027", now: now)
        XCTAssertEqual(ymd(a.expiryDate), "2029-10-10")
        XCTAssertEqual(a.allDates.count, 3)
    }
}

final class DeadlineTests: XCTestCase {
    let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Madrid")!
        return c
    }()

    func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: d, hour: 12))!
    }

    func testRenewalWindow() {
        let window = Deadlines.renewalWindow(expiry: date(2027, 6, 30))
        XCTAssertEqual(window.lowerBound, date(2027, 5, 1))   // −60 дней
        XCTAssertEqual(window.upperBound, date(2027, 9, 28))  // +90 дней
    }

    func testTIEMilestones() {
        let m = Deadlines.milestones(kind: .tie, expiry: date(2027, 6, 30))
        XCTAssertEqual(m.map(\.kind), [.expiresSoon, .renewalWindowOpens, .expiresToday, .renewalWindowCloses])
        XCTAssertEqual(m[1].date, date(2027, 5, 1))
        XCTAssertEqual(m[3].date, date(2027, 9, 14))
    }

    func testPassportAndPadron() {
        XCTAssertEqual(Deadlines.milestones(kind: .passport, expiry: date(2030, 1, 1)).first?.kind, .passportRenewSoon)
        let p = Deadlines.milestones(kind: .padron, expiry: nil, issued: date(2026, 10, 1))
        XCTAssertEqual(p.first?.date, date(2026, 12, 30))
        XCTAssertTrue(Deadlines.milestones(kind: .other, expiry: nil).isEmpty)
    }

    func testDaysUntil() {
        XCTAssertEqual(Deadlines.daysUntil(date(2026, 11, 4), from: date(2026, 10, 25)), 10)
    }
}

final class CatalogTests: XCTestCase {
    func testIdsUnique() {
        let ids = Catalog.all.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        for t in Catalog.all {
            XCTAssertEqual(Set(t.steps.map(\.id)).count, t.steps.count, t.id)
            XCTAssertEqual(Set(t.documents.map(\.id)).count, t.documents.count, t.id)
        }
    }

    func testAllTextsTranslated() {
        for t in Catalog.all {
            var texts: [LText] = [t.title, t.summary, t.who, t.whereToApply, t.cost, t.duration]
            texts += t.documents.map(\.text) + t.steps.flatMap { [$0.title, $0.detail] } + t.tips + t.sources.map(\.title)
            for text in texts {
                for s in text.all { XCTAssertFalse(s.isEmpty, "\(t.id): \(text.es)") }
            }
        }
    }

    func testEveryTramiteHasHTTPSSources() {
        for t in Catalog.all {
            XCTAssertFalse(t.sources.isEmpty, t.id)
            XCTAssertFalse(t.steps.isEmpty, t.id)
            for s in t.sources { XCTAssertEqual(s.url.scheme, "https", t.id) }
        }
    }

    func testCitaStepImpliesCitaInfo() {
        for t in Catalog.all where t.steps.contains(where: \.isCita) {
            XCTAssertNotNil(t.cita, t.id)
        }
    }

    func testTasaAmounts() {
        let amounts = Catalog.all.flatMap(\.forms).compactMap(\.amount)
        XCTAssertTrue(amounts.contains(Decimal(string: "9.84")!))
        XCTAssertTrue(amounts.contains(Decimal(string: "16.08")!))
    }

    func testProvinces() {
        XCTAssertEqual(Province.all.count, 52)
        XCTAssertEqual(Province.named(code: "28")?.name, "Madrid")
    }
}

final class PlanTests: XCTestCase {
    func testNonEUJustArrived() {
        XCTAssertEqual(PlanBuilder.recommended(for: Situation(isEUCitizen: false, stage: .justArrived)),
                       ["padron", "tie-first", "digital-certificate", "clave"])
    }

    func testEUNeverGetsTIE() {
        for stage in Stage.allCases {
            let ids = PlanBuilder.recommended(for: Situation(isEUCitizen: true, stage: stage))
            XCTAssertFalse(ids.contains("tie-first"))
            XCTAssertFalse(ids.contains("renewal"))
        }
    }

    func testAllRecommendedExist() {
        for eu in [true, false] {
            for stage in Stage.allCases {
                for id in PlanBuilder.recommended(for: Situation(isEUCitizen: eu, stage: stage)) {
                    XCTAssertNotNil(Catalog.tramite(id: id))
                }
            }
        }
    }
}

final class FormHelperTests: XCTestCase {
    func testEXSections() {
        var d = PersonalData()
        d.firstSurname = "García"
        d.name = "Ana"
        d.nie = "x1234567l"
        let sections = FormHelper.sections(for: .ex15, data: d)
        let fields = sections.flatMap(\.fields)
        XCTAssertEqual(fields.first { $0.id == "surname1" }?.value, "GARCÍA")
        XCTAssertEqual(fields.first { $0.id == "nie" }?.value, "X-1234567-L")
    }

    func testTasaUsesPassportWithoutNIE() {
        var d = PersonalData()
        d.passport = "fe1234567"
        let f = FormHelper.sections(for: .tasa790012, data: d).flatMap(\.fields)
        XCTAssertEqual(f.first { $0.id == "nif" }?.value, "FE1234567")
    }
}


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
        XCTAssertEqual(last - apr1 + 1, 30)
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

final class AbsenceTests: XCTestCase {
    let start = Day(year: 2021, month: 1, day: 1)

    func testTravelDaysCountAsSpain() {
        // Поездка 1–10 марта: отсутствие 2–9 марта = 8 дней.
        let trip = Stay(country: "FR", start: Day(year: 2026, month: 3, day: 1), end: Day(year: 2026, month: 3, day: 10))
        let p = SpainPresence(stays: [trip], since: start, through: Day(year: 2026, month: 12, day: 31))
        XCTAssertEqual(p.absentDays(from: Day(year: 2026, month: 1, day: 1), to: Day(year: 2026, month: 12, day: 31)), 8)
        XCTAssertEqual(p.gaps(from: start, to: Day(year: 2026, month: 12, day: 31)).map(\.dayCount), [8])
        // Однодневная и двухдневная поездки не дают отсутствия.
        let short = Stay(country: "PT", start: Day(year: 2026, month: 5, day: 1), end: Day(year: 2026, month: 5, day: 2))
        XCTAssertEqual(SpainPresence(stays: [short], since: start, through: Day(year: 2026, month: 12, day: 31)).absent.sorted.count, 0)
    }

    func testLongTermLimits() {
        let today = Day(year: 2026, month: 6, day: 1)
        let ok = Stay(country: "UA", start: Day(year: 2024, month: 1, day: 1), end: Day(year: 2024, month: 3, day: 1))
        XCTAssertEqual(Absences.check(.longTerm, stays: [ok], residenceStart: start, today: today).status, .ok)

        // Одно отсутствие длиннее 6 месяцев.
        let long = Stay(country: "UA", start: Day(year: 2024, month: 1, day: 1), end: Day(year: 2024, month: 8, day: 1))
        XCTAssertEqual(Absences.check(.longTerm, stays: [long], residenceStart: start, today: today).status, .broken)

        // Две поездки по 5 месяцев: каждая в пределах, но сумма > 10 месяцев.
        let a = Stay(country: "UA", start: Day(year: 2023, month: 1, day: 1), end: Day(year: 2023, month: 6, day: 15))
        let b = Stay(country: "UA", start: Day(year: 2025, month: 1, day: 1), end: Day(year: 2025, month: 6, day: 15))
        let check = Absences.check(.longTerm, stays: [a, b], residenceStart: start, today: today)
        XCTAssertEqual(check.lines[0].value, 164)
        XCTAssertEqual(check.lines[0].status, .close)
        XCTAssertEqual(check.lines[1].value, 328)
        XCTAssertEqual(check.lines[1].status, .broken)
    }

    func testLongTermWindowIsFiveYears() {
        // Старое отсутствие за пределами 5 лет не учитывается.
        let old = Stay(country: "UA", start: Day(year: 2018, month: 1, day: 1), end: Day(year: 2018, month: 12, day: 1))
        let check = Absences.check(.longTerm, stays: [old], residenceStart: Day(year: 2017, month: 1, day: 1), today: Day(year: 2026, month: 1, day: 1))
        XCTAssertEqual(check.status, .ok)
    }

    func testNonLucrativeNeeds183DaysPerYear() {
        let resStart = Day(year: 2025, month: 1, day: 1)
        // В первом году за границей 200 дней → в Испании меньше 183.
        let away = Stay(country: "RU", start: Day(year: 2025, month: 2, day: 1), end: Day(year: 2025, month: 2, day: 1).adding(201))
        let check = Absences.check(.nonLucrativeRenewal, stays: [away], residenceStart: resStart, today: Day(year: 2026, month: 3, day: 1))
        XCTAssertEqual(check.lines.first?.status, .broken)
        XCTAssertEqual(check.lines.count, 2)
        // Текущий год ещё можно добрать.
        XCTAssertEqual(check.lines.last?.status, .ok)
    }

    func testEUPermanentPerYear() {
        let away = Stay(country: "DE", start: Day(year: 2023, month: 2, day: 1), end: Day(year: 2023, month: 9, day: 1))
        let check = Absences.check(.euPermanent, stays: [away], residenceStart: start, today: Day(year: 2026, month: 1, day: 1))
        XCTAssertEqual(check.status, .broken)
    }

    func testLatestReturn() {
        let departure = Day(year: 2026, month: 1, day: 10)
        let last = Absences.latestReturn(.longTerm, stays: [], residenceStart: start, departure: departure)
        // 180 дней отсутствия + день выезда + день возвращения.
        XCTAssertEqual(last.map { $0 - departure }, 181)
    }
}

final class DayLedgerTests: XCTestCase {
    let today = Day(year: 2026, month: 7, day: 1)

    func testResidentSpainNotInSchengenCount() {
        let since = Day(year: 2024, month: 1, day: 1)
        let fr = Stay(country: "FR", start: Day(year: 2026, month: 6, day: 1), end: Day(year: 2026, month: 6, day: 10))
        let ledger = DayLedger(stays: [fr], mode: .resident(since: since), today: today)
        XCTAssertEqual(ledger.schengenUsed, 10)
        // Год до 1 июля: 182 дня, минус 8 дней во Франции (дни выезда и возвращения — в Испании).
        XCTAssertEqual(ledger.daysInSpain(year: 2026), 182 - 8)
        XCTAssertNil(ledger.evaluate(trip: Stay(country: "ES", start: today, end: today.adding(100))))
    }

    func testVisitorCountsSpainExplicitly() {
        let es = Stay(country: "ES", start: Day(year: 2026, month: 5, day: 1), end: Day(year: 2026, month: 6, day: 29))
        let ledger = DayLedger(stays: [es], mode: .visitor, today: today)
        XCTAssertEqual(ledger.schengenUsed, 60)
        XCTAssertEqual(ledger.daysInSpain(year: 2026), 60)
        XCTAssertEqual(ledger.evaluate(trip: Stay(country: "ES", start: today, end: today.adding(40)))?.isAllowed, false)
    }
}
