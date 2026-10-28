import Foundation

/// Личные данные для заполнения форм. Хранятся только на устройстве.
public struct PersonalData: Codable, Equatable, Sendable {
    public enum Sex: String, Codable, CaseIterable, Sendable { case h = "H", m = "M", x = "X" }
    public enum MaritalStatus: String, Codable, CaseIterable, Sendable {
        case soltero = "S", casado = "C", viudo = "V", divorciado = "D", separado = "Sp"
    }

    public var passport = ""
    public var nie = ""
    public var firstSurname = ""
    public var secondSurname = ""
    public var name = ""
    public var sex: Sex?
    public var birthDate: Date?
    public var birthPlace = ""
    public var birthCountry = ""
    public var nationality = ""
    public var maritalStatus: MaritalStatus?
    public var fatherName = ""
    public var motherName = ""
    public var street = ""
    public var number = ""
    public var floor = ""
    public var city = ""
    public var postalCode = ""
    public var province = ""
    public var phone = ""
    public var email = ""

    public init() {}
}

extension PersonalData.Sex {
    public var title: LText {
        switch self {
        case .h: return LText(es: "Hombre (H)", en: "Male (H)", ru: "Мужской (H)", uk: "Чоловіча (H)")
        case .m: return LText(es: "Mujer (M)", en: "Female (M)", ru: "Женский (M)", uk: "Жіноча (M)")
        case .x: return LText(es: "No binario (X)", en: "Non-binary (X)", ru: "Небинарный (X)", uk: "Небінарна (X)")
        }
    }
}

extension PersonalData.MaritalStatus {
    public var title: LText {
        switch self {
        case .soltero: return LText(es: "Soltero/a (S)", en: "Single (S)", ru: "Не в браке (S)", uk: "Не в шлюбі (S)")
        case .casado: return LText(es: "Casado/a (C)", en: "Married (C)", ru: "В браке (C)", uk: "У шлюбі (C)")
        case .viudo: return LText(es: "Viudo/a (V)", en: "Widowed (V)", ru: "Вдова/вдовец (V)", uk: "Вдова/вдівець (V)")
        case .divorciado: return LText(es: "Divorciado/a (D)", en: "Divorced (D)", ru: "В разводе (D)", uk: "Розлучений(-а) (D)")
        case .separado: return LText(es: "Separado/a (Sp)", en: "Separated (Sp)", ru: "Раздельно (Sp)", uk: "Окремо (Sp)")
        }
    }
}

/// Одна графа формы: подпись как в бланке, подсказка и значение из профиля.
public struct FormField: Identifiable, Sendable {
    public let id: String
    public let label: String
    public let hint: LText?
    public let value: String

    public var isEmpty: Bool { value.trimmingCharacters(in: .whitespaces).isEmpty }
}

public struct FormSection: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let fields: [FormField]
}

