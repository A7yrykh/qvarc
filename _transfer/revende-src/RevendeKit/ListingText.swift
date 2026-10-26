import Foundation

/// Что известно о вещи для текста объявления.
public struct ListingFacts: Equatable, Sendable {
    /// Что это: «Chaqueta vaquera», «iPhone 12 128 GB».
    public var name: String
    public var brand: String
    public var category: String
    public var size: String
    public var color: String
    public var material: String
    public var condition: ItemCondition?
    /// Свободные заметки продавца: дефекты, замеры, комплект.
    public var notes: String
    /// Подсказки распознавания с фото (англ. метки Vision, текст с бирки).
    public var detectedLabels: [String]
    public var detectedText: [String]

    public init(
        name: String = "",
        brand: String = "",
        category: String = "",
        size: String = "",
        color: String = "",
        material: String = "",
        condition: ItemCondition? = nil,
        notes: String = "",
        detectedLabels: [String] = [],
        detectedText: [String] = []
    ) {
        self.name = name
        self.brand = brand
        self.category = category
        self.size = size
        self.color = color
        self.material = material
        self.condition = condition
        self.notes = notes
        self.detectedLabels = detectedLabels
        self.detectedText = detectedText
    }

    /// Как назвать вещь, если пользователь не ввёл название.
    public var subject: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        let cat = category.trimmingCharacters(in: .whitespacesAndNewlines)
        return cat.isEmpty ? "Artículo" : cat
    }
}

public struct ListingText: Equatable, Sendable {
    public var title: String
    public var description: String
    public var hashtags: [String]

    public init(title: String, description: String, hashtags: [String]) {
        self.title = title
        self.description = description
        self.hashtags = hashtags
    }

    /// Готовый текст для поля «Descripción»: описание + хэштеги, в пределах лимита площадки.
    public func fullDescription(for platform: Platform) -> String {
        let limits = platform.limits
        guard limits.usesHashtags, !hashtags.isEmpty else {
            return ListingTemplate.fit(description, limit: limits.description)
        }
        let tags = hashtags.joined(separator: " ")
        let room = limits.description - tags.count - 2
        guard room > 0 else { return ListingTemplate.fit(description, limit: limits.description) }
        return ListingTemplate.fit(description, limit: room) + "\n\n" + tags
    }

    /// Обрезает под лимиты площадки.
    public func fitted(to platform: Platform) -> ListingText {
        ListingText(
            title: ListingTemplate.fit(title, limit: platform.limits.title, ellipsis: false),
            description: description,
            hashtags: platform.limits.usesHashtags ? hashtags : []
        )
    }
}

/// Текст объявления без ИИ: используется на устройствах без Apple Intelligence
/// и как подстраховка, если модель вернула пустой ответ.
public enum ListingTemplate {
    public static func make(_ facts: ListingFacts, for platform: Platform) -> ListingText {
        ListingText(
            title: title(facts, for: platform),
            description: description(facts, for: platform),
            hashtags: platform.limits.usesHashtags ? hashtags(facts) : []
        )
    }

    public static func title(_ facts: ListingFacts, for platform: Platform) -> String {
        let subject = facts.subject
        var parts = [subject]
        let brand = facts.brand.trimmed
        if !brand.isEmpty, !subject.localizedCaseInsensitiveContains(brand) {
            parts.append(brand)
        }
        let size = facts.size.trimmed
        if !size.isEmpty { parts.append(looksLikeClothingSize(size) ? "talla \(size)" : size) }
        let color = facts.color.trimmed
        if !color.isEmpty { parts.append(color.lowercased()) }
        if facts.condition == .newWithTags { parts.append("nuevo con etiquetas") }

        // Добавляем части, пока помещаются: важнее название и бренд, чем цвет.
        let limit = platform.limits.title
        var result = ""
        for part in parts {
            let next = result.isEmpty ? part : result + " " + part
            if next.count <= limit { result = next } else if result.isEmpty { result = fit(part, limit: limit, ellipsis: false) }
        }
        return result
    }

    public static func description(_ facts: ListingFacts, for platform: Platform) -> String {
        var lines: [String] = []
        let brand = facts.brand.trimmed
        let subject = facts.subject
        if !brand.isEmpty, !subject.localizedCaseInsensitiveContains(brand) {
            lines.append("\(subject) de \(brand).")
        } else {
            lines.append("\(subject).")
        }
        if let condition = facts.condition { lines.append(condition.phrase) }

        var details: [String] = []
        if !facts.size.trimmed.isEmpty { details.append("Talla: \(facts.size.trimmed)") }
        if !facts.color.trimmed.isEmpty { details.append("Color: \(facts.color.trimmed)") }
        if !facts.material.trimmed.isEmpty { details.append("Material: \(facts.material.trimmed)") }
        if let condition = facts.condition { details.append("Estado: \(condition.label(on: platform))") }
        if !details.isEmpty {
            lines.append("")
            lines.append(contentsOf: details.map { "• \($0)" })
        }
        if !facts.notes.trimmed.isEmpty {
            lines.append("")
            lines.append(facts.notes.trimmed)
        }
        lines.append("")
        lines.append("Envío rápido y bien embalado. Si tienes cualquier duda, pregúntame.")
        return lines.joined(separator: "\n")
    }

    /// Хэштеги в стиле Vinted: #marca #categoria #talla.
    public static func hashtags(_ facts: ListingFacts, max count: Int = 6) -> [String] {
        var words: [String] = []
        for source in [facts.brand, facts.category, facts.name, facts.color] {
            for word in source.split(whereSeparator: { $0 == " " || $0 == "," || $0 == "/" }) {
                words.append(String(word))
            }
        }
        var seen = Set<String>()
        var tags: [String] = []
        for word in words {
            let tag = normalizeTag(word)
            guard tag.count >= 3, !stopWords.contains(tag), seen.insert(tag).inserted else { continue }
            tags.append("#" + tag)
            if tags.count == count { break }
        }
        return tags
    }

    /// Обрезает по границе слова. Для заголовков без многоточия.
    public static func fit(_ text: String, limit: Int, ellipsis: Bool = true) -> String {
        guard limit > 0 else { return "" }
        guard text.count > limit else { return text }
        let suffix = ellipsis ? "…" : ""
        let hardLimit = limit - suffix.count
        let cut = String(text.prefix(hardLimit))
        if let space = cut.lastIndex(where: { $0 == " " || $0 == "\n" }),
           cut.distance(from: cut.startIndex, to: space) > hardLimit / 2 {
            return cut[..<space].trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)) + suffix
        }
        return cut.trimmingCharacters(in: .whitespacesAndNewlines) + suffix
    }

    static func normalizeTag(_ word: some StringProtocol) -> String {
        String(word)
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_ES"))
            .lowercased()
            .filter { $0.isLetter || $0.isNumber }
    }

    static func looksLikeClothingSize(_ size: String) -> Bool {
        let upper = size.uppercased()
        if ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"].contains(upper) { return true }
        if let number = Int(upper), (16...60).contains(number) { return true }
        return false
    }

    static let stopWords: Set<String> = ["con", "sin", "para", "por", "del", "las", "los", "una", "uno"]
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
