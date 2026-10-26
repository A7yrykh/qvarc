import PhotosUI
import SwiftData
import SwiftUI

struct ItemEditorView: View {
    @Bindable var item: Item
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var settings: SellerSettings

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var showSold = false
    @State private var studioPhoto: ItemPhoto?
    @State private var confirmDelete = false
    @State private var showListing = false
    @State private var demoShown = false

    private var feeRule: FeeRule {
        settings.feeRule(for: item.listedPlatforms.first ?? settings.defaultPlatform)
    }

    private var breakdown: ProfitBreakdown {
        ProfitCalculator.breakdown(item.profitInput(feeRule: feeRule))
    }

    var body: some View {
        Form {
            photosSection
            detailsSection
            purchaseSection
            saleSection
            profitSection
            actionsSection
        }
        .navigationTitle(item.name.isEmpty ? String(localized: "Nuevo artículo") : item.name)
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: pickerItems) { _, newItems in
            Task { await importPicked(newItems) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in addPhoto(image) }.ignoresSafeArea()
        }
        .sheet(isPresented: $showSold) { SoldSheet(item: item) }
        .sheet(item: $studioPhoto) { photo in PhotoStudioView(item: item, photo: photo) }
        .navigationDestination(isPresented: $showListing) { ListingStudioView(item: item) }
        #if DEBUG
        .task {
            guard !demoShown else { return }
            demoShown = true
            try? await Task.sleep(for: .milliseconds(600))
            switch DemoData.screen {
            case "studio": studioPhoto = item.coverPhoto
            case "listing": showListing = true
            default: break
            }
        }
        #endif
        .confirmationDialog("¿Eliminar este artículo?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Eliminar", role: .destructive) {
                context.delete(item)
                dismiss()
            }
        }
    }

    // MARK: Fotos

    private var photosSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(item.sortedPhotos) { photo in
                        Button { studioPhoto = photo } label: {
                            PhotoThumb(data: photo.data, size: 84)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Usar como portada", systemImage: "star") { makeCover(photo) }
                            Button("Eliminar", systemImage: "trash", role: .destructive) { removePhoto(photo) }
                        }
                    }
                    PhotosPicker(selection: $pickerItems, maxSelectionCount: 10, matching: .images) {
                        addTile(symbol: "photo.on.rectangle", label: "Galería")
                    }
                    if CameraPicker.isAvailable {
                        Button { showCamera = true } label: { addTile(symbol: "camera", label: "Cámara") }
                            .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("Fotos")
        } footer: {
            if !item.photos.isEmpty {
                Text("Toca una foto para quitar el fondo y ponerla en estudio.")
            }
        }
    }

    private func addTile(symbol: String, label: LocalizedStringKey) -> some View {
        VStack(spacing: 4) {
            Image(systemName: symbol).font(.title3)
            Text(label).font(.caption2)
        }
        .frame(width: 84, height: 84)
        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Datos

    private var detailsSection: some View {
        Section("Artículo") {
            TextField("Qué es (p. ej. Chaqueta vaquera)", text: $item.name)
            TextField("Marca", text: $item.brand)
            TextField("Categoría", text: $item.category)
            TextField("Talla o tamaño", text: $item.size)
            TextField("Color", text: $item.color)
            TextField("Material", text: $item.material)
            Picker("Estado", selection: $item.conditionRaw) {
                Text("Sin indicar").tag(String?.none)
                ForEach(ItemCondition.allCases) { Text($0.displayName).tag(Optional($0.rawValue)) }
            }
            TextField("Notas: medidas, defectos, qué incluye", text: $item.notes, axis: .vertical)
                .lineLimit(2...6)
        }
    }

    private var purchaseSection: some View {
        Section("Compra") {
            MoneyField("Precio de compra", value: $item.purchaseCost)
            MoneyField("Otros gastos (limpieza, arreglos)", value: $item.extraCosts)
            DatePicker(
                "Fecha de compra",
                selection: Binding(get: { item.purchaseDate ?? .now }, set: { item.purchaseDate = $0 }),
                displayedComponents: .date
            )
            TextField("Dónde (tienda, rastro, Vinted…)", text: $item.purchaseSource)
        }
    }

    private var saleSection: some View {
        Section {
            Picker("Estado de venta", selection: statusBinding) {
                ForEach(ItemStatus.allCases.filter { $0 != .sold }) { Text($0.displayName).tag($0) }
                if item.status == .sold { Text(ItemStatus.sold.displayName).tag(ItemStatus.sold) }
            }
            .disabled(item.status == .sold)
            MoneyField("Precio del anuncio", value: $item.listPrice)
            ForEach(Platform.allCases) { platform in
                Toggle(platform.displayName, isOn: platformBinding(platform))
            }
            MoneyField("Envío que pagas tú", value: $item.shippingBySeller)
            MoneyField("Embalaje", value: $item.packaging)
            MoneyField("Promoción (destacar)", value: $item.promotion)
        } header: {
            Text("Venta")
        } footer: {
            if let platform = item.listedPlatforms.first,
               let buyerFee = platform.buyerProtectionFee(for: item.listPrice) {
                Text("En \(platform.displayName) el comprador pagará aprox. \(Money.format(item.listPrice + buyerFee)) + envío (protección \(Money.format(buyerFee))).")
            }
        }
    }

    @ViewBuilder
    private var profitSection: some View {
        let price = item.status == .sold ? item.salePrice : item.listPrice
        if price > 0 || item.purchaseCost > 0 {
            Section {
                if price > 0 {
                    ProfitSummaryView(
                        breakdown: breakdown,
                        title: item.status == .sold ? LocalizedStringKey("Has ganado") : LocalizedStringKey("Ganarás a este precio")
                    )
                }
                if item.status != .sold {
                    let input = item.profitInput(feeRule: feeRule)
                    if let breakEven = ProfitCalculator.minimumPrice(forProfit: 0, input) {
                        LabeledContent("Precio mínimo sin perder", value: Money.format(breakEven))
                    }
                    if item.listPrice > 0 {
                        ForEach(ProfitCalculator.scenarios(listPrice: item.listPrice, discounts: [10, 20], input)) { s in
                            LabeledContent(
                                "Si aceptas −\(Money.percent(s.discountPercent)) (\(Money.format(s.price)))",
                                value: Money.format(s.netProfit)
                            )
                        }
                    }
                }
            } header: {
                Text("Beneficio")
            }
        }
    }

    private var actionsSection: some View {
        Section {
            Button {
                showListing = true
            } label: {
                Label("Crear anuncio con IA", systemImage: "sparkles")
            }
            if item.status == .sold {
                Button("Editar venta", systemImage: "pencil") { showSold = true }
                Button("Deshacer venta", systemImage: "arrow.uturn.backward") {
                    item.status = .listed
                    item.soldAt = nil
                    item.soldPlatform = nil
                    item.platformFee = 0
                }
            } else {
                Button("Marcar como vendido", systemImage: "checkmark.seal") { showSold = true }
            }
            Button("Eliminar artículo", systemImage: "trash", role: .destructive) { confirmDelete = true }
        }
    }

    // MARK: Bindings

    private var statusBinding: Binding<ItemStatus> {
        Binding(
            get: { item.status },
            set: { newValue in
                item.status = newValue
                if newValue == .listed, item.listedAt == nil { item.listedAt = .now }
            }
        )
    }

    private func platformBinding(_ platform: Platform) -> Binding<Bool> {
        Binding(
            get: { item.listedPlatforms.contains(platform) },
            set: { isOn in
                var set = item.listedPlatforms
                if isOn { set.insert(platform) } else { set.remove(platform) }
                item.listedPlatforms = set
                if isOn, item.status == .draft {
                    item.status = .listed
                    if item.listedAt == nil { item.listedAt = .now }
                }
            }
        )
    }

    // MARK: Fotos

    private func importPicked(_ picked: [PhotosPickerItem]) async {
        guard !picked.isEmpty else { return }
        for pickerItem in picked {
            if let data = try? await pickerItem.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                addPhoto(image)
            }
        }
        pickerItems = []
    }

    private func addPhoto(_ image: UIImage) {
        guard let data = image.normalized().jpegForStorage() else { return }
        let nextOrder = (item.photos.map(\.order).max() ?? -1) + 1
        let photo = ItemPhoto(data: data, order: nextOrder)
        item.photos.append(photo)
    }

    private func makeCover(_ photo: ItemPhoto) {
        let minOrder = (item.photos.map(\.order).min() ?? 0) - 1
        photo.order = minOrder
    }

    private func removePhoto(_ photo: ItemPhoto) {
        item.photos.removeAll { $0.id == photo.id }
        context.delete(photo)
    }
}
