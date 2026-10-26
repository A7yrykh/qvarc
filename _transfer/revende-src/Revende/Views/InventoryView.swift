import SwiftData
import SwiftUI

struct InventoryView: View {
    enum Filter: String, CaseIterable, Identifiable {
        case inStock
        case sold
        case all

        var id: String { rawValue }

        var title: String {
            switch self {
            case .inStock: String(localized: "En stock")
            case .sold: String(localized: "Vendidos")
            case .all: String(localized: "Todos")
            }
        }
    }

    @Environment(\.modelContext) private var context
    @EnvironmentObject private var settings: SellerSettings
    @EnvironmentObject private var subscription: SubscriptionService
    @Query(sort: \Item.createdAt, order: .reverse) private var items: [Item]

    @State private var filter: Filter = .inStock
    @State private var search = ""
    @State private var path: [Item] = []
    @State private var showPaywall = false

    private var visible: [Item] {
        items.filter { item in
            switch filter {
            case .inStock: item.status.isInStock
            case .sold: item.status == .sold
            case .all: true
            }
        }
        .filter { item in
            search.isEmpty
                || item.name.localizedCaseInsensitiveContains(search)
                || item.brand.localizedCaseInsensitiveContains(search)
                || item.category.localizedCaseInsensitiveContains(search)
        }
    }

    private var canAddItem: Bool {
        subscription.isPro || items.count < SubscriptionService.freeItemLimit
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Picker("Filtro", selection: $filter) {
                    ForEach(Filter.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                ForEach(visible) { item in
                    NavigationLink(value: item) { ItemRow(item: item, feeRule: feeRule(for: item)) }
                }
                .onDelete(perform: delete)

                if !subscription.isPro {
                    Text("\(items.count) de \(SubscriptionService.freeItemLimit) artículos gratis")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
            }
            .overlay {
                if items.isEmpty {
                    ContentUnavailableView {
                        Label("Tu inventario está vacío", systemImage: "tshirt")
                    } description: {
                        Text("Añade lo que quieres vender: haz fotos, crea el anuncio con IA y controla cuánto ganas.")
                    } actions: {
                        Button("Añadir artículo", action: addItem).buttonStyle(.borderedProminent)
                    }
                }
            }
            .searchable(text: $search, prompt: "Buscar por nombre o marca")
            .navigationTitle("Inventario")
            .navigationDestination(for: Item.self) { ItemEditorView(item: $0) }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: addItem) { Label("Añadir", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $showPaywall) { PaywallView() }
            #if DEBUG
            .task {
                if ["item", "studio", "listing"].contains(DemoData.screen ?? ""), path.isEmpty,
                   let first = visible.first(where: { !$0.photos.isEmpty }) {
                    try? await Task.sleep(for: .milliseconds(600))
                    path = [first]
                }
            }
            #endif
        }
    }

    private func feeRule(for item: Item) -> FeeRule {
        settings.feeRule(for: item.listedPlatforms.first ?? settings.defaultPlatform)
    }

    private func addItem() {
        guard canAddItem else {
            showPaywall = true
            return
        }
        let item = Item()
        item.packaging = settings.defaultPackaging
        context.insert(item)
        path.append(item)
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets { context.delete(visible[index]) }
    }
}

private struct ItemRow: View {
    let item: Item
    let feeRule: FeeRule

    var body: some View {
        HStack(spacing: 12) {
            PhotoThumb(data: item.coverPhoto?.data)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.displayName).font(.headline).lineLimit(1)
                HStack(spacing: 6) {
                    Label(item.status.displayName, systemImage: item.status.symbol)
                    if item.isStale {
                        Text("· +30 días").foregroundStyle(.orange)
                    }
                    if let platform = item.soldPlatform ?? item.listedPlatforms.first {
                        Text("· \(platform.displayName)")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                let price = item.status == .sold ? item.salePrice : item.listPrice
                Text(price > 0 ? Money.format(price) : "—").font(.subheadline.monospacedDigit())
                if price > 0 {
                    let net = ProfitCalculator.breakdown(item.profitInput(feeRule: feeRule)).netProfit
                    Text((net >= 0 ? "+" : "") + Money.format(net))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(net >= 0 ? Color.green : Color.red)
                }
            }
        }
    }
}
