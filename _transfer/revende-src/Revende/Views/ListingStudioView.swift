import SwiftUI

/// Текст объявления под площадку: генерация, правка, копирование, переход в приложение площадки.
struct ListingStudioView: View {
    @Bindable var item: Item
    @EnvironmentObject private var settings: SellerSettings
    @Environment(\.openURL) private var openURL

    @State private var platform: Platform = .vinted
    @State private var isGenerating = false
    @State private var engine: ListingGenerator.Engine?

    private var limits: ListingLimits { platform.limits }

    private var text: ListingText {
        ListingText(title: item.listingTitle, description: item.listingDescription, hashtags: item.listingHashtags)
    }

    private var descriptionForPlatform: String { text.fullDescription(for: platform) }

    private var images: [Image] {
        item.sortedPhotos.compactMap { UIImage(data: $0.data) }.map { Image(uiImage: $0) }
    }

    var body: some View {
        Form {
            Section {
                Picker("Plataforma", selection: $platform) {
                    ForEach([Platform.vinted, .wallapop, .ebay, .milanuncios]) { Text($0.displayName).tag($0) }
                }
                .pickerStyle(.segmented)
                Button {
                    Task { await generate() }
                } label: {
                    HStack {
                        if item.listingTitle.isEmpty {
                            Label("Generar anuncio", systemImage: "sparkles")
                        } else {
                            Label("Volver a generar", systemImage: "sparkles")
                        }
                        Spacer()
                        if isGenerating { ProgressView() }
                    }
                }
                .disabled(isGenerating)
            } footer: {
                if let reason = ListingGenerator.unavailableReason {
                    Text(reason)
                } else if let engine {
                    Text("Generado con \(engine.displayName) en tu iPhone. Revisa el texto antes de publicar.")
                }
            }

            Section {
                TextField("Título", text: $item.listingTitle, axis: .vertical)
                CopyButton(label: "Copiar título", text: ListingTemplate.fit(item.listingTitle, limit: limits.title, ellipsis: false))
            } header: {
                counterHeader("Título", count: item.listingTitle.count, limit: limits.title)
            }

            Section {
                TextEditor(text: $item.listingDescription)
                    .frame(minHeight: 180)
                if limits.usesHashtags {
                    TextField(
                        "Hashtags",
                        text: Binding(
                            get: { item.listingHashtags.joined(separator: " ") },
                            set: { item.listingHashtags = $0.split(separator: " ").map(String.init) }
                        )
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                }
                CopyButton(label: "Copiar descripción", text: descriptionForPlatform)
            } header: {
                counterHeader("Descripción", count: descriptionForPlatform.count, limit: limits.description)
            } footer: {
                if let condition = item.condition {
                    Text("Estado en \(platform.displayName): «\(condition.label(on: platform))».")
                }
            }

            Section {
                if !images.isEmpty {
                    ShareLink(items: images) { image in
                        SharePreview("Foto", image: image)
                    } label: {
                        Label("Guardar o compartir fotos (\(images.count))", systemImage: "square.and.arrow.up")
                    }
                }
                if let url = platform.newListingURL {
                    Button("Abrir \(platform.displayName)", systemImage: "arrow.up.forward.app") {
                        UIPasteboard.general.string = item.listingTitle
                        openURL(url)
                    }
                }
            } footer: {
                Text("Revende no publica por ti: copia el texto, guarda las fotos y pégalos en la app de \(platform.displayName). Al abrirla, el título queda copiado.")
            }
        }
        .navigationTitle("Anuncio")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            platform = item.listedPlatforms.first ?? settings.defaultPlatform
            if platform == .other { platform = .vinted }
        }
    }

    private func counterHeader(_ title: LocalizedStringKey, count: Int, limit: Int) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text("\(count)/\(limit)")
                .monospacedDigit()
                .foregroundStyle(count > limit ? Color.red : Color.secondary)
        }
    }

    private func generate() async {
        isGenerating = true
        defer { isGenerating = false }
        var facts = item.facts
        if let cover = item.coverPhoto, let image = UIImage(data: cover.data) {
            let hints = await ImageAnalyzer.hints(for: image)
            facts.detectedLabels = hints.labels
            facts.detectedText = hints.text
        }
        let result = await ListingGenerator.generate(facts, for: platform)
        let fitted = result.text.fitted(to: platform)
        item.listingTitle = fitted.title
        item.listingDescription = fitted.description
        item.listingHashtags = fitted.hashtags
        engine = result.engine
    }
}
