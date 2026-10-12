import Foundation

/// Демо-режим: сервер не нужен, данные — примеры. Замок и оплата не настоящие,
/// и приложение всегда показывает это гостю плашкой.
@MainActor
final class DemoBackend: Backend {
    var isDemo: Bool { true }
    private(set) var hasSession = false
    var onSessionExpired: (() -> Void)?

    private let bookingId = "demo-booking"
    private let rulesVersion = DemoLegal.rules.version
    private var booking: Booking
    private var guests: [CheckinGuest] = []
    private var documentsDone = false
    private var rulesDone = false
    private var pin: String?
    private var payments: [String: PaymentInfo] = [:]
    private var serviceBookings: [String: ServiceBookingResult] = [:]
    private var takenSlots: [String: Int] = [:]
    /// Демо-заказы еды: на кухню не уходят
    private var foodOrders: [String: FoodOrder] = [:]
    private var foodPaidAt: [String: Date] = [:]
    private var paymentFoodOrder: [String: String] = [:]

    private let rental: [Service]
    private let restaurant: Restaurant

    init() {
        let cal = Fmt.calendar
        let today = cal.startOfDay(for: Date())
        let arrival = cal.date(bySettingHour: 17, minute: 0, second: 0, of: cal.date(byAdding: .day, value: 2, to: today)!)!
        let departure = cal.date(bySettingHour: 14, minute: 0, second: 0, of: cal.date(byAdding: .day, value: 4, to: today)!)!
        booking = Booking(
            id: "demo-booking", number: "ДЕМО-05", status: "confirmed",
            checkinStatus: "registration_not_started", checkinStatusLabel: "Регистрация не начата",
            arrivalAt: arrival, departureAt: departure, adults: 2, children: 0,
            totalAmount: 1_000_000, paidAmount: 300_000, balanceDue: 700_000, currency: "RUB",
            unit: UnitRef(id: "demo-unit", code: "Коттедж 5", name: "Семейный коттедж"),
            property: PropertyRef(id: "demo-property", name: "Кварц", phone: "+79085870030"),
            checkedInAt: nil, checkedOutAt: nil
        )

        // Список проката — от владельца. Цены катамарана, сапов и велосипедов — с кварц.рус («Чем заняться»),
        // остальные ещё не известны: price = 0 («цена уточняется»). Количество — пример.
        func item(_ id: String, _ name: String, _ desc: String, price: Int = 0, minutes: Int?, minAge: Int? = nil, max: Int) -> Service {
            Service(id: id, name: name, description: desc, price: price, bookingMode: "slot", durationMinutes: minutes, minAge: minAge,
                    rules: nil, cancellationPolicy: "Отмена без оплаты — сообщите администратору заранее.", photos: [],
                    maxQuantity: max, requiresConfirmation: false)
        }
        rental = [
            item("demo-bike", "Велосипед", "Взрослый: 600 ₽ первый час, далее 200 ₽ за час. Детский: 400 ₽ первый час.", price: 60_000, minutes: 60, max: 4),
            item("demo-catamaran", "Катамаран", "2 000 ₽ за час, 3 500 ₽ за 2 часа", price: 200_000, minutes: 60, max: 2),
            item("demo-boat", "Прогулка на катере", "Условия уточняйте у администратора", minutes: 60, max: 1),
            item("demo-sup", "Сапы", "1 000 ₽ за час", price: 100_000, minutes: 60, max: 4),
            item("demo-diving", "Погружение и обучение дайвингу", "Условия уточняйте у администратора", minutes: 120, max: 2),
            item("demo-skates", "Коньки", "Условия уточняйте у администратора", minutes: 60, max: 6),
        ]
        restaurant = Restaurant(
            id: "demo-restaurant", name: "Ресторан «Кварц»", description: nil,
            phone: "+73512150030", photos: [], seatingMinutes: 120, acceptsDelivery: true,
            hours: (1...7).map { OpeningHours(weekday: $0, opensAt: "12:00:00", closesAt: "23:00:00") }
        )
    }

    private func pause() async { try? await Task.sleep(nanoseconds: 350_000_000) }

    // MARK: - Вход

    func requestCode(phone: String) async throws { await pause() }

    func verify(phone: String, code: String) async throws {
        await pause()
        guard code.count == 6, code.allSatisfy(\.isNumber) else {
            throw APIError(status: 400, code: "invalid_code", message: "Код из 6 цифр. В демо-режиме подойдёт любой.")
        }
        hasSession = true
    }

