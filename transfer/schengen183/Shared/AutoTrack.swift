import Foundation

/// Автоучёт по геопозиции: текущее открытое пребывание продолжается, пока телефон
/// не увидит другую страну. День переезда записывается в обе страны.
enum AutoTrack {
    enum Action: Equatable {
        case none
        case open(country: String, on: Day)
        case move(closeOn: Day, country: String)
    }

    static func action(current: (country: String, start: Day)?, observed: String, on day: Day) -> Action {
        let code = observed.uppercased()
        guard code.count == 2 else { return .none }
        guard let current else { return .open(country: code, on: day) }
        if current.country.uppercased() == code || day < current.start { return .none }
        return .move(closeOn: day, country: code)
    }
}

enum ReportBuilder {
    struct Row {
        let traveler: String
        let stay: Stay
        let ongoing: Bool
    }

    /// CSV с разделителем «,» и кавычками по RFC 4180.
    static func csv(rows: [Row], header: [String]) -> String {
        var lines = [header.map(quote).joined(separator: ",")]
        for row in rows.sorted(by: { ($0.traveler, $0.stay.start) < ($1.traveler, $1.stay.start) }) {
            lines.append([
                row.traveler,
                row.stay.country,
                Countries.name(row.stay.country, locale: Locale(identifier: "en")),
                row.stay.isSchengen ? "yes" : "no",
                row.stay.start.iso,
                row.ongoing ? "" : row.stay.end.iso,
                String(row.stay.length),
            ].map(quote).joined(separator: ","))
        }
        return lines.joined(separator: "\r\n") + "\r\n"
    }

    static func quote(_ value: String) -> String {
        guard value.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" }) else { return value }
        return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
