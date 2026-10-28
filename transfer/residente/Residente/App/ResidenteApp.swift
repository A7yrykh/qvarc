import SwiftData
import SwiftUI

@main
struct ResidenteApp: App {
    @UIApplicationDelegateAdaptor(LaunchDelegate.self) private var launch
    @StateObject private var access = FullAccess.shared
    @StateObject private var lock = AppLock()
    @StateObject private var tracker = LocationTracker.shared

    var body: some Scene {
        WindowGroup {
            Shell()
                .environmentObject(access)
                .environmentObject(lock)
                .environmentObject(tracker)
        }
        .modelContainer(Store.container)
    }
}

/// iOS перезапускает приложение в фоне при смене зоны: автоучёт должен сразу снова подписаться.
final class LaunchDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        #if DEBUG
        Fixtures.applyIfRequested()
        #endif
        Task { @MainActor in LocationTracker.shared.resumeIfEnabled() }
        return true
    }
}

enum Store {
    static let container: ModelContainer = {
        do {
            return try ModelContainer(for: Profile.self, ActiveTramite.self, StoredDocument.self, Trip.self)
        } catch {
            fatalError("SwiftData: \(error)")
        }
    }()
}

enum AppInfo {
    static let developer = "AVSyrykh SL"
    static let supportEmail = "a7yrykh@yahoo.com"
    // Политика — на сайте компании; условия — стандартное лицензионное соглашение Apple (EULA).
    static let privacyURL = URL(string: "https://avsyrykh.es/tramites/privacidad")!
    static let supportURL = URL(string: "https://avsyrykh.es/tramites/")!
    static let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    static var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(v) (\(b))"
    }
}
