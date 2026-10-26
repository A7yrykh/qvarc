import XCTest
@testable import RevendeKit

final class ProfitTests: XCTestCase {
    func testBreakdownWithoutPlatformFee() {
        let input = ProfitInput(salePrice: 25, purchaseCost: 8, extraCosts: 2, packaging: d("0.5"), promotion: 1)
        let b = ProfitCalculator.breakdown(input)
        XCTAssertEqual(b.platformFee, 0)
        XCTAssertEqual(b.netProfit, d("13.5"))
        XCTAssertEqual(b.marginPercent, 54)
        XCTAssertEqual(b.roiPercent, 135)
    }

    func testBreakdownWithPercentAndFixedFee() {
        let fee = FeeRule(percent: d("6.5"), fixed: d("0.35"))
        let input = ProfitInput(salePrice: 40, purchaseCost: 15, shippingBySeller: 4, feeRule: fee)
        let b = ProfitCalculator.breakdown(input)
        XCTAssertEqual(b.platformFee, d("2.95"))
        XCTAssertEqual(b.payout, d("37.05"))
        XCTAssertEqual(b.netProfit, d("18.05"))
        XCTAssertEqual(b.marginPercent, d("45.1"))
        XCTAssertEqual(b.roiPercent, d("120.3"))
    }

    func testFreeItemHasNoROI() {
        let b = ProfitCalculator.breakdown(ProfitInput(salePrice: 10))
        XCTAssertNil(b.roiPercent)
        XCTAssertEqual(b.netProfit, 10)
        XCTAssertNil(ProfitCalculator.breakdown(ProfitInput()).marginPercent)
    }

    func testMinimumPriceByPercent() {
        let input = ProfitInput(purchaseCost: 20, feeRule: FeeRule(percent: 10, minimum: 1))
        XCTAssertEqual(ProfitCalculator.minimumPrice(forProfit: 5, input), d("27.78"))
    }

    func testMinimumPriceByMinimumFee() {
        let input = ProfitInput(purchaseCost: 10, feeRule: FeeRule(percent: 1, minimum: 3))
        XCTAssertEqual(ProfitCalculator.minimumPrice(forProfit: 5, input), 18)
    }

    func testBreakEvenWithoutFee() {
        XCTAssertEqual(ProfitCalculator.minimumPrice(forProfit: 0, ProfitInput(purchaseCost: 10)), 10)
        XCTAssertNil(ProfitCalculator.minimumPrice(forProfit: 0, ProfitInput(feeRule: FeeRule(percent: 100))))
    }

    func testPriceForMargin() {
        XCTAssertEqual(ProfitCalculator.price(forMargin: 50, ProfitInput(purchaseCost: 10)), 20)
        let withFee = ProfitInput(purchaseCost: 10, feeRule: FeeRule(percent: 10))
        XCTAssertEqual(ProfitCalculator.price(forMargin: 50, withFee), 25)
        XCTAssertNil(ProfitCalculator.price(forMargin: 95, withFee))
    }

    func testScenarios() {
        let s = ProfitCalculator.scenarios(listPrice: 30, discounts: [0, 10, 20], ProfitInput(purchaseCost: 10))
        XCTAssertEqual(s.map(\.price), [30, 27, 24])
        XCTAssertEqual(s.map(\.netProfit), [20, 17, 14])
    }
}

final class PlatformTests: XCTestCase {
    func testBuyerProtection() {
        XCTAssertEqual(Platform.vinted.buyerProtectionFee(for: 20), d("1.70"))
        XCTAssertEqual(Platform.wallapop.buyerProtectionFee(for: 10), d("1.69"))
        XCTAssertEqual(Platform.wallapop.buyerProtectionFee(for: 100), d("8.19"))
        XCTAssertEqual(Platform.wallapop.buyerProtectionFee(for: 1000), 50)
        XCTAssertNil(Platform.wallapop.buyerProtectionFee(for: 3000))
        XCTAssertNil(Platform.ebay.buyerProtectionFee(for: 10))
    }

    func testConditionLabels() {
        XCTAssertEqual(ItemCondition.veryGood.label(on: .vinted), "Muy bueno")
        XCTAssertEqual(ItemCondition.veryGood.label(on: .wallapop), "Como nuevo")
        XCTAssertEqual(ItemCondition.satisfactory.label(on: .ebay), "Usado - Aceptable")
    }

    func testFeeMinimum() {
        let rule = FeeRule(percent: 5, minimum: 1)
        XCTAssertEqual(rule.fee(for: 10), 1)
        XCTAssertEqual(rule.fee(for: 100), 5)
        XCTAssertEqual(rule.fee(for: 0), 0)
    }
}

final class MoneyTests: XCTestCase {
    func testParse() {
        XCTAssertEqual(Money.parse("12,50"), d("12.5"))
        XCTAssertEqual(Money.parse("12.5"), d("12.5"))
        XCTAssertEqual(Money.parse("1.234,50 €"), d("1234.5"))
        XCTAssertNil(Money.parse(""))
        XCTAssertNil(Money.parse("abc"))
        XCTAssertNil(Money.parse("1.2.3"))
    }

    func testPlain() {
        XCTAssertEqual(Money.plain(d("1234.5")), "1234,50")
        XCTAssertEqual(Money.plain(-3), "-3,00")
    }
}

final class DAC7Tests: XCTestCase {
    func testLevels() {
        XCTAssertEqual(DAC7.level(count: 10, total: 100), .below)
        XCTAssertEqual(DAC7.level(count: 24, total: 0), .near)
        XCTAssertEqual(DAC7.level(count: 29, total: 1999), .near)
        XCTAssertEqual(DAC7.level(count: 5, total: 2000), .near)
        XCTAssertEqual(DAC7.level(count: 5, total: d("2000.01")), .reportable)
        XCTAssertEqual(DAC7.level(count: 30, total: 0), .reportable)
    }

