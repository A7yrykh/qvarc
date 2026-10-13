import Foundation

// Модели повторяют ответы гостевого API QVARC (apps/api/src/guest-app).
// Все суммы — в копейках, все даты — ISO 8601 в UTC.

struct AuthTokens: Decodable {
    let guestId: String
    let accessToken: String
    let refreshToken: String
    let expiresInSeconds: Int
}

struct UnitRef: Codable, Hashable {
    let id: String
    let code: String
    let name: String
}

struct PropertyRef: Codable, Hashable {
    let id: String
    let name: String
    let phone: String?
}

struct Booking: Codable, Identifiable, Hashable {
    let id: String
    let number: String
    let status: String
    let checkinStatus: String
    let checkinStatusLabel: String
    let arrivalAt: Date
    let departureAt: Date
    let adults: Int
    let children: Int
    let totalAmount: Int
    let paidAmount: Int
    let balanceDue: Int
    let currency: String
    let unit: UnitRef?
    let property: PropertyRef
    let checkedInAt: Date?
    let checkedOutAt: Date?

    /// «Дом 5 · Дом у озера»
    var unitTitle: String {
        guard let unit else { return "Номер назначат перед заездом" }
        return unit.name.isEmpty ? unit.code : "\(unit.code) · \(unit.name)"
    }

    var isCheckedOut: Bool { checkedOutAt != nil || checkinStatus == "checked_out" }
    var isCanceled: Bool { status == "canceled" || status == "cancelled" }
}

struct ExpectedGuests: Codable, Hashable {
    let adults: Int
    let children: Int
}

struct CheckinSteps: Codable, Hashable {
    let guests: Bool
    let documents: Bool?
    let rules: Bool
    let consent: Bool
    let adminApproval: Bool?
    let payment: Bool
    let unitReady: Bool
}

struct GuestDocumentSummary: Codable, Hashable {
    let docType: String
    let numberMasked: String
}

struct CheckinGuest: Codable, Identifiable, Hashable {
    let id: String
    let firstName: String
    let lastName: String
    let middleName: String?
    let birthDate: String?
    let isChild: Bool
    let isPrimary: Bool
    let document: GuestDocumentSummary?

    var fullName: String {
        [lastName, firstName, middleName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

struct Blocker: Codable, Hashable {
    let code: String
    let message: String
}

struct CheckinState: Codable, Hashable {
    let bookingId: String
    let status: String
    let statusLabel: String
    let registrationOpensAt: Date?
    let rulesVersion: String
    let expectedGuests: ExpectedGuests
    let balanceDue: Int
    let steps: CheckinSteps
    let guests: [CheckinGuest]
    let accessBlockers: [Blocker]

    var documentsRequired: Bool { steps.documents != nil }
    var documentsDone: Bool { steps.documents ?? true }

    /// Шаги, которые видит гость: гости, документы, правила, оплата.
    var guestSteps: [(title: String, done: Bool)] {
        var s: [(title: String, done: Bool)] = [("Гости", steps.guests)]
        if documentsRequired { s.append(("Паспортные данные", documentsDone)) }
        s.append(("Правила и согласие", steps.rules && steps.consent))
        s.append(("Оплата", steps.payment))
        return s
    }

    var doneCount: Int { guestSteps.filter(\.done).count }
}

struct AccessInfo: Codable, Hashable {
    /// active | processing | not_available | available_to_request
    let status: String
    let demo: Bool
    let demoNotice: String?
    let pin: String?
    let validFrom: Date?
    let validUntil: Date?
    let blockers: [Blocker]
    let instructions: String?
}

struct PaymentInfo: Codable, Identifiable, Hashable {
    let id: String
    let purpose: String
    let amount: Int
    let refundedAmount: Int
    /// pending | succeeded | canceled | failed | refunded | partially_refunded
    let status: String
    let confirmationUrl: String?
    let demo: Bool
    let paidAt: Date?

    var isPaid: Bool { status == "succeeded" || status == "partially_refunded" }
    var isFinalFailure: Bool { status == "canceled" || status == "failed" }
}

struct ServiceCategory: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let services: [Service]
}

struct Service: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    /// 0 — цена ещё не задана владельцем
    let price: Int
    let bookingMode: String
    let durationMinutes: Int?
    let minAge: Int?
    let rules: String?
    let cancellationPolicy: String?
    let photos: [String]
    let maxQuantity: Int
    let requiresConfirmation: Bool

    var priceText: String {
        guard price > 0 else { return "цена уточняется" }
        if let d = durationMinutes { return "\(Fmt.money(price)) · \(d) мин" }
        return Fmt.money(price)
    }
}

struct ServiceSlot: Codable, Hashable {
    let startsAt: Date
    let endsAt: Date
    let available: Int
}

struct ServiceSlots: Codable, Hashable {
    let serviceId: String
    let date: String
    let slots: [ServiceSlot]
}

struct ServiceBookingResult: Codable, Identifiable, Hashable {
    let id: String
    /// hold | confirmed | pending_confirmation | canceled
    let status: String
    let startsAt: Date
    let endsAt: Date
    let quantity: Int
    let amount: Int
    let holdExpiresAt: Date?
    let service: String
    let cancellationPolicy: String?
}

struct OpeningHours: Codable, Hashable {
    let weekday: Int
    let opensAt: String
    let closesAt: String
}

struct Restaurant: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let phone: String?
    let photos: [String]
    let seatingMinutes: Int
    let acceptsDelivery: Bool
    let hours: [OpeningHours]
}

