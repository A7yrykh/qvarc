import Foundation
import StoreKit

/// Подписка Pro (годовая) через StoreKit 2.
@MainActor
final class PurchaseManager: ObservableObject {
    static let shared = PurchaseManager()

    @Published private(set) var product: Product?
    @Published private(set) var isPro: Bool
    @Published private(set) var isPurchasing = false
    @Published private(set) var isEligibleForTrial = false
    @Published var message: String?

    private var updates: Task<Void, Never>?

    private init() {
        isPro = UserDefaults.standard.bool(forKey: Prefs.isPro)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-proUnlocked") { isPro = true }
        #endif
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                await self?.handle(result)
            }
        }
        Task { await load() }
    }

    func load() async {
        if product == nil {
            product = try? await Product.products(for: [AppInfo.proYearlyID]).first
        }
        if let subscription = product?.subscription {
            isEligibleForTrial = subscription.introductoryOffer != nil
                && (await subscription.isEligibleForIntroOffer)
        }
        await refreshEntitlements()
    }

    func purchase() async {
        guard let product, !isPurchasing else { return }
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            switch try await product.purchase() {
            case .success(let result):
                await handle(result)
            case .pending:
                message = String(localized: "The purchase is waiting for approval.")
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
        if !isPro { message = String(localized: "No active subscription was found for this Apple ID.") }
    }

    private func refreshEntitlements() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               transaction.productID == AppInfo.proYearlyID,
               transaction.revocationDate == nil {
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
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-proUnlocked") { return }
        #endif
        isPro = value
        UserDefaults.standard.set(value, forKey: Prefs.isPro)
        if !value {
            LocationTracker.shared.stop()
        }
    }
}
