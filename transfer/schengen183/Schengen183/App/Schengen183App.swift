import SwiftUI
import SwiftData

@main
struct Schengen183App: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var purchases = PurchaseManager.shared
    @StateObject private var tracker = LocationTracker.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(purchases)
                .environmentObject(tracker)
        }
        .modelContainer(Persistence.container)
    }
}

/// Нужен для фонового перезапуска: при значительной смене местоположения iOS запускает
/// приложение без интерфейса, и трекер должен сразу снова подписаться на события.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Persistence.prepare()
        Task { @MainActor in
            LocationTracker.shared.resumeIfEnabled()
        }
        return true
    }
}
