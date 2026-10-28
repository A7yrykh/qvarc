import Foundation

/// Провинции Испании с кодами INE (01–52). Провинция нужна для портала cita previa
/// и для поиска сайта ayuntamiento.
public struct Province: Hashable, Identifiable, Sendable {
    public let code: String
    public let name: String
    public var id: String { code }

    public static let all: [Province] = [
        ("01", "Araba/Álava"), ("02", "Albacete"), ("03", "Alicante/Alacant"), ("04", "Almería"),
        ("05", "Ávila"), ("06", "Badajoz"), ("07", "Illes Balears"), ("08", "Barcelona"),
        ("09", "Burgos"), ("10", "Cáceres"), ("11", "Cádiz"), ("12", "Castellón/Castelló"),
        ("13", "Ciudad Real"), ("14", "Córdoba"), ("15", "A Coruña"), ("16", "Cuenca"),
        ("17", "Girona"), ("18", "Granada"), ("19", "Guadalajara"), ("20", "Gipuzkoa"),
        ("21", "Huelva"), ("22", "Huesca"), ("23", "Jaén"), ("24", "León"),
        ("25", "Lleida"), ("26", "La Rioja"), ("27", "Lugo"), ("28", "Madrid"),
        ("29", "Málaga"), ("30", "Murcia"), ("31", "Navarra"), ("32", "Ourense"),
        ("33", "Asturias"), ("34", "Palencia"), ("35", "Las Palmas"), ("36", "Pontevedra"),
        ("37", "Salamanca"), ("38", "Santa Cruz de Tenerife"), ("39", "Cantabria"), ("40", "Segovia"),
        ("41", "Sevilla"), ("42", "Soria"), ("43", "Tarragona"), ("44", "Teruel"),
        ("45", "Toledo"), ("46", "Valencia/València"), ("47", "Valladolid"), ("48", "Bizkaia"),
        ("49", "Zamora"), ("50", "Zaragoza"), ("51", "Ceuta"), ("52", "Melilla"),
    ].map { Province(code: $0.0, name: $0.1) }

    public static func named(code: String) -> Province? {
        all.first { $0.code == code }
    }

    /// Список, отсортированный по алфавиту (для выбора в интерфейсе).
    public static var sortedByName: [Province] {
        all.sorted { $0.name.compare($1.name, locale: Locale(identifier: "es")) == .orderedAscending }
    }
}