    func logout() async { hasSession = false }

    // MARK: - Бронь и регистрация

    func myBookings() async throws -> [Booking] {
        await pause()
        return [booking]
    }

    private var steps: CheckinSteps {
        CheckinSteps(guests: !guests.isEmpty, documents: documentsDone, rules: rulesDone, consent: rulesDone,
                     adminApproval: nil, payment: booking.balanceDue == 0, unitReady: registrationDone)
    }

    private var registrationDone: Bool {
        !guests.isEmpty && documentsDone && rulesDone && booking.balanceDue == 0
    }

    private func refreshStatus() {
        let status: (code: String, label: String)
        if booking.checkedOutAt != nil { status = ("checked_out", "Выезд оформлен") }
        else if pin != nil { status = ("access_granted", "Доступ предоставлен") }
        // В демо дом «готов» сразу после регистрации; на сервере это отмечает администратор.
        else if registrationDone { status = ("ready_for_checkin", "Объект готов к заселению") }
        else if guests.isEmpty && !rulesDone && booking.paidAmount == 300_000 { status = ("registration_not_started", "Регистрация не начата") }
        else { status = ("registration_in_progress", "Регистрация в процессе") }
        booking = booking.with(checkinStatus: status.code, label: status.label)
    }

    private var blockers: [Blocker] {
        var b: [Blocker] = []
        if guests.isEmpty || !documentsDone || !rulesDone { b.append(Blocker(code: "registration_incomplete", message: "Завершите онлайн-регистрацию")) }
        if booking.balanceDue > 0 { b.append(Blocker(code: "payment_required", message: "Оплатите остаток стоимости проживания")) }
        if !registrationDone { b.append(Blocker(code: "unit_not_ready", message: "Дом ещё готовится к заселению")) }
        return b
    }

    func checkin(_ bookingId: String) async throws -> CheckinState {
        await pause()
        refreshStatus()
        return CheckinState(
            bookingId: bookingId, status: booking.checkinStatus, statusLabel: booking.checkinStatusLabel,
            registrationOpensAt: nil, rulesVersion: rulesVersion,
            expectedGuests: ExpectedGuests(adults: booking.adults, children: booking.children),
            balanceDue: booking.balanceDue, steps: steps, guests: guests, accessBlockers: blockers
        )
    }

    func submitGuests(_ bookingId: String, guests input: [GuestInput]) async throws {
        await pause()
        guests = input.enumerated().map { i, g in
            CheckinGuest(id: "demo-guest-\(i)", firstName: g.firstName, lastName: g.lastName,
                         middleName: g.middleName.isEmpty ? nil : g.middleName, birthDate: nil,
                         isChild: g.isChild, isPrimary: i == 0, document: nil)
        }
        documentsDone = false
        refreshStatus()
    }

    func submitDocuments(_ bookingId: String, documents: [DocumentInput]) async throws {
        await pause()
        if let bad = documents.compactMap(\.problem).first {
            throw APIError(status: 400, code: "validation_error", message: bad)
        }
        guests = guests.map { g in
            guard let d = documents.first(where: { $0.bookingGuestId == g.id }) else { return g }
            let summary = GuestDocumentSummary(docType: d.kind.rawValue, numberMasked: "•••• " + String(d.number.suffix(4)))
            return CheckinGuest(id: g.id, firstName: g.firstName, lastName: g.lastName, middleName: g.middleName,
                                birthDate: g.birthDate, isChild: g.isChild, isPrimary: g.isPrimary, document: summary)
        }
        documentsDone = guests.allSatisfy { $0.document != nil }
        refreshStatus()
    }

    func acceptRules(_ bookingId: String, rulesVersion: String) async throws {
        await pause()
        rulesDone = true
        refreshStatus()
    }

    // MARK: - Оплата (имитация, деньги не списываются)