struct TableSlot: Codable, Hashable {
    let startsAt: Date
    let available: Bool
}

struct TableReservation: Codable, Identifiable, Hashable {
    let id: String
    let number: String
    let status: String
    let startsAt: Date
    let endsAt: Date
    let partySize: Int
    let wishes: String?
    let allergies: String?
    let comment: String?
    let restaurant: String
    let zone: String?
}

// MARK: - Данные, которые отправляет приложение

struct GuestInput: Encodable, Hashable, Identifiable {
    var id = UUID()
    var firstName = ""
    var lastName = ""
    var middleName = ""
    var isChild = false

    enum CodingKeys: String, CodingKey { case firstName, lastName, middleName, isChild }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(firstName.trimmingCharacters(in: .whitespaces), forKey: .firstName)
        try c.encode(lastName.trimmingCharacters(in: .whitespaces), forKey: .lastName)
        let m = middleName.trimmingCharacters(in: .whitespaces)
        if !m.isEmpty { try c.encode(m, forKey: .middleName) }
        try c.encode(isChild, forKey: .isChild)
    }

    var isValid: Bool {
        !firstName.trimmingCharacters(in: .whitespaces).isEmpty && !lastName.trimmingCharacters(in: .whitespaces).isEmpty
    }
}

/// Документ гостя. Поля, которые не нужны для выбранного типа, не отправляются.
struct DocumentInput: Encodable, Hashable {
    enum Kind: String, CaseIterable, Identifiable {
        case ruPassport = "ru_passport"
        case foreignPassport = "foreign_passport"
        case birthCertificate = "birth_certificate"
        var id: String { rawValue }
        var title: String {
            switch self {
            case .ruPassport: return "Паспорт РФ"
            case .foreignPassport: return "Иностранный паспорт"
            case .birthCertificate: return "Свидетельство о рождении"
            }
        }
    }

    var bookingGuestId: String
    var kind: Kind = .ruPassport
    var series = ""
    var number = ""
    var issuedBy = ""
    var issueDate: Date? = nil
    var divisionCode = ""
    var birthPlace = ""
    var registrationAddress = ""
    var citizenship = "RU"

    enum CodingKeys: String, CodingKey {
        case bookingGuestId, docType, series, number, issuedBy, issueDate, divisionCode, birthPlace, registrationAddress, citizenship
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        func t(_ s: String) -> String? {
            let v = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return v.isEmpty ? nil : v
        }
        try c.encode(bookingGuestId, forKey: .bookingGuestId)
        try c.encode(kind.rawValue, forKey: .docType)
        try c.encodeIfPresent(t(series), forKey: .series)
        try c.encode(number.trimmingCharacters(in: .whitespaces), forKey: .number)
        try c.encodeIfPresent(t(issuedBy), forKey: .issuedBy)
        try c.encodeIfPresent(issueDate.map(Fmt.apiDate), forKey: .issueDate)
        switch kind {
        case .ruPassport:
            try c.encodeIfPresent(t(divisionCode), forKey: .divisionCode)
            try c.encodeIfPresent(t(birthPlace), forKey: .birthPlace)
            try c.encodeIfPresent(t(registrationAddress), forKey: .registrationAddress)
            try c.encode("RU", forKey: .citizenship)
        case .foreignPassport:
            try c.encode(citizenship.uppercased(), forKey: .citizenship)
        case .birthCertificate:
            break
        }
    }

