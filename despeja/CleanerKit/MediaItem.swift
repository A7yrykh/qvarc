import Foundation

/// Описание фото или видео без PhotoKit: всё, что нужно для группировки и подсчёта места.
public struct MediaItem: Identifiable, Hashable, Sendable {
    public enum Kind: String, Sendable { case photo, video }

    public let id: String
    public var kind: Kind
    public var date: Date?
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var bytes: Int64
    public var duration: TimeInterval
    public var isFavorite: Bool
    public var isScreenshot: Bool
    public var hash: UInt64?

    public init(id: String, kind: Kind = .photo, date: Date? = nil, pixelWidth: Int = 0, pixelHeight: Int = 0,
                bytes: Int64 = 0, duration: TimeInterval = 0, isFavorite: Bool = false,
                isScreenshot: Bool = false, hash: UInt64? = nil) {
        self.id = id
        self.kind = kind
        self.date = date
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.bytes = bytes
        self.duration = duration
        self.isFavorite = isFavorite
        self.isScreenshot = isScreenshot
        self.hash = hash
    }

    public var pixels: Int { pixelWidth * pixelHeight }

    /// Ориентация с допуском: копия 4032×3024 и 1600×1200 считаются одной формы.
    var aspectKey: Int {
        guard pixelWidth > 0, pixelHeight > 0 else { return 0 }
        return Int((Double(pixelWidth) / Double(pixelHeight) * 20).rounded())
    }
}

public extension Sequence where Element == MediaItem {
    var totalBytes: Int64 { reduce(0) { $0 + $1.bytes } }
}