    func createPayment(purpose: String, targetId: String, idempotencyKey: String) async throws -> PaymentInfo {
        await pause()
        if let existing = payments[idempotencyKey] { return existing }
        let amount: Int
        switch purpose {
        case "booking": amount = booking.balanceDue
        case "food_order": amount = foodOrders[targetId].flatMap { $0.needsPayment ? $0.total : nil } ?? 0
        default: amount = serviceBookings[targetId]?.amount ?? 0
        }
        guard amount > 0 else { throw APIError(status: 409, code: "nothing_to_pay", message: "Оплачивать нечего.") }
        let p = PaymentInfo(id: idempotencyKey, purpose: purpose, amount: amount, refundedAmount: 0,
                            status: "pending", confirmationUrl: nil, demo: true, paidAt: nil)
        payments[p.id] = p
        if purpose == "food_order" { paymentFoodOrder[p.id] = targetId }
        return p
    }

    func payment(_ id: String) async throws -> PaymentInfo {
        guard let p = payments[id] else { throw APIError(status: 404, code: "not_found", message: "Платёж не найден") }
        return p
    }

    func confirmDemoPayment(_ id: String) async throws {
        await pause()
        guard let p = payments[id], p.status == "pending" else { return }
        payments[id] = PaymentInfo(id: p.id, purpose: p.purpose, amount: p.amount, refundedAmount: 0,
                                   status: "succeeded", confirmationUrl: nil, demo: true, paidAt: Date())
        if p.purpose == "booking" {
            booking = booking.with(paid: booking.paidAmount + p.amount)
            refreshStatus()
        }
        if p.purpose == "food_order", let target = paymentFoodOrder[id], let o = foodOrders[target] {
            foodOrders[target] = o.with(paymentStatus: "paid")
            foodPaidAt[target] = Date()
        }
    }

    // MARK: - Доступ

    func access(_ bookingId: String) async throws -> AccessInfo {
        await pause()
        return accessInfo
    }

    private var accessInfo: AccessInfo {
        let notice = "Демо-режим: код не связан с реальным замком. Для входа обратитесь к администратору."
        if booking.checkedOutAt != nil {
            return AccessInfo(status: "not_available", demo: true, demoNotice: notice, pin: nil, validFrom: nil, validUntil: nil,
                              blockers: [Blocker(code: "checked_out", message: "Выезд оформлен, код больше не действует")], instructions: nil)
        }
        if let pin {
            return AccessInfo(status: "active", demo: true, demoNotice: notice, pin: pin,
                              validFrom: booking.arrivalAt.addingTimeInterval(-30 * 60), validUntil: booking.departureAt, blockers: [],
                              instructions: "Коснитесь панели замка, введите код и нажмите ✓. Если дверь не открывается, позвоните администратору.")
        }
        let b = blockers
        return AccessInfo(status: b.isEmpty ? "available_to_request" : "not_available", demo: true, demoNotice: notice,
                          pin: nil, validFrom: nil, validUntil: nil, blockers: b, instructions: nil)
    }

    func requestAccess(_ bookingId: String) async throws -> AccessInfo {
        await pause()
        guard blockers.isEmpty, booking.checkedOutAt == nil else {
            throw APIError(status: 409, code: "access_blocked", message: blockers.first?.message ?? "Доступ пока недоступен")
        }
        if pin == nil { pin = String(format: "%06d", Int.random(in: 0...999_999)) }
        refreshStatus()
        return accessInfo
    }

    func checkout(_ bookingId: String, problems: String?) async throws {
        await pause()
        booking = booking.with(checkedOutAt: Date())
        pin = nil
        refreshStatus()
    }

    // MARK: - Прокат

    func services() async throws -> [ServiceCategory] {
        await pause()
        return [ServiceCategory(id: "demo-rental", name: "Прокат", services: rental)]
    }

    func serviceSlots(_ serviceId: String, date: Date) async throws -> [ServiceSlot] {
        await pause()
        guard let s = rental.first(where: { $0.id == serviceId }) else { return [] }
        let minutes = s.durationMinutes ?? 60
        let cal = Fmt.calendar
        let day = cal.startOfDay(for: date)
        var out: [ServiceSlot] = []
        var start = cal.date(bySettingHour: 10, minute: 0, second: 0, of: day)!
        let close = cal.date(bySettingHour: 19, minute: 0, second: 0, of: day)!
        while start.addingTimeInterval(TimeInterval(minutes * 60)) <= close {
            let end = start.addingTimeInterval(TimeInterval(minutes * 60))
            if start > Date() {
                let key = "\(serviceId)|\(ISODate.string(start))"
                // Для примера часть времени уже занята
                let hour = cal.component(.hour, from: start)
                let base = hour == 12 || hour == 16 ? 0 : s.maxQuantity
                out.append(ServiceSlot(startsAt: start, endsAt: end, available: max(0, base - (takenSlots[key] ?? 0))))
            }
            start = end
        }
        return out
    }