    /// Проверка на телефоне — те же правила, что и на сервере. Возвращает текст ошибки или nil.
    var problem: String? {
        let digits = { (s: String) in s.filter(\.isNumber) }
        switch kind {
        case .ruPassport:
            if digits(series).count != 4 || series.count != 4 { return "Серия паспорта: 4 цифры" }
            if digits(number).count != 6 || number.count != 6 { return "Номер паспорта: 6 цифр" }
            if issuedBy.trimmingCharacters(in: .whitespaces).count < 3 { return "Укажите, кем выдан паспорт" }
            if issueDate == nil { return "Укажите дату выдачи" }
            if divisionCode.range(of: #"^\d{3}-\d{3}$"#, options: .regularExpression) == nil { return "Код подразделения: 000-000" }
            if birthPlace.trimmingCharacters(in: .whitespaces).count < 2 { return "Укажите место рождения" }
            if registrationAddress.trimmingCharacters(in: .whitespaces).count < 5 { return "Укажите адрес регистрации" }
        case .foreignPassport:
            if number.trimmingCharacters(in: .whitespaces).count < 4 { return "Номер паспорта: не меньше 4 символов" }
            if citizenship.range(of: #"^[A-Za-z]{2}$"#, options: .regularExpression) == nil { return "Гражданство: код страны из двух латинских букв, например KZ" }
        case .birthCertificate:
            if series.trimmingCharacters(in: .whitespaces).count < 2 { return "Укажите серию свидетельства" }
            if digits(number).count != 6 || number.count != 6 { return "Номер свидетельства: 6 цифр" }
        }
        return nil
    }
}

// MARK: - Меню и заказ еды

struct MenuItem: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let weightGrams: Int?
    let volumeMl: Int?
    let price: Int
    let isAvailable: Bool
    let photos: [String]
    let allergens: [String]

    /// «250 г» или «350 мл»
    var portion: String? {
        if let g = weightGrams { return "\(g) г" }
        if let ml = volumeMl { return "\(ml) мл" }
        return nil
    }
}

struct MenuCategory: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let items: [MenuItem]
}

struct RestaurantMenu: Codable, Hashable {
    let restaurantId: String
    let acceptsDelivery: Bool
    let isOpenNow: Bool
    let categories: [MenuCategory]
}

struct FoodOrderLine: Codable, Hashable {
    let menuItemId: String?
    let name: String
    let unitPrice: Int
    let quantity: Int
    let lineTotal: Int
    let comment: String?
}

struct FoodOrder: Codable, Identifiable, Hashable {
    let id: String
    let number: String
    /// new | accepted | cooking | ready | delivering | handed_over | delivered | cancelled
    let status: String
    let statusLabel: String
    /// delivery | pickup
    let fulfillment: String
    /// online | on_delivery
    let paymentMethod: String
    /// unpaid | pending | paid | refunded | partially_refunded
    let paymentStatus: String
    let total: Int
    let comment: String?
    let createdAt: Date
    let restaurant: String
    let unitCode: String?
    let items: [FoodOrderLine]

    var isActive: Bool { !["delivered", "handed_over", "cancelled"].contains(status) }
    var needsPayment: Bool { paymentMethod == "online" && status == "new" && paymentStatus != "paid" }
    var canCancel: Bool { status == "new" }
}

/// Позиция заказа, которую отправляет приложение. Цену сервер берёт из меню сам.
struct FoodOrderItemInput: Encodable, Hashable {
    let menuItemId: String
    let quantity: Int
}

// MARK: - Сведения о базе и типы размещения (с сайта базы)

struct UnitPhoto: Codable, Hashable {
    /// Понятное имя файла: «standart-01.webp»
    let file: String
    /// Подпись: «Стандарт — фото 1»
    let caption: String
    let url: String
}

struct UnitType: Codable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let summary: String?
    let capacity: Int?
    let bedrooms: Int?
    let amenities: [String]
    let photos: [UnitPhoto]
    /// Внешний id категории для ссылки на бронирование; сервер QVARC его не передаёт
    let externalId: String?

    var facts: String {
        var parts: [String] = []
        if let c = capacity { parts.append("до \(c) гостей") }
        if let b = bedrooms { parts.append(b == 1 ? "1 спальня" : "\(b) спальни") }
        return parts.joined(separator: " · ")
    }
}

struct FAQItem: Codable, Hashable {
    let q: String
    let a: String
}

struct PropertyInfo: Codable, Hashable {
    let name: String
    let address: String?
    let about: String?
    let phones: [String]
    let email: String?
    let bookingUrl: String?
    let checkInTime: String
    let checkOutTime: String
    let facilities: [String]
    let faq: [FAQItem]
    let unitTypes: [UnitType]

    /// Ссылка на модуль бронирования QVARC
    func bookingURL(for t: UnitType) -> URL? {
        guard let base = bookingUrl else { return nil }
        guard let ext = t.externalId else { return URL(string: base) }
        return URL(string: base + (base.contains("?") ? "&" : "?") + "room-type=\(ext)")
    }
}

// MARK: - Документы базы (правила проживания)

struct LegalSection: Codable, Hashable {
    let title: String
    /// Пункты раздела. Строка, начинающаяся с «• », — подпункт списка.
    let paragraphs: [String]
}

struct LegalDocument: Codable, Hashable {
    let code: String
    let title: String
    let version: String
    let issuer: String
    let sections: [LegalSection]
}
