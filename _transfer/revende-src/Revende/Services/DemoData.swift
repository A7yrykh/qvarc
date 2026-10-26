#if DEBUG
import SwiftData
import UIKit

/// Демо-данные для скриншотов App Store (только Debug):
/// `-demoData -demoPhotos /путь/к/фото -screen inventory|item|studio|listing|calculator|summary`.
enum DemoData {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("-demoData") }
    static var screen: String? { isEnabled ? UserDefaults.standard.string(forKey: "screen") : nil }

    @MainActor
    static func seed(_ context: ModelContext) {
        guard isEnabled else { return }
        try? context.delete(model: ItemPhoto.self)
        try? context.delete(model: Item.self)

        let photosDir = UserDefaults.standard.string(forKey: "demoPhotos")
        func photo(_ number: Int) -> Data? {
            guard let photosDir, let image = UIImage(contentsOfFile: "\(photosDir)/\(number).jpg") else { return nil }
            return image.normalized(maxSide: 1200).jpegForStorage()
        }
        let calendar = Calendar.current
        func daysAgo(_ days: Int) -> Date { calendar.date(byAdding: .day, value: -days, to: .now) ?? .now }

        struct Stock {
            var name, brand, category, size, color: String
            var condition: ItemCondition
            var cost, list: Decimal
            var platforms: Set<Platform>
            var listedDaysAgo: Int
            var photo: Int?
        }
        let stock = [
            Stock(name: "Chaqueta vaquera", brand: "Levante Denim", category: "Chaquetas", size: "M", color: "Azul",
                  condition: .veryGood, cost: 8, list: 35, platforms: [.vinted], listedDaysAgo: 3, photo: 1),
            Stock(name: "Zapatillas de piel", brand: "", category: "Zapatillas", size: "42", color: "Blanco",
                  condition: .good, cost: 15, list: 45, platforms: [.vinted, .wallapop], listedDaysAgo: 9, photo: 2),
            Stock(name: "Bolso de piel", brand: "", category: "Bolsos", size: "", color: "Marrón",
                  condition: .veryGood, cost: 20, list: 60, platforms: [.wallapop], listedDaysAgo: 34, photo: 3),
            Stock(name: "Jersey de lana", brand: "", category: "Jerséis", size: "L", color: "Verde",
                  condition: .newWithoutTags, cost: 6, list: 22, platforms: [.vinted], listedDaysAgo: 1, photo: 4),
        ]
        for (index, s) in stock.enumerated() {
            let item = Item(name: s.name)
            item.brand = s.brand
            item.category = s.category
            item.size = s.size
            item.color = s.color
            item.condition = s.condition
            item.purchaseCost = s.cost
            item.purchaseDate = daysAgo(s.listedDaysAgo + 5)
            item.listPrice = s.list
            item.packaging = Decimal(string: "0.5")!
            item.listedPlatforms = s.platforms
            item.status = .listed
            item.listedAt = daysAgo(s.listedDaysAgo)
            item.createdAt = daysAgo(s.listedDaysAgo) - Double(index)
            let text = ListingTemplate.make(item.facts, for: s.platforms.contains(.vinted) ? .vinted : .wallapop)
            item.listingTitle = text.title
            item.listingDescription = text.description
            item.listingHashtags = text.hashtags
            context.insert(item)
            if let number = s.photo, let data = photo(number) {
                item.photos.append(ItemPhoto(data: data, order: 0))
            }
        }

        // Продажи этого года: Vinted близко к порогу DAC7, Wallapop далеко.
        let soldNames = ["Vestido de verano", "Vaqueros", "Camisa de lino", "Botines", "Abrigo", "Sudadera",
                         "Falda plisada", "Gafas de sol", "Cinturón de piel", "Chaqueta de punto", "Pantalón chino",
                         "Mochila", "Blazer", "Camiseta vintage", "Bufanda", "Sandalias", "Polo", "Cazadora",
                         "Bolso bandolera", "Vestido de fiesta", "Zapatillas running", "Gorra", "Pijama", "Libros"]
        let year = calendar.component(.year, from: .now)
        let todayOfYear = calendar.ordinality(of: .day, in: .year, for: .now) ?? 300
        for (index, name) in soldNames.enumerated() {
            let item = Item(name: name)
            let platform: Platform = index % 4 == 3 ? .wallapop : .vinted
            let cost = Decimal(4 + (index * 7) % 18)
            let price = cost + Decimal(12 + (index * 5) % 40)
            let soldDay = max(1, todayOfYear - index * (todayOfYear / soldNames.count))
            let startOfYear = calendar.date(from: DateComponents(year: year, month: 1, day: 1)) ?? .now
            let soldAt = calendar.date(byAdding: .day, value: soldDay - 1, to: startOfYear) ?? .now
            item.purchaseCost = cost
            item.purchaseDate = calendar.date(byAdding: .day, value: -(6 + index % 20), to: soldAt)
            item.listPrice = price
            item.packaging = Decimal(string: "0.5")!
            item.soldPlatform = platform
            item.salePrice = price
            item.soldAt = soldAt
            item.status = .sold
            item.createdAt = soldAt
            context.insert(item)
        }
        try? context.save()
    }
}
#endif
