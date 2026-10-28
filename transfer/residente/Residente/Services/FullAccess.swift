import StoreKit

/// Разовая покупка «Residente completo» (StoreKit 2, non-consumable). ID остался от Trámites España.
@MainActor
final class FullAccess: ObservableObject {
    static let productID = "es.avsyrykh.tramites.pro"

    @Published private(set) var isUnlocked = false
    @Published private(set) var product: Product?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private var updates: Task<Void, Never>?

    static let shared = FullAccess()

    private init() {
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                    await self?.refreshEntitlements()
                }
            }
        }
        Task {
            await refreshEntitlements()
            await loadProduct()
        }
    }

    deinit { updates?.cancel() }

    func loadProduct() async {
        isLoading = true
        defer { isLoading = false }
        product = try? await Product.products(for: [Self.productID]).first
    }

    func refreshEntitlements() async {
        var owned = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == Self.productID, t.revocationDate == nil {
                owned = true
            }
        }
        isUnlocked = owned
    }

    func purchase() async {
        guard let product else { return }
        do {
            let result = try await product.purchase()
            if case .success(let verification) = result, case .verified(let transaction) = verification {
                await transaction.finish()
                await refreshEntitlements()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restore() async {
        do {
            try await AppStore.sync()
        } catch {
            errorMessage = error.localizedDescription
        }
        await refreshEntitlements()
    }
}
