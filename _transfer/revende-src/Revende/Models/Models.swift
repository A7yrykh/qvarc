import Foundation
import SwiftData

enum ItemStatus: String, Codable, CaseIterable, Identifiable {
    case draft
    case listed
    case reserved
    case sold
    case archived

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .draft: String(localized: "Borrador")
        case .listed: String(localized: "En venta")
        case .reserved: String(localized: "Reservado")
        case .sold: String(localized: "Vendido")
        case .archived: String(localized: "Retirado")
        }
    }

    var symbol: String {
        switch self {
        case .draft: "pencil"
        case .listed: "tag"
        case .reserved: "clock"
        case .sold: "checkmark.seal.fill"
        case .archived: "archivebox"
        }
    }

    /// Вещь ещё на складе и учитывается в его стоимости.
    var isInStock: Bool { self == .draft || self == .listed || self == .reserved }
}

/// Вещь на продажу: от закупки до продажи.
@Model
final class Item {
    var name: String
    var brand: String
    var category: String
    var size: String
    var color: String
    var material: String
    var notes: String
    var conditionRaw: String?
    var statusRaw: String
    var createdAt: Date

    // Закупка
    var purchaseCost: Decimal
    var extraCosts: Decimal
    var purchaseDate: Date?
    var purchaseSource: String

    // Объявление
    var listPrice: Decimal
    var listedPlatformsRaw: [String]
    var listedAt: Date?
    var listingTitle: String
    var listingDescription: String
    var listingHashtags: [String]

    // Продажа
    var soldPlatformRaw: String?
    var salePrice: Decimal
    var shippingBySeller: Decimal
    var packaging: Decimal
    var promotion: Decimal
    var platformFee: Decimal
    var soldAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \ItemPhoto.item)
    var photos: [ItemPhoto] = []

    init(name: String = "") {
        self.name = name
        brand = ""
        category = ""
        size = ""
        color = ""
        material = ""
        notes = ""
        conditionRaw = nil
        statusRaw = ItemStatus.draft.rawValue
        createdAt = .now
        purchaseCost = 0
        extraCosts = 0
        purchaseDate = .now
        purchaseSource = ""
        listPrice = 0
        listedPlatformsRaw = []
        listedAt = nil
        listingTitle = ""
        listingDescription = ""
        listingHashtags = []
        soldPlatformRaw = nil
        salePrice = 0
        shippingBySeller = 0
        packaging = 0
        promotion = 0
        platformFee = 0
        soldAt = nil
    }

    var status: ItemStatus {
        get { ItemStatus(rawValue: statusRaw) ?? .draft }
        set { statusRaw = newValue.rawValue }
    }

    var condition: ItemCondition? {
        get { conditionRaw.flatMap(ItemCondition.init(rawValue:)) }
        set { conditionRaw = newValue?.rawValue }
    }

    var listedPlatforms: Set<Platform> {
        get { Set(listedPlatformsRaw.compactMap(Platform.init(rawValue:))) }
        set { listedPlatformsRaw = Platform.allCases.filter(newValue.contains).map(\.rawValue) }
    }

    var soldPlatform: Platform? {
        get { soldPlatformRaw.flatMap(Platform.init(rawValue:)) }
        set { soldPlatformRaw = newValue?.rawValue }
    }

    var sortedPhotos: [ItemPhoto] { photos.sorted { $0.order < $1.order } }
    var coverPhoto: ItemPhoto? { sortedPhotos.first }

    var displayName: String {
        let base = name.trimmed.isEmpty ? (category.trimmed.isEmpty ? String(localized: "Sin nombre") : category) : name
        return brand.trimmed.isEmpty || base.localizedCaseInsensitiveContains(brand) ? base : "\(base) · \(brand)"
    }

    var facts: ListingFacts {
        ListingFacts(
            name: name, brand: brand, category: category, size: size,
            color: color, material: material, condition: condition, notes: notes
        )
    }

    /// Прибыль: для проданной вещи — фактическая, для остальных — при цене объявления.
    func profitInput(feeRule: FeeRule) -> ProfitInput {
        if status == .sold {
            // Комиссия зафиксирована при продаже, поэтому передаём её как фикс.
            return ProfitInput(
                salePrice: salePrice, purchaseCost: purchaseCost, extraCosts: extraCosts,
                shippingBySeller: shippingBySeller, packaging: packaging, promotion: promotion,
                feeRule: FeeRule(fixed: platformFee)
            )
        }
        return ProfitInput(
            salePrice: listPrice, purchaseCost: purchaseCost, extraCosts: extraCosts,
            shippingBySeller: shippingBySeller, packaging: packaging, promotion: promotion,
            feeRule: feeRule
        )
    }

    var saleRecord: SaleRecord? {
        guard status == .sold, let platform = soldPlatform, let soldAt else { return nil }
        return SaleRecord(platform: platform, date: soldAt, price: salePrice, platformFee: platformFee)
    }

    var saleLine: SaleLine? {
        guard status == .sold, let platform = soldPlatform, let soldAt else { return nil }
        return SaleLine(
            date: soldAt, itemName: displayName, platform: platform, purchaseDate: purchaseDate,
            breakdown: ProfitCalculator.breakdown(profitInput(feeRule: .zero))
        )
    }

    /// Выставлена больше 30 дней назад и не продана.
    var isStale: Bool {
        guard status == .listed, let listedAt else { return false }
        return Date.now.timeIntervalSince(listedAt) > 30 * 24 * 3600
    }
}

@Model
final class ItemPhoto {
    @Attribute(.externalStorage) var data: Data
    var order: Int
    var createdAt: Date
    var item: Item?

    init(data: Data, order: Int) {
        self.data = data
        self.order = order
        createdAt = .now
    }
}
