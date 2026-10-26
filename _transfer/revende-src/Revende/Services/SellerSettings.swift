import Foundation

/// Настройки продавца: комиссии площадок (если у него Pro-аккаунт или eBay) и типовые расходы.
@MainActor
final class SellerSettings: ObservableObject {
    @Published var feeRules: [String: FeeRule] { didSet { save() } }
    @Published var defaultPackaging: Decimal { didSet { save() } }
    @Published var defaultPlatform: Platform { didSet { save() } }

    private let defaults: UserDefaults
    private static let key = "sellerSettings.v1"

    private struct Stored: Codable {
        var feeRules: [String: FeeRule]
        var defaultPackaging: Decimal
        var defaultPlatform: Platform
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(Stored.self, from: $0) }
        feeRules = stored?.feeRules ?? [:]
        defaultPackaging = stored?.defaultPackaging ?? 0
        defaultPlatform = stored?.defaultPlatform ?? .vinted
    }

    func feeRule(for platform: Platform) -> FeeRule {
        feeRules[platform.rawValue] ?? platform.defaultSellerFee
    }

    func setFeeRule(_ rule: FeeRule, for platform: Platform) {
        feeRules[platform.rawValue] = rule
    }

    private func save() {
        let stored = Stored(feeRules: feeRules, defaultPackaging: defaultPackaging, defaultPlatform: defaultPlatform)
        if let data = try? JSONEncoder().encode(stored) {
            defaults.set(data, forKey: Self.key)
        }
    }
}
