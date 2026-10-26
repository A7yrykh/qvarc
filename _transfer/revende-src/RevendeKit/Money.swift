import Foundation

/// Суммы в евро храним как Decimal, округляем до центов только на выходе расчёта.
public enum Money {
    public static let zero: Decimal = 0
    public static let cent: Decimal = Decimal(string: "0.01")!

    public static func round(
        _ value: Decimal,
        scale: Int = 2,
        mode: NSDecimalNumber.RoundingMode = .plain
    ) -> Decimal {
        var input = value
        var result = Decimal()
        NSDecimalRound(&result, &input, scale, mode)
        return result
    }

    /// Округление вверх до цента — для цен, ниже которых продавать нельзя.
    public static func roundUp(_ value: Decimal) -> Decimal {
        round(value, mode: .up)
    }

    public static func format(_ value: Decimal, locale: Locale = Locale(identifier: "es_ES")) -> String {
        value.formatted(.currency(code: "EUR").locale(locale))
    }

    /// «45,1 %».
    public static func percent(_ value: Decimal, locale: Locale = Locale(identifier: "es_ES")) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)).locale(locale)) + " %"
    }

    /// Число для CSV под испанский Excel: «1234,50».
    public static func plain(_ value: Decimal) -> String {
        let rounded = round(value)
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        formatter.usesGroupingSeparator = false
        let text = formatter.string(from: rounded as NSDecimalNumber) ?? "0.00"
        return text.replacingOccurrences(of: ".", with: ",")
    }

    /// Разбирает ввод пользователя: «12,50», «12.5», «1.234,50 €», «€ 3».
    public static func parse(_ text: String) -> Decimal? {
        var cleaned = text
            .replacingOccurrences(of: "€", with: "")
            .replacingOccurrences(of: "\u{00A0}", with: "")
            .replacingOccurrences(of: " ", with: "")
        guard !cleaned.isEmpty else { return nil }
        if cleaned.contains(",") && cleaned.contains(".") {
            // Испанский формат: точка — тысячи, запятая — дробная часть.
            cleaned = cleaned.replacingOccurrences(of: ".", with: "")
        }
        cleaned = cleaned.replacingOccurrences(of: ",", with: ".")
        guard cleaned.allSatisfy({ $0.isNumber || $0 == "." || $0 == "-" }),
              cleaned.filter({ $0 == "." }).count <= 1
        else { return nil }
        return Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX"))
    }
}
