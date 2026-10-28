import Foundation

/// Где человек сейчас.
public enum Stage: String, CaseIterable, Codable, Sendable, Identifiable {
    /// Нужен только номер NIE (покупка жилья, работа без переезда).
    case needNIEOnly
    /// Только переехал или переезжает.
    case justArrived
    /// Уже живёт с документами.
    case resident
    /// Скоро продление.
    case renewing

    public var id: String { rawValue }

    public var title: LText {
        switch self {
        case .needNIEOnly: return LText(es: "Solo necesito un NIE", en: "I only need an NIE", ru: "Мне нужен только NIE", uk: "Мені потрібен лише NIE")
        case .justArrived: return LText(es: "Acabo de llegar", en: "I just arrived", ru: "Я только переехал(а)", uk: "Я щойно переїхав(-ла)")
        case .resident: return LText(es: "Ya tengo mis papeles", en: "I already have my papers", ru: "Документы уже есть", uk: "Документи вже є")
        case .renewing: return LText(es: "Tengo que renovar", en: "I need to renew", ru: "Нужно продлевать", uk: "Треба продовжувати")
        }
    }
}

public struct Situation: Equatable, Sendable {
    public var isEUCitizen: Bool
    public var stage: Stage

    public init(isEUCitizen: Bool, stage: Stage) {
        self.isEUCitizen = isEUCitizen
        self.stage = stage
    }
}

public enum PlanBuilder {
    /// Рекомендуемые трамиты по порядку.
    public static func recommended(for s: Situation) -> [String] {
        let ids: [String]
        switch (s.isEUCitizen, s.stage) {
        case (_, .needNIEOnly):
            ids = ["nie", "digital-certificate"]
        case (true, .justArrived):
            ids = ["padron", "eu-registration", "digital-certificate", "clave"]
        case (true, .resident), (true, .renewing):
            ids = ["padron", "digital-certificate", "clave"]
        case (false, .justArrived):
            ids = ["padron", "tie-first", "digital-certificate", "clave"]
        case (false, .resident):
            ids = ["digital-certificate", "clave", "renewal"]
        case (false, .renewing):
            ids = ["renewal", "digital-certificate", "clave"]
        }
        return ids.filter { id in
            guard let t = Catalog.tramite(id: id) else { return false }
            return isApplicable(t, isEUCitizen: s.isEUCitizen)
        }
    }

    public static func isApplicable(_ t: Tramite, isEUCitizen: Bool) -> Bool {
        switch t.audience {
        case .everyone: return true
        case .euCitizens: return isEUCitizen
        case .nonEUCitizens: return !isEUCitizen
        }
    }
}
