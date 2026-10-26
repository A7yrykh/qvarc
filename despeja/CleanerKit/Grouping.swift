import Foundation

/// Группа похожих элементов: один оставляем (keeper), остальные предлагаем удалить.
public struct MediaGroup: Identifiable, Hashable, Sendable {
    public let items: [MediaItem]
    public let keeperID: String

    public init(items: [MediaItem]) {
        self.items = items
        self.keeperID = Grouping.keeper(in: items)?.id ?? items.first?.id ?? ""
    }

    public var id: String { items.map(\.id).joined(separator: "|") }
    public var extras: [MediaItem] { items.filter { $0.id != keeperID } }
    public var reclaimableBytes: Int64 { extras.totalBytes }
}

public enum Grouping {
    /// Порог для дубликатов: копии одного снимка расходятся максимум на пару бит.
    public static let duplicateDistance = 2
    /// Порог для серий похожих снимков.
    public static let similarDistance = 10
    /// Похожие снимки ищем только среди сделанных подряд, с разницей не больше 5 минут.
    public static let similarWindow: TimeInterval = 5 * 60

    /// Какой снимок оставить: избранный, затем больше пикселей, затем больше файл, затем новее.
    public static func keeper(in items: [MediaItem]) -> MediaItem? {
        items.max { a, b in
            if a.isFavorite != b.isFavorite { return !a.isFavorite }
            if a.pixels != b.pixels { return a.pixels < b.pixels }
            if a.bytes != b.bytes { return a.bytes < b.bytes }
            return (a.date ?? .distantPast) < (b.date ?? .distantPast)
        }
    }

    /// Дубликаты: фото одной формы с почти одинаковым хешем, независимо от даты.
    public static func duplicates(_ items: [MediaItem]) -> [MediaGroup] {
        let photos = items.filter { $0.kind == .photo && $0.hash != nil }
        // Сначала точные совпадения хеша — это быстро и покрывает почти все копии.
        var buckets: [String: [MediaItem]] = [:]
        for item in photos {
            buckets["\(item.hash!)-\(item.aspectKey)", default: []].append(item)
        }
        var groups = buckets.values.filter { $0.count > 1 }.map { $0 }
        // Затем сливаем одиночек, отличающихся на 1–2 бита (пересохранённые JPEG).
        let singles = buckets.values.filter { $0.count == 1 }.map { $0[0] }
        let byAspect = Dictionary(grouping: singles, by: \.aspectKey)
        for (_, list) in byAspect where list.count > 1 && list.count <= 4000 {
            groups += cluster(list, maxDistance: duplicateDistance) { _, _ in true }
        }
        return sorted(groups.map(MediaGroup.init))
    }

    /// Серии похожих фото: снятые подряд (в пределах окна) и визуально близкие.
    /// Фото из `excluding` (уже найденные дубликаты) не учитываются.
    public static func similar(_ items: [MediaItem], excluding: Set<String> = []) -> [MediaGroup] {
        let photos = items
            .filter { $0.kind == .photo && !$0.isScreenshot && $0.hash != nil && $0.date != nil && !excluding.contains($0.id) }
            .sorted { $0.date! < $1.date! }
        var groups: [[MediaItem]] = []
        var current: [MediaItem] = []
        for item in photos {
            if let last = current.last,
               item.date!.timeIntervalSince(last.date!) <= similarWindow,
               current.contains(where: { ImageHash.distance($0.hash!, item.hash!) <= similarDistance }) {
                current.append(item)
            } else {
                if current.count > 1 { groups.append(current) }
                current = [item]
            }
        }
        if current.count > 1 { groups.append(current) }
        return sorted(groups.map(MediaGroup.init))
    }

    /// Простая кластеризация O(n²) для небольших списков.
    static func cluster(_ list: [MediaItem], maxDistance: Int,
                        allowed: (MediaItem, MediaItem) -> Bool) -> [[MediaItem]] {
        var parent = Array(0..<list.count)
        func find(_ i: Int) -> Int {
            var i = i
            while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i] }
            return i
        }
        for i in 0..<list.count {
            for j in (i + 1)..<list.count where allowed(list[i], list[j]) {
                if ImageHash.distance(list[i].hash!, list[j].hash!) <= maxDistance {
                    parent[find(j)] = find(i)
                }
            }
        }
        let clusters = Dictionary(grouping: list.indices, by: find)
        return clusters.values.filter { $0.count > 1 }.map { $0.map { list[$0] } }
    }

    static func sorted(_ groups: [MediaGroup]) -> [MediaGroup] {
        groups.sorted { $0.reclaimableBytes > $1.reclaimableBytes }
    }

    /// Большие видео, сначала самые тяжёлые.
    public static func largeVideos(_ items: [MediaItem], minBytes: Int64 = 50_000_000) -> [MediaItem] {
        items.filter { $0.kind == .video && $0.bytes >= minBytes }.sorted { $0.bytes > $1.bytes }
    }

    /// Снимки экрана, сначала старые: их чаще всего можно удалить целиком.
    public static func screenshots(_ items: [MediaItem]) -> [MediaItem] {
        items.filter(\.isScreenshot).sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
    }
}
