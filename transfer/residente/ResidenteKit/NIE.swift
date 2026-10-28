import Foundation

/// Проверка NIE (X/Y/Z + 7 цифр + контрольная буква) и DNI.
public enum NIE {
    static let letters = Array("TRWAGMYFPDXBNJZSQVHLCKE")

    /// Убирает пробелы, точки и дефисы, переводит в верхний регистр.
    public static func normalize(_ raw: String) -> String {
        raw.uppercased().filter { $0.isLetter || $0.isNumber }
    }

    public static func isValid(_ raw: String) -> Bool {
        let s = normalize(raw)
        guard s.count == 9, let first = s.first, let last = s.last, last.isLetter else { return false }
        let prefix: Character
        switch first {
        case "X": prefix = "0"
        case "Y": prefix = "1"
        case "Z": prefix = "2"
        default: return false
        }
        let digits = String(prefix) + s.dropFirst().dropLast()
        guard digits.count == 8, digits.allSatisfy(\.isNumber), let number = Int(digits) else { return false }
        return letters[number % 23] == last
    }

    /// Формат для показа: X-1234567-L.
    public static func formatted(_ raw: String) -> String {
        let s = normalize(raw)
        guard s.count == 9 else { return s }
        let chars = Array(s)
        return "\(chars[0])-\(String(chars[1...7]))-\(chars[8])"
    }

    /// Все корректные NIE, найденные в тексте (например, после OCR).
    public static func find(in text: String) -> [String] {
        let pattern = #"\b[XYZxyz][\s.\-]?\d{7}[\s.\-]?[A-Za-z]\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        var result: [String] = []
        for match in regex.matches(in: text, range: range) {
            guard let r = Range(match.range, in: text) else { continue }
            let candidate = normalize(String(text[r]))
            if isValid(candidate), !result.contains(candidate) { result.append(candidate) }
        }
        return result
    }
}
