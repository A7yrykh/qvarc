import Photos
import SwiftUI

/// Миниатюра фото или видео из медиатеки.
struct Thumbnail: View {
    let item: MediaItem
    var showsInfo = true
    @State private var image: UIImage?
    @Environment(\.displayScale) private var scale

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if AppInfo.isDemo {
                    let style = DemoLibrary.style(for: item.id)
                    LinearGradient(colors: style.colors, startPoint: .topLeading, endPoint: .bottomTrailing)
                    Image(systemName: style.symbol)
                        .font(.system(size: geo.size.width * 0.32))
                        .foregroundStyle(.white.opacity(0.85))
                } else if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Color(.secondarySystemFill)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
            .overlay(alignment: .bottomLeading) {
                if showsInfo && item.kind == .video {
                    HStack(spacing: 3) {
                        Image(systemName: "video.fill")
                        Text(Format.duration(item.duration))
                    }
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .shadow(radius: 2)
                    .padding(5)
                }
            }
            .task(id: item.id) {
                guard !AppInfo.isDemo, image == nil else { return }
                image = await ThumbnailLoader.image(for: item.id,
                                                    size: CGSize(width: geo.size.width * scale,
                                                                 height: geo.size.height * scale))
            }
        }
    }
}

enum ThumbnailLoader {
    static let manager = PHCachingImageManager()

    static func image(for id: String, size: CGSize) async -> UIImage? {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { return nil }
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        return await withCheckedContinuation { continuation in
            manager.requestImage(for: asset, targetSize: size, contentMode: .aspectFill, options: options) { image, _ in
                continuation.resume(returning: image)
            }
        }
    }
}

/// Отметка выбора поверх миниатюры.
struct SelectionBadge: View {
    let selected: Bool

    var body: some View {
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .font(.title3)
            .symbolRenderingMode(.palette)
            .foregroundStyle(.white, selected ? Color.brand : Color.black.opacity(0.25))
            .shadow(radius: 1)
            .padding(6)
    }
}

/// Карточка категории на главном экране.
struct CategoryCard: View {
    let category: CleanCategory
    let count: Int
    let bytes: Int64
    let scanned: Bool

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: category.symbol)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(category.color.gradient, in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 2) {
                Text(category.title).font(.headline)
                Text(category.subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if scanned {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Format.bytes(bytes)).font(.headline.monospacedDigit())
                    Text("\(count) archivos").font(.caption).foregroundStyle(.secondary)
                }
            }
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
    }
}

/// Нижняя панель «Eliminar»: считает бесплатный лимит и при необходимости показывает Pro.
struct DeleteBar: View {
    let selection: [MediaItem]
    let onDeleted: () -> Void

    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var purchases: PurchaseManager
    @State private var showPaywall = false
    @State private var askPartial = false
    @State private var working = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 6) {
            Button {
                start()
            } label: {
                HStack {
                    if working { ProgressView().tint(.white) }
                    Group {
                        if selection.isEmpty {
                            Text("Selecciona lo que quieras borrar")
                        } else {
                            Text("Eliminar \(selection.count) · \(Format.bytes(selection.totalBytes))")
                        }
                    }
                    .font(.headline)
                }
                .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .disabled(selection.isEmpty || working)

            if !purchases.isPro {
                Text("Hoy te quedan \(library.quota.remaining()) borrados gratis")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.bar)
        .sheet(isPresented: $showPaywall) { PaywallView() }
        .confirmationDialog("Has llegado al límite gratuito", isPresented: $askPartial, titleVisibility: .visible) {
            Button("Eliminar solo \(library.quota.remaining())") {
                run(Array(selection.prefix(library.quota.remaining())), quota: true)
            }
            Button("Eliminar sin límite con Pro") { showPaywall = true }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("Con la versión gratuita puedes borrar \(DailyQuota.freeLimit) archivos al día.")
        }
        .alert("No se pudo eliminar", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }

    private func start() {
        if purchases.isPro { return run(selection, quota: false) }
        let remaining = library.quota.remaining()
        if remaining >= selection.count {
            run(selection, quota: true)
        } else if remaining > 0 {
            askPartial = true
        } else {
            showPaywall = true
        }
    }

    private func run(_ items: [MediaItem], quota: Bool) {
        working = true
        Task {
            defer { working = false }
            do {
                if try await library.delete(items, countsAgainstQuota: quota) { onDeleted() }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
