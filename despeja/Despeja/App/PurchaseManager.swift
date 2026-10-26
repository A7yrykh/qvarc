import Foundation
import StoreKit

/// Подписка Despeja Pro (неделя или год) через StoreKit 2.
@MainActor
final class PurchaseManager: ObservableObject {
    static let weeklyID = "es.avsyrykh.despeja.pro.weekly"
    static let yearlyID = "es.avsyrykh.despeja.pro.yearly"
    static let productIDs = [weeklyID, yearlyID]

    @Published private(set) var products: [Product] = []
    @Published private(set) var isPro = false
    @Published private(set) var isPurchasing = false
    @Published private(set) var trialEligible = true
    @Published var message: String?

    private var updates: Task<Void, Never>?

    init() {
        isPro = UserDefaults.standard.bool(forKey: "pro.cached")
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                await self?.handle(result)
            }
        }
        Task { await load() }
    }

    var weekly: Product? { products.first { $0.id == Self.weeklyID } }
    var yearly: Product? { products.first { $0.id == Self.yearlyID } }

    func load() async {
        if products.isEmpty {
            products = (try? await Product.products(for: Self.productIDs)) ?? []
        }
        if let yearly {
            trialEligible = await yearly.subscription?.isEligibleForIntroOffer ?? false
        }
        await refreshEntitlements()
    }

    func purchase(_ product: Product) async {
        guard !isPurchasing else { return }
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            switch try await product.purchase() {
            case .success(let result):
                await handle(result)
            case .pending:
                message = String(localized: "La compra está pendiente de aprobación.")
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            message = error.localizedDescription
        }
    }

    func restore() async {
        do {
            try await AppStore.sync()
        } catch {
            message = error.localizedDescription
            return
        }
        await refreshEntitlements()
        if !isPro { message = String(localized: "No hay suscripciones activas con este Apple ID.") }
    }

    func refreshEntitlements() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, Self.productIDs.contains(t.productID), t.revocationDate == nil {
                if let exp = t.expirationDate, exp < Date() { continue }
                active = true
            }
        }
        setPro(active)
    }

    private func handle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else { return }
        await transaction.finish()
        await refreshEntitlements()
    }

    private func setPro(_ value: Bool) {
        isPro = value
        UserDefaults.standard.set(value, forKey: "pro.cached")
    }
}
