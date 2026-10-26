import SwiftUI

@main
struct DespejaApp: App {
    @StateObject private var library = LibraryStore()
    @StateObject private var purchases = PurchaseManager()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(purchases)
                .tint(.brand)
        }
    }
}

extension Color {
    static let brand = Color("AccentColor")
}

enum AppInfo {
    static let privacyURL = URL(string: "https://avsyrykh.es/despeja/privacidad")!
    static let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!
    static let supportURL = URL(string: "https://avsyrykh.es/contacto")!

    /// Режим для снимков экрана: `-demoData` подставляет примерную медиатеку,
    /// `-demoScreen paywall` сразу открывает экран Pro.
    static var isDemo: Bool { ProcessInfo.processInfo.arguments.contains("-demoData") }
    static var demoScreen: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-demoScreen"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = info?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }
}

enum Format {
    static func bytes(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let f = DateComponentsFormatter()
        f.allowedUnits = seconds >= 3600 ? [.hour, .minute, .second] : [.minute, .second]
        f.zeroFormattingBehavior = .pad
        return f.string(from: seconds) ?? ""
    }
}
