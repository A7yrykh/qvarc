import Photos
import UIKit

/// Проход по медиатеке: размер файлов, признаки и перцептивный хеш каждого фото.
/// Всё считается на устройстве, сеть не используется.
enum LibraryScanner {
    static func scan(progress: @escaping (Double) -> Void) -> [MediaItem] {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let assets = PHAsset.fetchAssets(with: options)
        let total = max(assets.count, 1)

        let manager = PHImageManager.default()
        let request = PHImageRequestOptions()
        request.isSynchronous = true
        request.deliveryMode = .fastFormat
        request.resizeMode = .fast
        request.isNetworkAccessAllowed = false

        var cache = HashCache.load()
        var items: [MediaItem] = []
        items.reserveCapacity(assets.count)

        assets.enumerateObjects { asset, index, _ in
            autoreleasepool {
                guard asset.mediaType == .image || asset.mediaType == .video else { return }
                var item = MediaItem(
                    id: asset.localIdentifier,
                    kind: asset.mediaType == .video ? .video : .photo,
                    date: asset.creationDate,
                    pixelWidth: asset.pixelWidth,
                    pixelHeight: asset.pixelHeight,
                    bytes: fileSize(of: asset),
                    duration: asset.duration,
                    isFavorite: asset.isFavorite,
                    isScreenshot: asset.mediaSubtypes.contains(.photoScreenshot))

                if item.kind == .photo {
                    let stamp = asset.modificationDate?.timeIntervalSince1970 ?? 0
                    if let cached = cache.hash(for: item.id, stamp: stamp) {
                        item.hash = cached
                    } else {
                        manager.requestImage(for: asset, targetSize: CGSize(width: 64, height: 64),
                                             contentMode: .aspectFit, options: request) { image, _ in
                            if let cg = image?.cgImage { item.hash = ImageHash.dHash(cg) }
                        }
                        if let hash = item.hash { cache.set(hash, for: item.id, stamp: stamp) }
                    }
                }
                items.append(item)
            }
            if index % 25 == 0 { progress(Double(index) / Double(total)) }
        }
        cache.save(keeping: Set(items.map(\.id)))
        return items
    }

    /// Сумма всех ресурсов (оригинал, правки, видео Live Photo) — столько места освободит удаление.
    static func fileSize(of asset: PHAsset) -> Int64 {
        PHAssetResource.assetResources(for: asset).reduce(0) { sum, resource in
            sum + ((resource.value(forKey: "fileSize") as? NSNumber)?.int64Value ?? 0)
        }
    }
}

/// Кеш хешей между запусками: повторное сканирование большой медиатеки занимает секунды.
struct HashCache {
    private var entries: [String: [Double]] = [:]   // id → [stamp, hash]

    private static var url: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("hashes.json")
    }

    static func load() -> HashCache {
        var cache = HashCache()
        if let data = try? Data(contentsOf: url),
           let decoded = try? JSONDecoder().decode([String: [String]].self, from: data) {
            for (id, pair) in decoded where pair.count == 2 {
                if let stamp = Double(pair[0]), let hash = UInt64(pair[1]) {
                    cache.entries[id] = [stamp, Double(bitPattern: hash)]
                }
            }
        }
        return cache
    }

    func hash(for id: String, stamp: Double) -> UInt64? {
        guard let e = entries[id], e[0] == stamp else { return nil }
        return e[1].bitPattern
    }

    mutating func set(_ hash: UInt64, for id: String, stamp: Double) {
        entries[id] = [stamp, Double(bitPattern: hash)]
    }

    func save(keeping ids: Set<String>) {
        var out: [String: [String]] = [:]
        for (id, e) in entries where ids.contains(id) {
            out[id] = [String(e[0]), String(e[1].bitPattern)]
        }
        if let data = try? JSONEncoder().encode(out) {
            try? data.write(to: Self.url, options: .atomic)
        }
    }
}
