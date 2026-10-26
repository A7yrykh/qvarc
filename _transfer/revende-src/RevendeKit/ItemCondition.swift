import Foundation

/// Состояние вещи. Внутри одна шкала, на каждой площадке — её собственные названия.
public enum ItemCondition: String, CaseIterable, Codable, Identifiable, Sendable {
    case newWithTags
    case newWithoutTags
    case veryGood
    case good
    case satisfactory

    public var id: String { rawValue }

    /// Название в интерфейсе (переводится).
    public var displayName: String {
        switch self {
        case .newWithTags: String(localized: "Nuevo con etiquetas")
        case .newWithoutTags: String(localized: "Nuevo sin etiquetas")
        case .veryGood: String(localized: "Muy bueno")
        case .good: String(localized: "Bueno")
        case .satisfactory: String(localized: "Satisfactorio")
        }
    }

    /// Название на Vinted — объявления пишутся по-испански, независимо от языка iPhone.
    var spanishName: String {
        switch self {
        case .newWithTags: "Nuevo con etiquetas"
        case .newWithoutTags: "Nuevo sin etiquetas"
        case .veryGood: "Muy bueno"
        case .good: "Bueno"
        case .satisfactory: "Satisfactorio"
        }
    }

    /// Название состояния в форме площадки.
    public func label(on platform: Platform) -> String {
        switch platform {
        case .vinted, .other, .milanuncios:
            return spanishName
        case .wallapop:
            switch self {
            case .newWithTags, .newWithoutTags: return "Nuevo"
            case .veryGood: return "Como nuevo"
            case .good: return "En buen estado"
            case .satisfactory: return "En condiciones aceptables"
            }
        case .ebay:
            switch self {
            case .newWithTags: return "Nuevo con etiquetas"
            case .newWithoutTags: return "Nuevo sin etiquetas"
            case .veryGood: return "Usado - Muy bueno"
            case .good: return "Usado - Bueno"
            case .satisfactory: return "Usado - Aceptable"
            }
        }
    }

    /// Фраза для описания объявления.
    public var phrase: String {
        switch self {
        case .newWithTags: "Nuevo, sin estrenar y con etiquetas."
        case .newWithoutTags: "Nuevo, sin usar, sin etiquetas."
        case .veryGood: "Usado muy poco, sin defectos visibles."
        case .good: "Usado, en buen estado, con algún signo leve de uso."
        case .satisfactory: "Con señales de uso visibles (ver fotos)."
        }
    }
}
