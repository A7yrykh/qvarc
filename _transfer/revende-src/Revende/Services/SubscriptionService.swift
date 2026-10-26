import Foundation
import StoreKit

/// Revende Pro: безлимит товаров, экспорт CSV, все фоны фотостудии.
@MainActor
final class SubscriptionService: ObservableObject {
    static let productIDs = ["es.avsyrykh.revende.pro.monthly", "es.avsyrykh.revende.pro.yearly"]
    /// Сколько товаров можно вести бесплатно.
    static let freeItemLimit = 30

    @Published private(set) var products: [Product] = []
    @Published private(set) var hasActiveSubscription = false
    @Published var lastError: String?
    #if DEBUG
    /// Переключатель в Ajustes, чтобы проверить Pro без App Store Connect.
    @Published var debugForcePro = false
    #endif

    private var updatesTask: Task<Void, Never>?

    init() {
        updatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                }
                await self?.refreshEntitlements()
            }
        }
    }

    var isPro: Bool {
        #if DEBUG
        if debugForcePro { return true }
        #endif
        return hasActiveSubscription
    }

    func load() async {
        do {
            products = try await Product.products(for: Self.productIDs).sorted { $0.price < $1.price }
        } catch {
            lastError = error.localizedDescription
        }
        await refreshEntitlements()
    }

    func refreshEntitlements() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               Self.productIDs.contains(transaction.productID),
               transaction.revocationDate == nil {
                active = true
            }
        }
        hasActiveSubscription = active
    }

    func purchase(_ product: Product) async {
        do {
            let result = try await product.purchase()
            if case .success(let verification) = result, case .verified(let transaction) = verification {
                await transaction.finish()
            }
            await refreshEntitlements()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func restore() async {
        do {
            try await AppStore.sync()
        } catch {
            lastError = error.localizedDescription
        }
        await refreshEntitlements()
    }
}