    func bookService(_ serviceId: String, bookingId: String, startsAt: Date, quantity: Int, idempotencyKey: String) async throws -> ServiceBookingResult {
        await pause()
        if let existing = serviceBookings[idempotencyKey] { return existing }
        guard let s = rental.first(where: { $0.id == serviceId }) else { throw APIError(status: 404, code: "not_found", message: "Услуга не найдена") }
        let key = "\(serviceId)|\(ISODate.string(startsAt))"
        let slot = try await serviceSlots(serviceId, date: startsAt).first { $0.startsAt == startsAt }
        guard let slot, slot.available >= quantity else {
            throw APIError(status: 409, code: "slot_unavailable", message: "Это время уже заняли. Выберите другое.")
        }
        takenSlots[key, default: 0] += quantity
        let amount = s.price * quantity
        let r = ServiceBookingResult(id: idempotencyKey, status: amount > 0 ? "hold" : "confirmed", startsAt: slot.startsAt,
                                     endsAt: slot.endsAt, quantity: quantity, amount: amount,
                                     holdExpiresAt: amount > 0 ? Date().addingTimeInterval(15 * 60) : nil,
                                     service: s.name, cancellationPolicy: s.cancellationPolicy)
        serviceBookings[idempotencyKey] = r
        return r
    }

    // MARK: - Ресторан

    func restaurants() async throws -> [Restaurant] {
        await pause()
        return [restaurant]
    }

    func tableSlots(_ restaurantId: String, date: Date, partySize: Int) async throws -> [TableSlot] {
        await pause()
        let cal = Fmt.calendar
        let day = cal.startOfDay(for: date)
        var out: [TableSlot] = []
        var t = cal.date(bySettingHour: 12, minute: 0, second: 0, of: day)!
        let last = cal.date(bySettingHour: 21, minute: 0, second: 0, of: day)!
        while t <= last {
            let hour = cal.component(.hour, from: t)
            if t > Date() { out.append(TableSlot(startsAt: t, available: !(hour == 19 || (partySize > 6 && hour >= 18)))) }
            t = t.addingTimeInterval(30 * 60)
        }
        return out
    }

    func reserveTable(_ restaurantId: String, startsAt: Date, partySize: Int, bookingId: String?, idempotencyKey: String) async throws -> TableReservation {
        await pause()
        return TableReservation(id: idempotencyKey, number: "ДЕМО-" + String(idempotencyKey.prefix(4)).uppercased(), status: "confirmed",
                                startsAt: startsAt, endsAt: startsAt.addingTimeInterval(TimeInterval(restaurant.seatingMinutes * 60)),
                                partySize: partySize, wishes: nil, allergies: nil, comment: nil, restaurant: restaurant.name, zone: nil)
    }
}

extension DemoBackend {
    // MARK: - Меню и заказ еды (демо: заказ никуда не уходит)

    func property() async throws -> PropertyInfo {
        await pause()
        return DemoProperty.info
    }

    func legalDocument(_ code: String) async throws -> LegalDocument {
        await pause()
        guard code == DemoLegal.rules.code else { throw APIError(status: 404, code: "not_found", message: "Документ не найден") }
        return DemoLegal.rules
    }

    func menu(_ restaurantId: String) async throws -> RestaurantMenu {
        await pause()
        return RestaurantMenu(restaurantId: restaurantId, acceptsDelivery: true, isOpenNow: true, categories: DemoMenu.categories)
    }

