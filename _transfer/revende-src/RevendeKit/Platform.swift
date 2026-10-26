import Foundation

/// Площадки, на которых продаёт пользователь.
/// Комиссии, лимиты и тарифы покупателя — по состоянию на 10.2026; перед релизом перепроверить.
public enum Platform: String, CaseIterable, Codable, Identifiable, Sendable {
    case vinted
    case wallapop
    case ebay
    case milanuncios
    case other

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .vinted: "Vinted"
        case .wallapop: "Wallapop"
        case .ebay: "eBay"
        case .milanuncios: "Milanuncios"
        case .other: String(localized: "Otra")
        }
    }

    public var limits: ListingLimits {
        switch self {
        // Vinted: лимиты не подтверждены официальным источником.
        case .vinted: ListingLimits(title: 100, description: 2000, photos: 20, usesHashtags: true)
        // Wallapop: заголовок 50, описание 650, до 10 фото (sellygenie.com, 2026).
        case .wallapop: ListingLimits(title: 50, description: 650, photos: 10, usesHashtags: false)
        case .ebay: ListingLimits(title: 80, description: 4000, photos: 24, usesHashtags: false)
        case .milanuncios: ListingLimits(title: 70, description: 4000, photos: 10, usesHashtags: false)
        case .other: ListingLimits(title: 100, description: 4000, photos: 20, usesHashtags: true)
        }
    }

    /// Комиссия частного продавца по умолчанию. На Vinted и Wallapop платит покупатель,
    /// у eBay и Pro-аккаунтов пользователь задаёт свою в настройках.
    public var defaultSellerFee: FeeRule { .zero }

    /// Сколько примерно доплатит покупатель за защиту сделки (без доставки).
    /// Нужно, чтобы продавец видел итоговую цену глазами покупателя.
    public func buyerProtectionFee(for price: Decimal) -> Decimal? {
        guard price > 0 else { return nil }
        switch self {
        case .vinted:
            // 0,70 € + 5 % цены.
            return Money.round(Decimal(string: "0.70")! + price * 5 / 100)
        case .wallapop:
            // Wallapop Protect: 1,69 € до 13 €; 0,69 € + 7,5 % до 657 €; 50 € до 2 500 €.
            if price <= 13 { return Decimal(string: "1.69")! }
            if price <= 657 { return Money.round(Decimal(string: "0.69")! + price * Decimal(string: "7.5")! / 100) }
            if price <= 2500 { return 50 }
            return nil
        case .ebay, .milanuncios, .other:
            return nil
        }
    }

    /// Ссылка на создание объявления; если приложение площадки установлено, iOS откроет его.
    public var newListingURL: URL? {
        switch self {
        case .vinted: URL(string: "https://www.vinted.es/items/new")
        case .wallapop: URL(string: "https://es.wallapop.com/app/catalog/upload")
        case .ebay: URL(string: "https://www.ebay.es/sl/sell")
        case .milanuncios: URL(string: "https://www.milanuncios.com/publicar-anuncios-gratis/")
        case .other: nil
        }
    }
}

public struct ListingLimits: Equatable, Sendable {
    public var title: Int
    public var description: Int
    public var photos: Int
    public var usesHashtags: Bool

    public init(title: Int, description: Int, photos: Int, usesHashtags: Bool) {
        self.title = title
        self.description = description
        self.photos = photos
        self.usesHashtags = usesHashtags
    }
}

/// Комиссия продавца: процент + фикс, но не меньше минимума.
public struct FeeRule: Codable, Equatable, Hashable, Sendable {
    /// Процент, например 6,5 — это 6,5 %.
    public var percent: Decimal
    public var fixed: Decimal
    public var minimum: Decimal

    public init(percent: Decimal = 0, fixed: Decimal = 0, minimum: Decimal = 0) {
        self.percent = percent
        self.fixed = fixed
        self.minimum = minimum
    }

    public static let zero = FeeRule()

    public var isZero: Bool { percent == 0 && fixed == 0 && minimum == 0 }

    public func fee(for price: Decimal) -> Decimal {
        guard price > 0 else { return 0 }
        let raw = Money.round(price * percent / 100 + fixed)
        return max(raw, minimum)
    }
}
