import Foundation

/// Продажа для учёта DAC7 и отчётов.
public struct SaleRecord: Equatable, Sendable {
    public var platform: Platform
    public var date: Date
    /// Цена продажи (без доставки и без платы покупателя за защиту).
    public var price: Decimal
    public var platformFee: Decimal

    public init(platform: Platform, date: Date, price: Decimal, platformFee: Decimal = 0) {
        self.platform = platform
        self.date = date
        self.price = price
        self.platformFee = platformFee
    }

    /// Вознаграждение в смысле DAC7: за вычетом комиссий, удержанных площадкой.
    public var consideration: Decimal { price - platformFee }
}

/// Директива DAC7 (в Испании — модель 238): площадка сообщает о продавце,
/// если за год у неё было 30 и более продаж или сумма больше 2 000 €.
/// Пороги считаются отдельно для каждой площадки.
public enum DAC7 {
    public static let salesThreshold = 30
    public static let amountThreshold: Decimal = 2000
    /// С какой доли порога предупреждаем.
    public static let warningRatio: Decimal = Decimal(string: "0.8")!

    public enum Level: String, Sendable {
        case below
        case near
        case reportable
    }

    public struct Status: Equatable, Sendable, Identifiable {
        public var platform: Platform
        public var year: Int
        public var salesCount: Int
        public var totalAmount: Decimal
        public var level: Level

        public var id: String { "\(platform.rawValue)-\(year)" }
        public var salesRemaining: Int { max(DAC7.salesThreshold - salesCount, 0) }
        public var amountRemaining: Decimal { max(DAC7.amountThreshold - totalAmount, 0) }

        /// Насколько близко к ближайшему из двух порогов, 0…1.
        public var progress: Double {
            let bySales = Double(salesCount) / Double(DAC7.salesThreshold)
            let byAmount = NSDecimalNumber(decimal: totalAmount / DAC7.amountThreshold).doubleValue
            return min(max(bySales, byAmount), 1)
        }
    }

    public static func status(
        platform: Platform,
        year: Int,
        sales: [SaleRecord],
        calendar: Calendar = .current
    ) -> Status {
        let relevant = sales.filter {
            $0.platform == platform && calendar.component(.year, from: $0.date) == year
        }
        let total = relevant.reduce(Decimal(0)) { $0 + $1.consideration }
        return Status(
            platform: platform,
            year: year,
            salesCount: relevant.count,
            totalAmount: total,
            level: level(count: relevant.count, total: total)
        )
    }

    /// Статусы по всем площадкам, где за год была хотя бы одна продажа.
    public static func statuses(year: Int, sales: [SaleRecord], calendar: Calendar = .current) -> [Status] {
        Platform.allCases
            .map { status(platform: $0, year: year, sales: sales, calendar: calendar) }
            .filter { $0.salesCount > 0 }
    }

    public static func level(count: Int, total: Decimal) -> Level {
        if count >= salesThreshold || total > amountThreshold { return .reportable }
        let countWarning = Decimal(salesThreshold) * warningRatio
        if Decimal(count) >= countWarning || total >= amountThreshold * warningRatio { return .near }
        return .below
    }
}
