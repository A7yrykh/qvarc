import UIKit
import Vision

/// Распознавание текста на устройстве (Vision). Ничего не уходит в сеть.
enum TextRecognizer {
    static func recognize(_ images: [UIImage]) async -> String {
        await Task.detached(priority: .userInitiated) {
            images.compactMap { image -> String? in
                guard let cgImage = image.cgImage else { return nil }
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.recognitionLanguages = ["es-ES", "en-US"]
                // Без автокоррекции: она «исправляет» номера и MRZ.
                request.usesLanguageCorrection = false
                let handler = VNImageRequestHandler(cgImage: cgImage, orientation: image.cgOrientation)
                do {
                    try handler.perform([request])
                } catch {
                    return nil
                }
                let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
                return lines.joined(separator: "\n")
            }
            .joined(separator: "\n")
        }.value
    }
}

private extension UIImage {
    var cgOrientation: CGImagePropertyOrientation {
        switch imageOrientation {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