public enum FormHelper {
    static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_ES")
        f.timeZone = TimeZone(identifier: "Europe/Madrid")
        f.dateFormat = "dd/MM/yyyy"
        return f
    }()

    /// Шпаргалка для EX-15, EX-17, EX-18: раздел 1 у них общий («Datos del extranjero»).
    /// В бланках имена и фамилии пишут ЗАГЛАВНЫМИ буквами, как в паспорте.
    public static func sections(for kind: FormKind, data d: PersonalData) -> [FormSection] {
        switch kind {
        case .ex15, .ex17, .ex18:
            return [foreignerSection(d), addressSection(d)]
        case .tasa790012:
            return [tasaSection(d)]
        }
    }

    static func foreignerSection(_ d: PersonalData) -> FormSection {
        FormSection(id: "1", title: "1) DATOS DEL EXTRANJERO/A", fields: [
            FormField(id: "passport", label: "PASAPORTE", hint: nil, value: d.passport.uppercased()),
            FormField(id: "nie", label: "N.I.E.", hint: LText(es: "Déjalo vacío si aún no tienes NIE.", en: "Leave empty if you have no NIE yet.", ru: "Оставьте пустым, если NIE ещё нет.", uk: "Залиште порожнім, якщо NIE ще немає."),
                      value: d.nie.isEmpty ? "" : NIE.formatted(d.nie)),
            FormField(id: "surname1", label: "1er Apellido", hint: nil, value: d.firstSurname.uppercased()),
            FormField(id: "surname2", label: "2º Apellido", hint: nil, value: d.secondSurname.uppercased()),
            FormField(id: "name", label: "Nombre", hint: nil, value: d.name.uppercased()),
            FormField(id: "sex", label: "Sexo", hint: LText(es: "H = hombre, M = mujer, X = no binario", en: "H = male, M = female, X = non-binary", ru: "H — мужской, M — женский, X — небинарный", uk: "H — чоловіча, M — жіноча, X — небінарна"),
                      value: d.sex?.rawValue ?? ""),
            FormField(id: "birthDate", label: "Fecha de nacimiento", hint: LText(es: "dd/mm/aaaa", en: "dd/mm/yyyy", ru: "дд/мм/гггг", uk: "дд/мм/рррр"),
                      value: d.birthDate.map { dateFormatter.string(from: $0) } ?? ""),
            FormField(id: "birthPlace", label: "Lugar", hint: nil, value: d.birthPlace.uppercased()),
            FormField(id: "birthCountry", label: "País", hint: LText(es: "País de nacimiento", en: "Country of birth", ru: "Страна рождения", uk: "Країна народження"), value: d.birthCountry.uppercased()),
            FormField(id: "nationality", label: "Nacionalidad", hint: nil, value: d.nationality.uppercased()),
            FormField(id: "marital", label: "Estado civil", hint: LText(es: "S, C, V, D o Sp", en: "S, C, V, D or Sp", ru: "S, C, V, D или Sp", uk: "S, C, V, D або Sp"), value: d.maritalStatus?.rawValue ?? ""),
            FormField(id: "father", label: "Nombre del padre", hint: nil, value: d.fatherName.uppercased()),
            FormField(id: "mother", label: "Nombre de la madre", hint: nil, value: d.motherName.uppercased()),
            FormField(id: "phone", label: "Teléfono móvil", hint: nil, value: d.phone),
            FormField(id: "email", label: "E-mail", hint: nil, value: d.email),
        ])
    }

    static func addressSection(_ d: PersonalData) -> FormSection {
        FormSection(id: "address", title: "DOMICILIO EN ESPAÑA", fields: [
            FormField(id: "street", label: "Domicilio en España", hint: LText(es: "Calle, avenida…", en: "Street, avenue…", ru: "Улица, проспект…", uk: "Вулиця, проспект…"), value: d.street.uppercased()),
            FormField(id: "number", label: "Nº", hint: nil, value: d.number),
            FormField(id: "floor", label: "Piso", hint: nil, value: d.floor.uppercased()),
            FormField(id: "city", label: "Localidad", hint: nil, value: d.city.uppercased()),
            FormField(id: "postalCode", label: "C.P.", hint: nil, value: d.postalCode),
            FormField(id: "province", label: "Provincia", hint: nil, value: d.province.uppercased()),
        ])
    }

    static func tasaSection(_ d: PersonalData) -> FormSection {
        let fullName = [d.firstSurname, d.secondSurname, d.name].filter { !$0.isEmpty }.joined(separator: " ").uppercased()
        let address = [d.street, d.number, d.floor].filter { !$0.isEmpty }.joined(separator: " ").uppercased()
        return FormSection(id: "tasa", title: "IDENTIFICACIÓN", fields: [
            FormField(id: "nif", label: "NIF/NIE", hint: LText(es: "Si no tienes NIE, la web permite indicar el pasaporte.", en: "If you have no NIE, the site lets you enter your passport.", ru: "Если NIE нет, сайт позволяет указать паспорт.", uk: "Якщо NIE немає, сайт дозволяє вказати паспорт."),
                      value: d.nie.isEmpty ? d.passport.uppercased() : NIE.normalize(d.nie)),
            FormField(id: "fullName", label: "Apellidos y nombre", hint: nil, value: fullName),
            FormField(id: "street", label: "Calle/Plaza/Avda.", hint: nil, value: address),
            FormField(id: "city", label: "Municipio", hint: nil, value: d.city.uppercased()),
            FormField(id: "postalCode", label: "Código Postal", hint: nil, value: d.postalCode),
            FormField(id: "province", label: "Provincia", hint: nil, value: d.province.uppercased()),
            FormField(id: "phone", label: "Teléfono", hint: nil, value: d.phone),
        ])
    }
}
