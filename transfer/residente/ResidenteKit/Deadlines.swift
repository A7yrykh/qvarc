import Foundation

/// Виды документов в хранилище. От вида зависят напоминания о сроках.
public enum DocumentKind: String, CaseIterable, Codable, Sendable, Identifiable {
    case passport, tie, residencePermit, nie, euRegistration, padron, rentalContract, digitalCertificate, other

    public var id: String { rawValue }

    public var title: LText {
        switch self {
        case .passport: return LText(es: "Pasaporte", en: "Passport", ru: "Паспорт", uk: "Паспорт")
        case .tie: return LText(es: "TIE", en: "TIE card", ru: "Карта TIE", uk: "Картка TIE")
        case .residencePermit: return LText(es: "Resolución de residencia", en: "Residence permit decision", ru: "Решение о ВНЖ", uk: "Рішення про посвідку")
        case .nie: return LText(es: "Certificado NIE", en: "NIE certificate", ru: "Сертификат NIE", uk: "Сертифікат NIE")
        case .euRegistration: return LText(es: "Certificado de registro UE", en: "EU registration certificate", ru: "Сертификат резидента ЕС", uk: "Сертифікат резидента ЄС")
        case .padron: return LText(es: "Volante / certificado de padrón", en: "Padrón certificate", ru: "Справка о padrón", uk: "Довідка про padrón")
        case .rentalContract: return LText(es: "Contrato de alquiler", en: "Rental contract", ru: "Договор аренды", uk: "Договір оренди")
        case .digitalCertificate: return LText(es: "Certificado digital", en: "Digital certificate", ru: "Цифровой сертификат", uk: "Цифровий сертифікат")
        case .other: return LText(es: "Otro documento", en: "Other document", ru: "Другой документ", uk: "Інший документ")
        }
    }

    public var symbol: String {
        switch self {
        case .passport: return "book.closed"
        case .tie: return "person.text.rectangle"
        case .residencePermit: return "doc.text.magnifyingglass"
        case .nie: return "number"
        case .euRegistration: return "eurosign.circle"
        case .padron: return "house"
        case .rentalContract: return "key"
        case .digitalCertificate: return "lock.shield"
        case .other: return "doc"
        }
    }

    /// Документы, срок которых продлевается через процедуру renovación.
    public var isRenewableResidence: Bool { self == .tie || self == .residencePermit }
}

/// Событие на шкале сроков.
public struct Milestone: Hashable, Sendable, Identifiable {
    public enum Kind: String, Sendable {
        case renewalWindowOpens, expiresSoon, expiresToday, renewalWindowCloses, passportRenewSoon, padronOld
    }
    public let kind: Kind
    public let date: Date
    public var id: String { "\(kind.rawValue)-\(date.timeIntervalSince1970)" }

    public func title(_ lang: Lang, document: String) -> String {
        switch kind {
        case .renewalWindowOpens:
            return LText(es: "Se abre el plazo de renovación: \(document)",
                         en: "Renewal window opens: \(document)",
                         ru: "Открывается окно продления: \(document)", uk: "Відкривається вікно продовження: \(document)")[lang]
        case .expiresSoon:
            return LText(es: "Caduca pronto: \(document)", en: "Expires soon: \(document)", ru: "Скоро истекает: \(document)", uk: "Скоро спливає: \(document)")[lang]
        case .expiresToday:
            return LText(es: "Caduca hoy: \(document)", en: "Expires today: \(document)", ru: "Истекает сегодня: \(document)", uk: "Спливає сьогодні: \(document)")[lang]
        case .renewalWindowCloses:
            return LText(es: "Último plazo para renovar: \(document)",
                         en: "Last days to renew: \(document)",
                         ru: "Последний срок продления: \(document)", uk: "Останній строк продовження: \(document)")[lang]
        case .passportRenewSoon:
            return LText(es: "Renueva el pasaporte: \(document)", en: "Renew your passport: \(document)", ru: "Пора менять паспорт: \(document)", uk: "Час міняти паспорт: \(document)")[lang]
        case .padronOld:
            return LText(es: "Pide un volante de padrón nuevo: \(document)",
                         en: "Get a fresh padrón certificate: \(document)",
                         ru: "Нужна свежая справка padrón: \(document)", uk: "Потрібна свіжа довідка padrón: \(document)")[lang]
        }
    }
}

public enum Deadlines {
    /// Окно продления по RD 1155/2024: за 60 дней до окончания и до 90 дней после.
    public static let renewalDaysBefore = 60
    public static let renewalDaysAfter = 90
    /// Большинство учреждений принимают справку padrón не старше 3 месяцев.
    public static let padronValidityDays = 90

    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Madrid")!
        return c
    }()

    static func add(_ days: Int, to date: Date) -> Date {
        calendar.date(byAdding: .day, value: days, to: date)!
    }

    public static func renewalWindow(expiry: Date) -> ClosedRange<Date> {
        add(-renewalDaysBefore, to: expiry)...add(renewalDaysAfter, to: expiry)
    }

    /// Все напоминания для документа. Для padrón срок считается от даты выдачи.
    public static func milestones(kind: DocumentKind, expiry: Date?, issued: Date? = nil) -> [Milestone] {
        var result: [Milestone] = []
        if kind.isRenewableResidence, let expiry {
            let window = renewalWindow(expiry: expiry)
            result.append(Milestone(kind: .expiresSoon, date: add(-(renewalDaysBefore + 14), to: expiry)))
            result.append(Milestone(kind: .renewalWindowOpens, date: window.lowerBound))
            result.append(Milestone(kind: .expiresToday, date: expiry))
            result.append(Milestone(kind: .renewalWindowCloses, date: add(-14, to: window.upperBound)))
        } else if kind == .passport, let expiry {
            result.append(Milestone(kind: .passportRenewSoon, date: add(-180, to: expiry)))
            result.append(Milestone(kind: .expiresSoon, date: add(-30, to: expiry)))
            result.append(Milestone(kind: .expiresToday, date: expiry))
        } else if kind == .padron, let issued {
            result.append(Milestone(kind: .padronOld, date: add(padronValidityDays, to: issued)))
        } else if let expiry {
            result.append(Milestone(kind: .expiresSoon, date: add(-30, to: expiry)))
            result.append(Milestone(kind: .expiresToday, date: expiry))
        }
        return result.sorted { $0.date < $1.date }
    }

    /// Только будущие события, по порядку.
    public static func upcoming(_ milestones: [Milestone], after now: Date = Date()) -> [Milestone] {
        milestones.filter { $0.date >= calendar.startOfDay(for: now) }.sorted { $0.date < $1.date }
    }

    public static func daysUntil(_ date: Date, from now: Date = Date()) -> Int {
        calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
    }
}
