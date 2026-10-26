import SwiftData
import SwiftUI

@main
struct RevendeApp: App {
    let container: ModelContainer
    @StateObject private var settings = SellerSettings()
    @StateObject private var subscription = SubscriptionService()

    init() {
        do {
            container = try ModelContainer(for: Item.self, ItemPhoto.self)
        } catch {
            fatalError("No se pudo abrir la base de datos: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(settings)
                .environmentObject(subscription)
                .task { await subscription.load() }
                #if DEBUG
                .onAppear { DemoData.seed(container.mainContext) }
                #endif
        }
        .modelContainer(container)
    }
}
