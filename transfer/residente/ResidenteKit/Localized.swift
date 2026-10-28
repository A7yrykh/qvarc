import Foundation

/// Языки интерфейса и контента. Язык выбирается в приложении, а не берётся из системы:
/// у многих экспатов телефон на одном языке, а читать про трамиты удобнее на другом.
public enum Lang: String, CaseIterable, Codable, Sendable, Identifiable {
    case es, en, ru, uk

    public var id: String { rawValue }

    public var nativeName: String {
        switch self {
        case .es: return "Español"
        case .en: return "English"
        case .ru: return "Русский"
        case .uk: return "Українська"
        }
    }

    public var locale: Locale { Locale(identifier: rawValue) }

    /// Язык по умолчанию из настроек системы, если он поддерживается.
    public static func preferred(_ identifiers: [String] = Locale.preferredLanguages) -> Lang {
        for id in identifiers {
            let code = String(id.prefix(2)).lowercased()
            if let lang = Lang(rawValue: code) { return lang }
            if code == "be" { return .ru }
        }
        return .en
    }
}

/// Текст на всех языках приложения.
public struct LText: Hashable, Sendable {
    public let es: String
    public let en: String
    public let ru: String
    public let uk: String

    public init(es: String, en: String, ru: String, uk: String) {
        self.es = es
        self.en = en
        self.ru = ru
        self.uk = uk
    }

    /// Один и тот же текст на всех языках (названия форм, имена собственные).
    public init(_ same: String) {
        self.init(es: same, en: same, ru: same, uk: same)
    }

    public subscript(lang: Lang) -> String {
        switch lang {
        case .es: return es
        case .en: return en
        case .ru: return ru
        case .uk: return uk
        }
    }

    public var all: [String] { [es, en, ru, uk] }
}
