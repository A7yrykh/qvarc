import Foundation

/// Строка отчёта о продаже.
public struct SaleLine: Equatable, Sendable {
    public var date: Date
    public var itemName: String
    public var platform: Platform
    public var purchaseDate: Date?
    public var breakdown: ProfitBreakdown

    public init(date: Date, itemName: String, platform: Platform, purchaseDate: Date? = nil, breakdown: ProfitBreakdown) {
        self.date = date
        self.itemName = itemName
        self.platform = platform
        self.purchaseDate = purchaseDate
        self.breakdown = breakdown
    }
}

public struct SalesSummary: Equatable, Sendable {
    public var count: Int
    public var revenue: Decimal
    public var fees: Decimal
    public var costs: Decimal
    public var netProfit: Decimal
    /// Средняя маржа по выручке, %. nil, если продаж нет.
    public var marginPercent: Decimal?
    /// Средний срок от покупки до продажи, дней (по вещам, где известна дата покупки).
    public var averageDaysToSell: Int?
}

public enum SalesReport {
    public static func summary(_ lines: [SaleLine], calendar: Calendar = .current) -> SalesSummary {
        let revenue = lines.reduce(Decimal(0)) { $0 + $1.breakdown.salePrice }
        let fees = lines.reduce(Decimal(0)) { $0 + $1.breakdown.platformFee }
        let costs = lines.reduce(Decimal(0)) { $0 + $1.breakdown.sellingCosts + $1.breakdown.invested }
        let net = lines.reduce(Decimal(0)) { $0 + $1.breakdown.netProfit }
        let days = lines.compactMap { line -> Int? in
            guard let bought = line.purchaseDate else { return nil }
            return calendar.dateComponents([.day], from: calendar.startOfDay(for: bought), to: calendar.startOfDay(for: line.date)).day
        }
        return SalesSummary(
            count: lines.count,
            revenue: revenue,
            fees: fees,
            costs: costs,
            netProfit: net,
            marginPercent: revenue > 0 ? Money.round(net / revenue * 100, scale: 1) : nil,
            averageDaysToSell: days.isEmpty ? nil : days.reduce(0, +) / days.count
        )
    }

    /// CSV для испанского Excel: разделитель «;», десятичная запятая, UTF-8 с BOM.
    public static func csv(_ lines: [SaleLine], timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"

        var rows = [[
            "Fecha venta", "Artículo", "Plataforma", "Fecha compra", "Coste compra",
            "Precio venta", "Comisión", "Gastos venta", "Beneficio neto",
        ]]
        for line in lines.sorted(by: { $0.date < $1.date }) {
            let b = line.breakdown
            rows.append([
                formatter.string(from: line.date),
                line.itemName,
                line.platform.displayName,
                line.purchaseDate.map { formatter.string(from: $0) } ?? "",
                Money.plain(b.invested),
                Money.plain(b.salePrice),
                Money.plain(b.platformFee),
                Money.plain(b.sellingCosts),
                Money.plain(b.netProfit),
            ])
        }
        return "\u{FEFF}" + rows.map { $0.map(escape).joined(separator: ";") }.joined(separator: "\r\n") + "\r\n"
    }

    static func escape(_ field: String) -> String {
        guard field.contains(where: { $0 == ";" || $0 == "\"" || $0 == "\n" || $0 == "\r" }) else { return field }
        return "\"" + field.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
