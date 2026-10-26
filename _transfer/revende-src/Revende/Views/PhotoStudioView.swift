import SwiftUI

/// Фото товара «как в студии»: вырезка фона, новый фон, тень, формат.
struct PhotoStudioView: View {
    @Bindable var item: Item
    let photo: ItemPhoto
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var subscription: SubscriptionService

    @State private var options = StudioOptions()
    @State private var result: UIImage?
    @State private var isRendering = false
    @State private var errorText: String?
    @State private var showPaywall = false
    @State private var savedToPhotos = false

    private var source: UIImage? { UIImage(data: photo.data) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground))
                    if let image = result ?? source {
                        Image(uiImage: image).resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    if isRendering {
                        ProgressView("Quitando el fondo…")
                            .padding()
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .frame(maxHeight: .infinity)

                if let errorText {
                    Text(errorText).font(.footnote).foregroundStyle(.red)
                }

                VStack(spacing: 12) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(StudioBackground.allCases) { background in
                                Button {
                                    select(background)
                                } label: {
                                    HStack(spacing: 4) {
                                        Text(background.displayName)
                                        if background.requiresPro && !subscription.isPro {
                                            Image(systemName: "lock.fill").font(.caption2)
                                        }
                                    }
                                }
                                .buttonStyle(.bordered)
                                .tint(options.background == background ? Color.accentColor : Color.secondary)
                            }
                        }
                    }
                    Picker("Formato", selection: $options.aspect) {
                        ForEach(StudioAspect.allCases) { Text($0.displayName).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    HStack {
                        Toggle("Sombra", isOn: $options.shadow)
                        Toggle("Mejorar luz", isOn: $options.enhance)
                    }
                    .font(.subheadline)
                }

                HStack {
                    Button("Guardar en Fotos", systemImage: savedToPhotos ? "checkmark" : "square.and.arrow.down") {
                        if let result {
                            UIImageWriteToSavedPhotosAlbum(result, nil, nil, nil)
                            savedToPhotos = true
                        }
                    }
                    .disabled(result == nil)
                    Spacer()
                    Menu {
                        Button("Sustituir la original", systemImage: "arrow.triangle.2.circlepath") { apply(replace: true) }
                        Button("Añadir como nueva", systemImage: "plus") { apply(replace: false) }
                    } label: {
                        Label("Usar", systemImage: "checkmark.circle.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(result == nil)
                }
            }
            .padding()
            .navigationTitle("Estudio de fotos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } }
            }
            .task(id: options) { await render() }
            .sheet(isPresented: $showPaywall) { PaywallView() }
        }
    }

    private func select(_ background: StudioBackground) {
        if background.requiresPro && !subscription.isPro {
            showPaywall = true
        } else {
            options.background = background
        }
    }

    private func render() async {
        guard let source else { return }
        isRendering = true
        errorText = nil
        savedToPhotos = false
        do {
            let image = try await PhotoStudio.render(source, options: options)
            if !Task.isCancelled { result = image }
        } catch {
            errorText = error.localizedDescription
            result = nil
        }
        isRendering = false
    }

    private func apply(replace: Bool) {
        guard let data = result?.jpegForStorage() else { return }
        if replace {
            photo.data = data
        } else {
            let minOrder = (item.photos.map(\.order).min() ?? 0) - 1
            item.photos.append(ItemPhoto(data: data, order: minOrder))
        }
        dismiss()
    }
}
