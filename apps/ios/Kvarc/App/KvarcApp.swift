import SwiftUI

@main
struct KvarcApp: App {
    @State private var app = AppState(backend: AppConfig.makeBackend())

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .tint(Brand.graphite)
                .preferredColorScheme(.light)
                .onOpenURL { app.handle(url: $0) }
        }
    }
}

/// Настройки сборки. Адрес сервера — в Kvarc-Info.plist (QvarcAPIBaseURL).
/// Пусто → демо-режим без сервера.
enum AppConfig {
    static var apiBaseURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "QvarcAPIBaseURL") as? String else { return nil }
        let s = raw.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty, let url = URL(string: s), url.scheme != nil else { return nil }
        return url
    }

    static let adminPhone = "+79085870030"
    /// Телефон ресторана из меню «Лето 2026»
    static let restaurantPhone = "+73512150030"

    @MainActor
    static func makeBackend() -> Backend {
        if let url = apiBaseURL { return LiveBackend(baseURL: url) }
        return DemoBackend()
    }
}

enum AppTab: Hashable {
    case home, access, restaurant, rental
}

@Observable
@MainActor
final class AppState {
    enum Phase { case loading, login, main }

    let backend: Backend
    var phase: Phase = .loading
    var bookings: [Booking] = []
    var tab: AppTab = .home
    var loadError: String?
    /// Увеличивается, когда банк вернул гостя в приложение по ссылке qvarc://payment-return
    var paymentReturnTick = 0
    let cart = Cart()

    init(backend: Backend) {
        self.backend = backend
        backend.onSessionExpired = { [weak self] in
            self?.bookings = []
            self?.phase = .login
        }
    }

    var isDemo: Bool { backend.isDemo }

    /// Текущая бронь: ближайшая, по которой ещё не выехали.
    var booking: Booking? {
        let active = bookings.filter { !$0.isCheckedOut && !$0.isCanceled }
        return active.min { $0.arrivalAt < $1.arrivalAt } ?? bookings.first
    }

    func start() async {
        guard backend.hasSession else { phase = .login; return }
        await reloadBookings()
        if phase == .loading { phase = .main }
    }

    func signedIn() async {
        phase = .loading
        await reloadBookings()
        if phase == .loading { phase = .main }
    }

    func reloadBookings() async {
        do {
            bookings = try await backend.myBookings()
            loadError = nil
        } catch let e as APIError where e == .sessionExpired {
            phase = .login
        } catch {
            loadError = error.localizedDescription
        }
    }

    func logout() async {
        await backend.logout()
        bookings = []
        cart.clear()
        tab = .home
        phase = .login
    }

    func handle(url: URL) {
        if url.scheme == "qvarc" { paymentReturnTick += 1 }
    }
}
