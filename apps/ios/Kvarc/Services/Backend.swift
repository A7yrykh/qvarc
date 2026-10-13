import Foundation

/// Всё, что приложение делает с сервером. Две реализации:
/// `LiveBackend` — настоящий сервер QVARC, `DemoBackend` — примеры прямо в приложении.
@MainActor
protocol Backend: AnyObject {
    /// true — данные ненастоящие, приложение показывает плашку «Демо-режим»
    var isDemo: Bool { get }
    var hasSession: Bool { get }
    var onSessionExpired: (() -> Void)? { get set }

    func requestCode(email: String) async throws
    func verify(email: String, code: String) async throws
    func logout() async

    func myBookings() async throws -> [Booking]

    func checkin(_ bookingId: String) async throws -> CheckinState
    func submitGuests(_ bookingId: String, guests: [GuestInput]) async throws
    func submitDocuments(_ bookingId: String, documents: [DocumentInput]) async throws
    func acceptRules(_ bookingId: String, rulesVersion: String) async throws

    /// purpose: "booking" (остаток за проживание) или "service_booking" (прокат)
    func createPayment(purpose: String, targetId: String, idempotencyKey: String) async throws -> PaymentInfo
    func payment(_ id: String) async throws -> PaymentInfo
    /// Только для демо внутри приложения: имитирует успешную оплату.
    func confirmDemoPayment(_ id: String) async throws

    func access(_ bookingId: String) async throws -> AccessInfo
    func requestAccess(_ bookingId: String) async throws -> AccessInfo
    func checkout(_ bookingId: String, problems: String?) async throws

    func services() async throws -> [ServiceCategory]
    func serviceSlots(_ serviceId: String, date: Date) async throws -> [ServiceSlot]
    func bookService(_ serviceId: String, bookingId: String, startsAt: Date, quantity: Int, idempotencyKey: String) async throws -> ServiceBookingResult

    func restaurants() async throws -> [Restaurant]
    func tableSlots(_ restaurantId: String, date: Date, partySize: Int) async throws -> [TableSlot]
    func reserveTable(_ restaurantId: String, startsAt: Date, partySize: Int, bookingId: String?, idempotencyKey: String) async throws -> TableReservation

    func menu(_ restaurantId: String) async throws -> RestaurantMenu
    /// Сведения о базе и типы размещения (открыто без входа)
    func property() async throws -> PropertyInfo
    /// Документ базы по коду, например «rules» — правила проживания (открыто без входа)
    func legalDocument(_ code: String) async throws -> LegalDocument
    /// fulfillment: "delivery" | "pickup"; paymentMethod: "online" | "on_delivery"
    func createFoodOrder(restaurantId: String, bookingId: String?, fulfillment: String, paymentMethod: String,
                         items: [FoodOrderItemInput], comment: String?, idempotencyKey: String) async throws -> FoodOrder
    func myFoodOrders() async throws -> [FoodOrder]
    func foodOrder(_ id: String) async throws -> FoodOrder
    func cancelFoodOrder(_ id: String) async throws -> FoodOrder
}

/// Номер в виде +79001112233. Сервер всё равно нормализует сам, это для удобства.
enum Phone {
    static func normalize(_ input: String) -> String? {
        var d = input.filter(\.isNumber)
        if d.count == 11, d.hasPrefix("8") { d = "7" + d.dropFirst() }
        if d.count == 10 { d = "7" + d }
        guard d.count == 11, d.hasPrefix("7") else { return nil }
        return "+" + d
    }

    /// +7 900 111-22-33
    static func pretty(_ normalized: String) -> String {
        let d = Array(normalized.filter(\.isNumber))
        guard d.count == 11 else { return normalized }
        let s = { (r: Range<Int>) in String(d[r]) }
        return "+7 \(s(1..<4)) \(s(4..<7))-\(s(7..<9))-\(s(9..<11))"
    }
}
