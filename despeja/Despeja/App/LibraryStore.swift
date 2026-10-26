import Photos
import SwiftUI

/// Категории, которые показываем на главном экране.
enum CleanCategory: String, CaseIterable, Identifiable, Hashable {
    case duplicates, similar, screenshots, videos

    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .duplicates: "Duplicados"
        case .similar: "Fotos similares"
        case .screenshots: "Capturas de pantalla"
        case .videos: "Vídeos grandes"
        }
    }

    var subtitle: LocalizedStringKey {
        switch self {
        case .duplicates: "Copias exactas de la misma foto"
        case .similar: "Ráfagas y fotos casi iguales"
        case .screenshots: "Suelen sobrar al cabo de unos días"
        case .videos: "Los que más espacio ocupan"
        }
    }

    var symbol: String {
        switch self {
        case .duplicates: "square.on.square"
        case .similar: "photo.stack"
        case .screenshots: "iphone"
        case .videos: "video"
        }
    }

    var color: Color {
        switch self {
        case .duplicates: .orange
        case .similar: .purple
        case .screenshots: .blue
        case .videos: .pink
        }
    }

    var isGrouped: Bool { self == .duplicates || self == .similar }
}

/// Результат сканирования медиатеки.
struct ScanResult {
    var items: [MediaItem] = []
    var duplicates: [MediaGroup] = []
    var similar: [MediaGroup] = []
    var screenshots: [MediaItem] = []
    var videos: [MediaItem] = []

    init() {}

    init(items: [MediaItem]) {
        self.items = items
        duplicates = Grouping.duplicates(items)
        let dupIDs = Set(duplicates.flatMap { $0.items.map(\.id) })
        similar = Grouping.similar(items, excluding: dupIDs)
        screenshots = Grouping.screenshots(items)
        videos = Grouping.largeVideos(items)
    }

    /// Убрать удалённые файлы без повторного сканирования.
    mutating func remove(_ ids: Set<String>) {
        items.removeAll { ids.contains($0.id) }
        func prune(_ groups: [MediaGroup]) -> [MediaGroup] {
            groups.compactMap { g in
                let rest = g.items.filter { !ids.contains($0.id) }
                return rest.count > 1 ? MediaGroup(items: rest) : nil
            }
        }
        duplicates = prune(duplicates)
        similar = prune(similar)
        screenshots.removeAll { ids.contains($0.id) }
        videos.removeAll { ids.contains($0.id) }
    }
}

@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var status: PHAuthorizationStatus
    @Published private(set) var isScanning = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var hasScanned = false
    @Published private(set) var result = ScanResult()
    @Published private(set) var freeBytes: Int64 = 0
    @Published private(set) var capacityBytes: Int64 = 0
    @Published private(set) var freedBytes: Int64 = 0

    let isDemo = AppInfo.isDemo
    let quota = DailyQuota()

    init() {
        status = AppInfo.isDemo ? .authorized : PHPhotoLibrary.authorizationStatus(for: .readWrite)
        refreshStorage()
    }

    var hasAccess: Bool { status == .authorized || status == .limited }

    func requestAccess() async {
        status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        if hasAccess { await scan() }
    }

    func refreshStatus() {
        if !isDemo { status = PHPhotoLibrary.authorizationStatus(for: .readWrite) }
    }

    func refreshStorage() {
        if isDemo {
            capacityBytes = 128_000_000_000
            freeBytes = 3_400_000_000
            return
        }
        let url = URL(fileURLWithPath: NSHomeDirectory())
        if let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey,
                                                           .volumeTotalCapacityKey]) {
            freeBytes = values.volumeAvailableCapacityForImportantUsage ?? 0
            capacityBytes = Int64(values.volumeTotalCapacity ?? 0)
        }
    }

    // MARK: Итоги

    func items(in category: CleanCategory) -> [MediaItem] {
        switch category {
        case .duplicates: result.duplicates.flatMap(\.extras)
        case .similar: result.similar.flatMap(\.extras)
        case .screenshots: result.screenshots
        case .videos: result.videos
        }
    }

    func groups(in category: CleanCategory) -> [MediaGroup] {
        switch category {
        case .duplicates: result.duplicates
        case .similar: result.similar
        default: []
        }
    }

    func count(_ category: CleanCategory) -> Int { items(in: category).count }
    func bytes(_ category: CleanCategory) -> Int64 { items(in: category).totalBytes }

    var reclaimableBytes: Int64 { CleanCategory.allCases.reduce(0) { $0 + bytes($1) } }

    // MARK: Сканирование

    func scan() async {
        guard !isScanning else { return }
        isScanning = true
        progress = 0
        refreshStorage()
        if isDemo {
            for step in 1...10 {
                try? await Task.sleep(for: .milliseconds(60))
                progress = Double(step) / 10
            }
            result = ScanResult(items: DemoLibrary.items())
        } else {
            let items = await Task.detached(priority: .userInitiated) {
                LibraryScanner.scan { value in
                    Task { @MainActor [weak self] in self?.progress = value }
                }
            }.value
            result = await Task.detached(priority: .userInitiated) { ScanResult(items: items) }.value
        }
        progress = 1
        hasScanned = true
        isScanning = false
    }

    // MARK: Удаление

    /// Удаляет файлы (iOS сама спросит подтверждение; файлы 30 дней лежат в «Eliminado»).
    /// Возвращает false, если пользователь отменил.
    @discardableResult
    func delete(_ items: [MediaItem], countsAgainstQuota: Bool) async throws -> Bool {
        guard !items.isEmpty else { return false }
        let ids = items.map(\.id)
        if !isDemo {
            let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetChangeRequest.deleteAssets(assets)
                }
            } catch let error as NSError where error.domain == PHPhotosErrorDomain
                        && error.code == PHPhotosError.userCancelled.rawValue {
                return false
            }
        }
        if countsAgainstQuota { quota.consume(items.count) }
        freedBytes += items.totalBytes
        result.remove(Set(ids))
        refreshStorage()
        return true
    }
}
