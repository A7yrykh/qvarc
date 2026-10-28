import Foundation

/// Разбор текста, распознанного с документа (TIE, NIE, паспорт, padrón): даты и номера.
/// Работает на обычном тексте, поэтому не зависит от Vision и легко тестируется.
public struct DocumentTextAnalysis: Equatable, Sendable {
    public var expiryDate: Date?
    public var issueDate: Date?
    public var nies: [String]
    public var allDates: [Date]
}

public enum DocumentText {
    /// Слова рядом с датой окончания срока на испанских документах и паспортах.
    static let expiryKeywords = [
        "VALIDEZ", "VÁLIDO HASTA", "VALIDO HASTA", "VÁLIDA HASTA", "VALIDA HASTA",
        "CADUCIDAD", "FECHA DE CADUCIDAD", "EXPIRY", "DATE OF EXPIRY", "EXPIRES",
        "VENCIMIENTO", "FIN DE VIGENCIA", "ДАТА ОКОНЧАНИЯ", "ДЕЙСТВИТЕЛЕН ДО",
    ]
    static let issueKeywords = [
        "EXPEDICIÓN", "EXPEDICION", "FECHA DE EXPEDICIÓN", "DATE OF ISSUE", "ISSUED",
        "EMISIÓN", "EMISION", "ДАТА ВЫДАЧИ",
    ]

    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Madrid")!
        return c
    }()

    public static func analyze(_ text: String, now: Date = Date()) -> DocumentTextAnalysis {
        let lines = text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        var all: [Date] = []
        var expiry: Date?
        var issue: Date?

        for (index, line) in lines.enumerated() {
            let found = Self.dates(in: line)
            all.append(contentsOf: found)
            let upper = line.uppercased()
            // Дата может стоять в той же строке, что и подпись, или в следующей.
            let candidates = found.isEmpty && index + 1 < lines.count ? Self.dates(in: lines[index + 1]) : found
            if expiry == nil, expiryKeywords.contains(where: { upper.contains($0) }), let d = candidates.last {
                expiry = d
            }
            if issue == nil, issueKeywords.contains(where: { upper.contains($0) }), let d = candidates.first {
                issue = d
            }
        }

        if expiry == nil, let mrz = mrzExpiry(lines) {
            expiry = mrz
        }
        // Без подписи берём самую позднюю дату в будущем: у документа это почти всегда срок действия.
        if expiry == nil {
            expiry = all.filter { $0 > now }.max()
        }

        var unique: [Date] = []
        for d in all.sorted() where !unique.contains(d) { unique.append(d) }

        return DocumentTextAnalysis(expiryDate: expiry, issueDate: issue, nies: NIE.find(in: text), allDates: unique)
    }

    /// Даты вида 31/12/2027, 31.12.2027, 31-12-2027 и «31 12 2027» (так печатают на TIE).
    public static func dates(in line: String) -> [Date] {
        let pattern = #"\b(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{4})\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(line.startIndex..., in: line)
        return regex.matches(in: line, range: range).compactMap { match in
            func group(_ i: Int) -> Int? {
                guard let r = Range(match.range(at: i), in: line) else { return nil }
                return Int(line[r])
            }
            guard let day = group(1), let month = group(2), let year = group(3) else { return nil }
            return makeDate(year: year, month: month, day: day)
        }
    }

    static func makeDate(year: Int, month: Int, day: Int) -> Date? {
        guard (1900...2100).contains(year), (1...12).contains(month), (1...31).contains(day) else { return nil }
        let comps = DateComponents(year: year, month: month, day: day, hour: 12)
        guard let date = calendar.date(from: comps) else { return nil }
        // Отсекаем 31.02 и подобное: календарь «переносит» такие даты на следующий месяц.
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        guard back.year == year, back.month == month, back.day == day else { return nil }
        return date
    }

    /// Срок действия из машиночитаемой зоны (MRZ): TD1 (карточки, TIE) и TD3 (паспорта).
    static func mrzExpiry(_ lines: [String]) -> Date? {
        let mrz = lines.map { $0.replacingOccurrences(of: " ", with: "").uppercased() }
            .filter { $0.count >= 30 && $0.contains("<") }
        let sexMarks: Set<Character> = ["M", "F", "X", "<"]
        for line in mrz {
            let chars = Array(line)
            func digits(_ range: Range<Int>) -> Bool {
                range.upperBound <= chars.count && chars[range].allSatisfy(\.isNumber)
            }
            // TD3, строка 2 (44 символа): 13–18 дата рождения, 20 пол, 21–26 срок действия YYMMDD.
            // TD1, строка 2 (30 символов): 0–5 дата рождения, 7 пол, 8–13 срок действия YYMMDD.
            let offset: Int
            if chars.count >= 44, digits(13..<19), sexMarks.contains(chars[20]), digits(21..<27) {
                offset = 21
            } else if chars.count < 44, digits(0..<7), sexMarks.contains(chars[7]), digits(8..<14) {
                offset = 8
            } else {
                continue
            }
            let s = String(chars[offset..<offset + 6])
            guard let yy = Int(s.prefix(2)), let mm = Int(s.dropFirst(2).prefix(2)), let dd = Int(s.suffix(2)) else { continue }
            if let d = makeDate(year: 2000 + yy, month: mm, day: dd) { return d }
        }
        return nil
    }
}