    func createFoodOrder(restaurantId: String, bookingId: String?, fulfillment: String, paymentMethod: String,
                         items: [FoodOrderItemInput], comment: String?, idempotencyKey: String) async throws -> FoodOrder {
        await pause()
        if let existing = foodOrders[idempotencyKey] { return existing }
        let all = DemoMenu.categories.flatMap(\.items)
        let lines: [FoodOrderLine] = try items.map { input in
            guard let m = all.first(where: { $0.id == input.menuItemId }) else {
                throw APIError(status: 422, code: "menu_item_not_found", message: "Часть блюд больше нет в меню. Обновите меню.")
            }
            return FoodOrderLine(menuItemId: m.id, name: m.name, unitPrice: m.price, quantity: input.quantity,
                                 lineTotal: m.price * input.quantity, comment: nil)
        }
        guard !lines.isEmpty else { throw APIError(status: 422, code: "empty_order", message: "В заказе нет блюд") }
        let o = FoodOrder(id: idempotencyKey, number: "ДЕМО-" + String(idempotencyKey.prefix(4)).uppercased(), status: "new",
                          statusLabel: paymentMethod == "online" ? "Ждёт оплаты" : "Заказ получен",
                          fulfillment: fulfillment, paymentMethod: paymentMethod, paymentStatus: "unpaid",
                          total: lines.reduce(0) { $0 + $1.lineTotal }, comment: comment, createdAt: Date(),
                          restaurant: "Ресторан «Кварц»", unitCode: fulfillment == "delivery" ? booking.unit?.code : nil, items: lines)
        foodOrders[o.id] = o
        if paymentMethod == "on_delivery" { foodPaidAt[o.id] = Date() }
        return o
    }

    func myFoodOrders() async throws -> [FoodOrder] {
        await pause()
        return foodOrders.keys.map(progressed).sorted { $0.createdAt > $1.createdAt }
    }

    func foodOrder(_ id: String) async throws -> FoodOrder {
        guard foodOrders[id] != nil else { throw APIError(status: 404, code: "not_found", message: "Заказ не найден") }
        return progressed(id)
    }

    func cancelFoodOrder(_ id: String) async throws -> FoodOrder {
        await pause()
        guard foodOrders[id] != nil else { throw APIError(status: 404, code: "not_found", message: "Заказ не найден") }
        let o = progressed(id)
        guard o.canCancel else { throw APIError(status: 409, code: "cannot_cancel", message: "Кухня уже приняла заказ. Чтобы отменить, позвоните в ресторан.") }
        foodOrders[id] = o.with(status: "cancelled", label: "Отменён", paymentStatus: o.paymentStatus == "paid" ? "refunded" : nil)
        foodPaidAt[id] = nil
        return foodOrders[id]!
    }

    /// В демо статус меняется сам, чтобы было видно, как гость следит за заказом.
    private func progressed(_ id: String) -> FoodOrder {
        guard let o = foodOrders[id] else { fatalError("unknown demo order") }
        guard o.status != "cancelled", let start = foodPaidAt[id] else { return o }
        let s = Date().timeIntervalSince(start)
        let delivery = o.fulfillment == "delivery"
        let steps: [(Double, String, String)] = [
            (0, "new", "Заказ получен"), (15, "accepted", "Принят кухней"), (30, "cooking", "Готовится"), (90, "ready", "Готов"),
            (120, delivery ? "delivering" : "handed_over", delivery ? "Везём к вам" : "Выдан"),
            (delivery ? 180 : 1_000_000, "delivered", "Доставлен"),
        ]
        let step = steps.last { s >= $0.0 } ?? steps[0]
        let updated = o.with(status: step.1, label: step.2)
        foodOrders[id] = updated
        return updated
    }
}

private extension FoodOrder {
    func with(status: String? = nil, label: String? = nil, paymentStatus: String? = nil) -> FoodOrder {
        FoodOrder(id: id, number: number, status: status ?? self.status, statusLabel: label ?? (paymentStatus == "paid" ? "Заказ получен" : statusLabel),
                  fulfillment: fulfillment, paymentMethod: paymentMethod, paymentStatus: paymentStatus ?? self.paymentStatus,
                  total: total, comment: comment, createdAt: createdAt, restaurant: restaurant, unitCode: unitCode, items: items)
    }
}

private extension Booking {
    func with(checkinStatus: String? = nil, label: String? = nil, paid: Int? = nil, checkedOutAt: Date? = nil) -> Booking {
        let paidAmount = paid ?? self.paidAmount
        return Booking(
            id: id, number: number, status: status,
            checkinStatus: checkinStatus ?? self.checkinStatus, checkinStatusLabel: label ?? self.checkinStatusLabel,
            arrivalAt: arrivalAt, departureAt: departureAt, adults: adults, children: children,
            totalAmount: totalAmount, paidAmount: paidAmount, balanceDue: max(0, totalAmount - paidAmount), currency: currency,
            unit: unit, property: property, checkedInAt: checkedInAt, checkedOutAt: checkedOutAt ?? self.checkedOutAt
        )
    }
}
