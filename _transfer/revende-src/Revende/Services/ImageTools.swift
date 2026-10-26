import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

extension UIImage {
    /// Перерисовывает с ориентацией .up и уменьшает длинную сторону до `maxSide`.
    func normalized(maxSide: CGFloat = 2000) -> UIImage {
        let longest = max(size.width, size.height)
        let scale = longest > maxSide ? maxSide / longest : 1
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }

    func jpegForStorage() -> Data? { jpegData(compressionQuality: 0.85) }
}

/// Подсказки для текста объявления: что на фото и что написано на бирке.
enum ImageAnalyzer {
    struct Hints: Equatable {
        var labels: [String] = []
        var text: [String] = []
    }

    static func hints(for image: UIImage) async -> Hints {
        await Task.detached(priority: .userInitiated) { analyze(image) }.value
    }

    private static func analyze(_ image: UIImage) -> Hints {
        guard let cgImage = image.normalized(maxSide: 1200).cgImage else { return Hints() }
        let classify = VNClassifyImageRequest()
        let recognize = VNRecognizeTextRequest()
        recognize.recognitionLevel = .accurate
        recognize.recognitionLanguages = ["es-ES", "en-US"]
        recognize.usesLanguageCorrection = false

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try? handler.perform([classify, recognize])

        let labels = (classify.results ?? [])
            .filter { $0.confidence > 0.3 }
            .sorted { $0.confidence > $1.confidence }
            .prefix(6)
            .map { $0.identifier.replacingOccurrences(of: "_", with: " ") }
        let text = (recognize.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespaces) }
            .filter { $0.count >= 2 }
            .prefix(8)
        return Hints(labels: Array(labels), text: Array(text))
    }
}

enum StudioBackground: String, CaseIterable, Identifiable {
    case white
    case lightGray
    case beige
    case gradient
    case original

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .white: String(localized: "Blanco")
        case .lightGray: String(localized: "Gris claro")
        case .beige: String(localized: "Beige")
        case .gradient: String(localized: "Estudio")
        case .original: String(localized: "Original")
        }
    }

    /// Бесплатно: белый и исходный фон; остальные — в Pro.
    var requiresPro: Bool { self == .lightGray || self == .beige || self == .gradient }

    var colors: [UIColor] {
        switch self {
        case .white: [.white]
        case .lightGray: [UIColor(white: 0.93, alpha: 1)]
        case .beige: [UIColor(red: 0.96, green: 0.93, blue: 0.88, alpha: 1)]
        case .gradient: [UIColor(white: 1, alpha: 1), UIColor(white: 0.86, alpha: 1)]
        case .original: []
        }
    }
}

enum StudioAspect: String, CaseIterable, Identifiable {
    case square
    case portrait
    case tall

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .square: "1:1"
        case .portrait: "4:5"
        case .tall: "3:4"
        }
    }

    var canvas: CGSize {
        switch self {
        case .square: CGSize(width: 1600, height: 1600)
        case .portrait: CGSize(width: 1280, height: 1600)
        case .tall: CGSize(width: 1200, height: 1600)
        }
    }
}

struct StudioOptions: Equatable {
    var background: StudioBackground = .white
    var aspect: StudioAspect = .portrait
    var shadow = true
    var enhance = true
}

/// Фотостудия на устройстве: автосвет, вырезка объекта (Vision), новый фон, тень.
enum PhotoStudio {
    enum StudioError: LocalizedError {
        case noImage
        case noSubject

        var errorDescription: String? {
            switch self {
            case .noImage: String(localized: "No se pudo leer la foto.")
            case .noSubject: String(localized: "No se encontró el objeto en la foto. Prueba con más luz o un fondo liso.")
            }
        }
    }

    private static let context = CIContext()

    /// Автокоррекция света и цвета (как «Mejorar» в Fotos).
    static func enhance(_ image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        var ciImage = CIImage(cgImage: cgImage)
        for filter in ciImage.autoAdjustmentFilters(options: [.redEye: false]) {
            filter.setValue(ciImage, forKey: kCIInputImageKey)
            if let output = filter.outputImage { ciImage = output }
        }
        guard let output = context.createCGImage(ciImage, from: ciImage.extent) else { return image }
        return UIImage(cgImage: output)
    }

