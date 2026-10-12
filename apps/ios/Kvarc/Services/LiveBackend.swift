import Foundation

/// Настоящий сервер QVARC. Адрес задаётся в Kvarc-Info.plist → QvarcAPIBaseURL.
@MainActor
final class LiveBackend: Backend {
    private let api: APIClient

    init(baseURL: URL) {
        api = APIClient(baseURL: baseURL)
    }

    var isDemo: Bool { false }
    var hasSession: Bool { api.hasSession }
    var onSessionExpired: (() -> Void)? {
        get { api.onSessionExpired }
        set { api.onSessionExpired = newValue }
    }

    private struct EmailBody: Encodable { let email: String }
    private struct VerifyBody: Encodable { let email: String; let code: String }
    private struct RefreshBody: Encodable { let refreshToken: String }

    func requestCode(email: String) async throws {
        let _: Ignored = try await api.post("auth/otp/request", EmailBody(email: email), auth: false)
    }

    func verify(email: String, code: String) async throws {
        let t: AuthTokens = try await api.post("auth/otp/verify", VerifyBody(email: email, code: code), auth: false)
        api.setTokens(t)
    }

    func logout() async {
        if let token = api.refreshToken {
            do { let _: Ignored = try await api.post("auth/logout", RefreshBody(refreshToken: token)) } catch {}
        }
        api.clearTokens()
    }

    func myBookings() async throws -> [Booking] {
        try await api.get("bookings/my")
    }

    func checkin(_ bookingId: String) async throws -> CheckinState {
        try await api.get("checkin/\(bookingId)")
    }

    func submitGuests(_ bookingId: String, guests: [GuestInput]) async throws {
        struct Body: Encodable { let guests: [GuestInput] }
        let _: Ignored = try await api.put("checkin/\(bookingId)/guests", Body(guests: guests))
    }

    func submitDocuments(_ bookingId: String, documents: [DocumentInput]) async throws {
        struct Body: Encodable { let documents: [DocumentInput] }
        let _: Ignored = try await api.put("checkin/\(bookingId)/documents", Body(documents: documents))
    }

    func acceptRules(_ bookingId: String, rulesVersion: String) async throws {
        struct Body: Encodable { let rulesVersion: String; let rulesAccepted = true; let personalDataConsent = true }
        let _: Ignored = try await api.post("checkin/\(bookingId)/rules", Body(rulesVersion: rulesVersion))
    }

    func createPayment(purpose: String, targetId: String, idempotencyKey: String) async throws -> PaymentInfo {
        struct Body: Encodable { let purpose: String; let targetId: String }
        return try await api.post("payments", Body(purpose: purpose, targetId: targetId), idempotencyKey: idempotencyKey)
    }

    func payment(_ id: String) async throws -> PaymentInfo {
        try await api.get("payments/\(id)")
    }

    func confirmDemoPayment(_ id: String) async throws {
        // У настоящего сервера оплата проходит на странице банка (или демо-странице сервера).
    }

    func access(_ bookingId: String) async throws -> AccessInfo {
        try await api.get("access/\(bookingId)")
    }

    func requestAccess(_ bookingId: String) async throws -> AccessInfo {
        try await api.post("access/\(bookingId)/request", NoBody())
    }

    func checkout(_ bookingId: String, problems: String?) async throws {
        struct Body: Encodable { let problems: String? }
        let text = problems?.trimmingCharacters(in: .whitespacesAndNewlines)
        let _: Ignored = try await api.post("bookings/\(bookingId)/checkout", Body(problems: (text?.isEmpty ?? true) ? nil : text))
    }

    func services() async throws -> [ServiceCategory] {
        try await api.get("services")
    }

    func serviceSlots(_ serviceId: String, date: Date) async throws -> [ServiceSlot] {
        let r: ServiceSlots = try await api.get("services/\(serviceId)/slots", query: ["date": Fmt.apiDate(date)])
        return r.slots
    }

    func bookService(_ serviceId: String, bookingId: String, startsAt: Date, quantity: Int, idempotencyKey: String) async throws -> ServiceBookingResult {
        struct Body: Encodable { let serviceId: String; let bookingId: String; let startsAt: Date; let quantity: Int }
        return try await api.post("service-bookings", Body(serviceId: serviceId, bookingId: bookingId, startsAt: startsAt, quantity: quantity), idempotencyKey: idempotencyKey)
    }

    func restaurants() async throws -> [Restaurant] {
        try await api.get("restaurants")
    }

    func tableSlots(_ restaurantId: String, date: Date, partySize: Int) async throws -> [TableSlot] {
        try await api.get("restaurants/\(restaurantId)/availability", query: ["date": Fmt.apiDate(date), "partySize": String(partySize)])
    }

    func reserveTable(_ restaurantId: String, startsAt: Date, partySize: Int, bookingId: String?, idempotencyKey: String) async throws -> TableReservation {
        struct Body: Encodable { let restaurantId: String; let startsAt: Date; let partySize: Int; let bookingId: String? }
        return try await api.post("table-reservations", Body(restaurantId: restaurantId, startsAt: startsAt, partySize: partySize, bookingId: bookingId), idempotencyKey: idempotencyKey)
    }

    func property() async throws -> PropertyInfo {
        try await api.get("property")
    }

    func legalDocument(_ code: String) async throws -> LegalDocument {
        try await api.get("documents/\(code)")
    }

    func menu(_ restaurantId: String) async throws -> RestaurantMenu {
        try await api.get("restaurants/\(restaurantId)/menu")
    }

    func createFoodOrder(restaurantId: String, bookingId: String?, fulfillment: String, paymentMethod: String,
                         items: [FoodOrderItemInput], comment: String?, idempotencyKey: String) async throws -> FoodOrder {
        struct Body: Encodable {
            let restaurantId: String; let bookingId: String?; let fulfillment: String; let paymentMethod: String
            let items: [FoodOrderItemInput]; let comment: String?
        }
        let text = comment?.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await api.post("food-orders", Body(restaurantId: restaurantId, bookingId: bookingId, fulfillment: fulfillment,
                                                      paymentMethod: paymentMethod, items: items, comment: (text?.isEmpty ?? true) ? nil : text),
                                  idempotencyKey: idempotencyKey)
    }

    func myFoodOrders() async throws -> [FoodOrder] {
        try await api.get("food-orders/my")
    }

    func foodOrder(_ id: String) async throws -> FoodOrder {
        try await api.get("food-orders/\(id)")
    }

    func cancelFoodOrder(_ id: String) async throws -> FoodOrder {
        try await api.post("food-orders/\(id)/cancel", NoBody())
    }
}
