import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Текст объявления: Apple Intelligence на устройстве, если доступна, иначе шаблон.
enum ListingGenerator {
    enum Engine {
        case appleIntelligence
        case template

        var displayName: String {
            switch self {
            case .appleIntelligence: "Apple Intelligence"
            case .template: String(localized: "Plantilla")
            }
        }
    }

    struct Result {
        var text: ListingText
        var engine: Engine
    }

    /// Почему ИИ недоступен — чтобы честно сказать пользователю.
    static var unavailableReason: String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return nil
            case .unavailable(.deviceNotEligible):
                return String(localized: "Este iPhone no tiene Apple Intelligence. Usamos una plantilla.")
            case .unavailable(.appleIntelligenceNotEnabled):
                return String(localized: "Activa Apple Intelligence en Ajustes para textos con IA.")
            case .unavailable(.modelNotReady):
                return String(localized: "Apple Intelligence se está descargando. Mientras tanto, usamos una plantilla.")
            case .unavailable:
                return String(localized: "Apple Intelligence no está disponible. Usamos una plantilla.")
            }
        }
        #endif
        return String(localized: "Los textos con IA necesitan iOS 26 y Apple Intelligence. Usamos una plantilla.")
    }

    static var isAIAvailable: Bool { unavailableReason == nil }

    static func generate(_ facts: ListingFacts, for platform: Platform) async -> Result {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), isAIAvailable {
            if let text = try? await AIListingWriter.write(facts, for: platform) {
                return Result(text: text, engine: .appleIntelligence)
            }
        }
        #endif
        return Result(text: ListingTemplate.make(facts, for: platform), engine: .template)
    }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
struct GeneratedListing {
    @Guide(description: "Título del anuncio en español: qué es, marca, modelo o talla. Sin emojis ni mayúsculas gritonas.")
    var title: String

    @Guide(description: "Descripción del anuncio en español de España, 3 a 6 frases cortas, honesta, con medidas o detalles si se conocen.")
    var body: String

    @Guide(description: "Entre 3 y 6 hashtags en minúsculas, sin espacios ni tildes, cada uno empieza por #.")
    var hashtags: [String]
}

@available(iOS 26.0, *)
enum AIListingWriter {
    static let instructions = """
    Eres un vendedor experto en Vinted, Wallapop y eBay en España. \
    Escribes anuncios de segunda mano claros y atractivos en español de España. \
    Usa solo los datos que te dan. No inventes marca, talla, medidas, materiales ni defectos. \
    Las pistas de la foto pueden ser incorrectas: úsalas solo si encajan con los datos. \
    No prometas envío gratis ni rebajas. Tono cercano y profesional, tuteando.
    """

    static func write(_ facts: ListingFacts, for platform: Platform) async throws -> ListingText {
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(to: prompt(facts, for: platform), generating: GeneratedListing.self)
        let generated = response.content

        let fallback = ListingTemplate.make(facts, for: platform)
        let title = generated.title.trimmed.isEmpty ? fallback.title : generated.title.trimmed
        let description = generated.body.trimmed.isEmpty ? fallback.description : generated.body.trimmed
        let tags = generated.hashtags
            .map { "#" + ListingTemplate.normalizeTag($0) }
            .filter { $0.count > 3 }
        var seen = Set<String>()
        let uniqueTags = tags.filter { seen.insert($0).inserted }

        return ListingText(
            title: title,
            description: description,
            hashtags: uniqueTags.isEmpty ? fallback.hashtags : Array(uniqueTags.prefix(6))
        ).fitted(to: platform)
    }

    static func prompt(_ facts: ListingFacts, for platform: Platform) -> String {
        let limits = platform.limits
        var lines = ["Escribe un anuncio para \(platform.displayName)."]
        lines.append("Título: máximo \(limits.title) caracteres. Descripción: máximo \(min(limits.description, 900)) caracteres.")
        if !limits.usesHashtags { lines.append("En esta plataforma no se usan hashtags; devuelve la lista vacía.") }
        lines.append("")
        lines.append("Datos del artículo:")
        lines.append("- Qué es: \(facts.subject)")
        if !facts.brand.trimmed.isEmpty { lines.append("- Marca: \(facts.brand.trimmed)") }
        if !facts.category.trimmed.isEmpty { lines.append("- Categoría: \(facts.category.trimmed)") }
        if !facts.size.trimmed.isEmpty { lines.append("- Talla o tamaño: \(facts.size.trimmed)") }
        if !facts.color.trimmed.isEmpty { lines.append("- Color: \(facts.color.trimmed)") }
        if !facts.material.trimmed.isEmpty { lines.append("- Material: \(facts.material.trimmed)") }
        if let condition = facts.condition {
            lines.append("- Estado: \(condition.label(on: platform)) (\(condition.phrase))")
        }
        if !facts.notes.trimmed.isEmpty { lines.append("- Notas del vendedor: \(facts.notes.trimmed)") }
        if !facts.detectedLabels.isEmpty {
            lines.append("- Pistas de la foto (en inglés, pueden fallar): \(facts.detectedLabels.joined(separator: ", "))")
        }
        if !facts.detectedText.isEmpty {
            lines.append("- Texto visto en la etiqueta: \(facts.detectedText.joined(separator: " | "))")
        }
        return lines.joined(separator: "\n")
    }
}
#endif
