import CoreGraphics
import Foundation

/// Перцептивный хеш (dHash, 64 бита): сравнивает яркость соседних пикселей уменьшенной копии 9×8.
/// Одинаковые снимки (в т.ч. пересохранённые и уменьшенные копии) дают одинаковый или близкий хеш.
public enum ImageHash {
    public static let width = 9
    public static let height = 8

    /// Хеш по готовому буферу яркости 9×8 (построчно, 72 байта).
    public static func dHash(gray: [UInt8]) -> UInt64 {
        precondition(gray.count == width * height, "нужен буфер 9×8")
        var hash: UInt64 = 0
        var bit: UInt64 = 1
        for y in 0..<height {
            for x in 0..<(width - 1) {
                if gray[y * width + x] > gray[y * width + x + 1] {
                    hash |= bit
                }
                bit <<= 1
            }
        }
        return hash
    }

    /// Хеш по изображению: уменьшаем до 9×8 в оттенках серого и считаем dHash.
    public static func dHash(_ image: CGImage) -> UInt64? {
        var pixels = [UInt8](repeating: 0, count: width * height)
        let ok = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return ok ? dHash(gray: pixels) : nil
    }

    /// Число различающихся битов. 0 — одинаковые, до ~10 — похожие, больше 20 — разные.
    public static func distance(_ a: UInt64, _ b: UInt64) -> Int {
        (a ^ b).nonzeroBitCount
    }
}
