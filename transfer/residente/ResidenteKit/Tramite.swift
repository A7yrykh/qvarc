import Foundation

/// Для кого трамит.
public enum Audience: String, Codable, Sendable {
    case everyone, euCitizens, nonEUCitizens
}

/// Официальная форма или тасa, с которой помогает «Помощник по формам».
public enum FormKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case ex15, ex17, ex18, tasa790012

    public var id: String { rawValue }

    public var code: String {
        switch self {
        case .ex15: return "EX-15"
        case .ex17: return "EX-17"
        case .ex18: return "EX-18"
        case .tasa790012: return "790-012"
        }
    }
}

public struct FormRef: Hashable, Sendable, Identifiable {
    public let kind: FormKind
    public let title: LText
    public let url: URL
    /// Что отметить в форме (раздел «Tipo de documento» или пункт таса).
    public let mark: LText?
    /// Сумма таса, если это таса.
    public let amount: Decimal?
    public var id: String { kind.rawValue }

    public init(kind: FormKind, title: LText, url: URL, mark: LText? = nil, amount: Decimal? = nil) {
        self.kind = kind
        self.title = title
        self.url = url
        self.mark = mark
        self.amount = amount
    }
}

public struct Requirement: Hashable, Sendable, Identifiable {
    public let id: String
    public let text: LText
    public let note: LText?

    public init(_ id: String, _ text: LText, note: LText? = nil) {
        self.id = id
        self.text = text
        self.note = note
    }
}

public struct Step: Hashable, Sendable, Identifiable {
    public let id: String
    public let title: LText
    public let detail: LText
    public let link: URL?
    /// Шаг записи на cita: на нём экран показывает помощник записи.
    public let isCita: Bool

    public init(_ id: String, _ title: LText, _ detail: LText, link: URL? = nil, isCita: Bool = false) {
        self.id = id
        self.title = title
        self.detail = detail
        self.link = link
        self.isCita = isCita
    }
}

/// Как записаться на приём. Ботов и автопроверки слотов нет: только честные подсказки.
public struct CitaInfo: Hashable, Sendable {
    public enum Portal: Hashable, Sendable {
        /// Единый портал cita previa (Policía / Extranjería): провинция выбирается на первом шаге.
        case icp
        /// Запись на сайте ayuntamiento или другого ведомства.
        case other(URL?)
    }

    public let portal: Portal
    /// Точное название услуги в портале. В разных провинциях оно может немного отличаться.
    public let serviceName: String?
    public let whereText: LText
    public let tips: [LText]

    public init(portal: Portal, serviceName: String?, whereText: LText, tips: [LText] = []) {
        self.portal = portal
        self.serviceName = serviceName
        self.whereText = whereText
        self.tips = tips
    }

    public static let icpURL = URL(string: "https://icp.administracionelectronica.gob.es/icpplus/index.html")!
}

public struct Source: Hashable, Sendable {
    public let title: LText
    public let url: URL

    public init(_ title: LText, _ url: URL) {
        self.title = title
        self.url = url
    }
}

public struct Tramite: Hashable, Sendable, Identifiable {
    public let id: String
    public let symbol: String
    public let audience: Audience
    public let title: LText
    public let summary: LText
    public let who: LText
    public let whereToApply: LText
    public let cost: LText
    public let duration: LText
    public let deadline: LText?
    public let forms: [FormRef]
    public let documents: [Requirement]
    public let steps: [Step]
    public let cita: CitaInfo?
    public let tips: [LText]
    public let sources: [Source]
    /// Дата последней проверки контента по официальным источникам (ГГГГ-ММ-ДД).
    public let verifiedOn: String
    /// Вид документа, который получается в итоге (чтобы предложить добавить его в хранилище).
    public let resultDocument: DocumentKind?

    public init(id: String, symbol: String, audience: Audience, title: LText, summary: LText, who: LText,
                whereToApply: LText, cost: LText, duration: LText, deadline: LText? = nil, forms: [FormRef] = [],
                documents: [Requirement], steps: [Step], cita: CitaInfo? = nil, tips: [LText] = [],
                sources: [Source], verifiedOn: String, resultDocument: DocumentKind? = nil) {
        self.id = id
        self.symbol = symbol
        self.audience = audience
        self.title = title
        self.summary = summary
        self.who = who
        self.whereToApply = whereToApply
        self.cost = cost
        self.duration = duration
        self.deadline = deadline
        self.forms = forms
        self.documents = documents
        self.steps = steps
        self.cita = cita
        self.tips = tips
        self.sources = sources
        self.verifiedOn = verifiedOn
        self.resultDocument = resultDocument
    }

    public func progress(completedSteps: Set<String>) -> Double {
        guard !steps.isEmpty else { return 0 }
        let done = steps.filter { completedSteps.contains($0.id) }.count
        return Double(done) / Double(steps.count)
    }
}