    func testStatusPerPlatformAndYear() {
        let sales = [
            SaleRecord(platform: .vinted, date: date(2026, 1, 10), price: 100),
            SaleRecord(platform: .vinted, date: date(2026, 6, 1), price: 200),
            SaleRecord(platform: .vinted, date: date(2026, 12, 31), price: 305, platformFee: 5),
            SaleRecord(platform: .vinted, date: date(2025, 12, 31), price: 999),
            SaleRecord(platform: .wallapop, date: date(2026, 3, 3), price: 50),
        ]
        let vinted = DAC7.status(platform: .vinted, year: 2026, sales: sales, calendar: utc)
        XCTAssertEqual(vinted.salesCount, 3)
        XCTAssertEqual(vinted.totalAmount, 600)
        XCTAssertEqual(vinted.level, .below)
        XCTAssertEqual(vinted.salesRemaining, 27)
        XCTAssertEqual(vinted.amountRemaining, 1400)
        XCTAssertEqual(vinted.progress, 0.3, accuracy: 0.0001)

        let all = DAC7.statuses(year: 2026, sales: sales, calendar: utc)
        XCTAssertEqual(all.map(\.platform), [.vinted, .wallapop])
    }
}

final class ListingTests: XCTestCase {
    let jacket = ListingFacts(
        name: "Chaqueta vaquera", brand: "Levi's", category: "Chaquetas",
        size: "M", color: "Azul", condition: .veryGood
    )

    func testTitle() {
        XCTAssertEqual(ListingTemplate.title(jacket, for: .vinted), "Chaqueta vaquera Levi's talla M azul")
        XCTAssertEqual(ListingTemplate.title(jacket, for: .wallapop), "Chaqueta vaquera Levi's talla M azul")
    }

    func testTitleDropsPartsThatDoNotFit() {
        var facts = jacket
        facts.name = "Chaqueta vaquera oversize con forro de borrego"
        let title = ListingTemplate.title(facts, for: .wallapop)
        XCTAssertLessThanOrEqual(title.count, 50)
        XCTAssertTrue(title.hasPrefix("Chaqueta vaquera oversize con forro de borrego"))
    }

    func testFit() {
        XCTAssertEqual(ListingTemplate.fit("Zapatillas Nike Air Max 90 blancas", limit: 20, ellipsis: false), "Zapatillas Nike Air")
        XCTAssertEqual(ListingTemplate.fit("corto", limit: 20), "corto")
        XCTAssertLessThanOrEqual(ListingTemplate.fit(String(repeating: "palabra ", count: 200), limit: 650).count, 650)
    }

    func testHashtags() {
        XCTAssertEqual(ListingTemplate.hashtags(jacket), ["#levis", "#chaquetas", "#chaqueta", "#vaquera", "#azul"])
    }

    func testDescriptionPerPlatform() {
        let vinted = ListingTemplate.make(jacket, for: .vinted)
        XCTAssertTrue(vinted.description.contains("Estado: Muy bueno"))
        XCTAssertTrue(vinted.fullDescription(for: .vinted).hasSuffix("#azul"))

        let wallapop = ListingTemplate.make(jacket, for: .wallapop)
        XCTAssertTrue(wallapop.description.contains("Estado: Como nuevo"))
        XCTAssertTrue(wallapop.hashtags.isEmpty)
        XCTAssertLessThanOrEqual(wallapop.fullDescription(for: .wallapop).count, 650)
    }
}

final class ReportTests: XCTestCase {
    func testCSVAndSummary() {
        let b = ProfitCalculator.breakdown(ProfitInput(salePrice: 15, purchaseCost: 5))
        let lines = [
            SaleLine(date: date(2026, 3, 5), itemName: "Camiseta", platform: .vinted, purchaseDate: date(2026, 2, 25), breakdown: b),
            SaleLine(date: date(2026, 3, 1), itemName: "Bolso; piel", platform: .wallapop, breakdown: b),
        ]
        let csv = SalesReport.csv(lines, timeZone: TimeZone(identifier: "UTC")!)
        XCTAssertTrue(csv.hasPrefix("\u{FEFF}"))
        let rows = csv.replacingOccurrences(of: "\u{FEFF}", with: "").components(separatedBy: "\r\n")
        XCTAssertEqual(rows[0], "Fecha venta;Artículo;Plataforma;Fecha compra;Coste compra;Precio venta;Comisión;Gastos venta;Beneficio neto")
        XCTAssertEqual(rows[1], "2026-03-01;\"Bolso; piel\";Wallapop;;5,00;15,00;0,00;0,00;10,00")
        XCTAssertEqual(rows[2], "2026-03-05;Camiseta;Vinted;2026-02-25;5,00;15,00;0,00;0,00;10,00")

        let summary = SalesReport.summary(lines, calendar: utc)
        XCTAssertEqual(summary.count, 2)
        XCTAssertEqual(summary.revenue, 30)
        XCTAssertEqual(summary.netProfit, 20)
        XCTAssertEqual(summary.marginPercent, d("66.7"))
        XCTAssertEqual(summary.averageDaysToSell, 8)
    }
}

// MARK: - Helpers

private func d(_ s: String) -> Decimal { Decimal(string: s, locale: Locale(identifier: "en_US_POSIX"))! }

private var utc: Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}

private func date(_ y: Int, _ m: Int, _ day: Int) -> Date {
    utc.date(from: DateComponents(year: y, month: m, day: day, hour: 12))!
}