    /// Объект без фона (прозрачный), обрезанный по своим границам.
    /// На симуляторе запрос Vision может не работать — проверять на iPhone.
    static func cutout(_ image: UIImage) throws -> UIImage {
        guard let cgImage = image.cgImage else { throw StudioError.noImage }
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try handler.perform([request])
        guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
            throw StudioError.noSubject
        }
        let buffer = try observation.generateMaskedImage(
            ofInstances: observation.allInstances,
            from: handler,
            croppedToInstancesExtent: true
        )
        let masked = CIImage(cvPixelBuffer: buffer)
        guard let output = context.createCGImage(masked, from: masked.extent) else { throw StudioError.noImage }
        return UIImage(cgImage: output)
    }

    /// Полный цикл для одной фотографии. Тяжёлая работа — вне главного потока.
    static func render(_ source: UIImage, options: StudioOptions) async throws -> UIImage {
        try await Task.detached(priority: .userInitiated) {
            let base = source.normalized()
            let prepared = options.enhance ? enhance(base) : base
            if options.background == .original {
                return compose(subject: prepared, options: options, fillCanvas: true)
            }
            let subject = try cutout(prepared)
            return compose(subject: subject, options: options, fillCanvas: false)
        }.value
    }

    /// Кладёт объект на холст нужного формата.
    /// fillCanvas: исходное фото целиком заполняет кадр (кроп по центру), без вырезки.
    static func compose(subject: UIImage, options: StudioOptions, fillCanvas: Bool) -> UIImage {
        let canvas = options.aspect.canvas
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: canvas, format: format).image { context in
            let cg = context.cgContext
            let bounds = CGRect(origin: .zero, size: canvas)
            UIColor.white.setFill()
            cg.fill(bounds)

            if fillCanvas {
                subject.draw(in: aspectFill(subject.size, in: bounds))
                return
            }

            let colors = options.background.colors
            if colors.count >= 2,
               let gradient = CGGradient(
                   colorsSpace: CGColorSpaceCreateDeviceRGB(),
                   colors: colors.map(\.cgColor) as CFArray,
                   locations: nil
               ) {
                cg.drawLinearGradient(
                    gradient,
                    start: CGPoint(x: bounds.midX, y: 0),
                    end: CGPoint(x: bounds.midX, y: bounds.maxY),
                    options: []
                )
            } else if let color = colors.first {
                color.setFill()
                cg.fill(bounds)
            }

            // Объект занимает ~80 % кадра, чуть выше центра — место для тени.
            let area = bounds.insetBy(dx: canvas.width * 0.1, dy: canvas.height * 0.1)
            var target = aspectFit(subject.size, in: area)
            target.origin.y -= canvas.height * 0.02
            if options.shadow {
                cg.saveGState()
                cg.setShadow(
                    offset: CGSize(width: 0, height: canvas.height * 0.012),
                    blur: canvas.height * 0.03,
                    color: UIColor.black.withAlphaComponent(0.28).cgColor
                )
                subject.draw(in: target)
                cg.restoreGState()
            } else {
                subject.draw(in: target)
            }
        }
    }

    static func aspectFit(_ size: CGSize, in rect: CGRect) -> CGRect {
        guard size.width > 0, size.height > 0 else { return rect }
        let scale = min(rect.width / size.width, rect.height / size.height)
        let fitted = CGSize(width: size.width * scale, height: size.height * scale)
        return CGRect(
            x: rect.midX - fitted.width / 2, y: rect.midY - fitted.height / 2,
            width: fitted.width, height: fitted.height
        )
    }

    static func aspectFill(_ size: CGSize, in rect: CGRect) -> CGRect {
        guard size.width > 0, size.height > 0 else { return rect }
        let scale = max(rect.width / size.width, rect.height / size.height)
        let filled = CGSize(width: size.width * scale, height: size.height * scale)
        return CGRect(
            x: rect.midX - filled.width / 2, y: rect.midY - filled.height / 2,
            width: filled.width, height: filled.height
        )
    }
}
