import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var purchases: PurchaseManager
    @State private var showPaywall = false
    @State private var showSettings = false
    @State private var path: [CleanCategory] = AppInfo.demoScreen.flatMap(CleanCategory.init(rawValue:)).map { [$0] } ?? []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 16) {
                    storageCard
                    scanCard
                    ForEach(CleanCategory.allCases) { category in
                        NavigationLink(value: category) {
                            CategoryCard(category: category, count: library.count(category),
                                         bytes: library.bytes(category), scanned: library.hasScanned)
                        }
                        .buttonStyle(.plain)
                        .disabled(!library.hasScanned)
                    }
                    if library.status == .limited {
                        Label("Despeja solo ve las fotos que elegiste. Para analizarlo todo, permite el acceso completo en Ajustes.",
                              systemImage: "exclamationmark.circle")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if !purchases.isPro { proCard }
                    Label("Todo se analiza en el iPhone. Ninguna foto sale del dispositivo.", systemImage: "lock.shield")
                        .font(.footnote).foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Despeja")
            .navigationDestination(for: CleanCategory.self) { CategoryView(category: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel(Text("Ajustes"))
                }
            }
            .refreshable { await library.scan() }
            .sheet(isPresented: $showPaywall) { PaywallView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task {
                if !library.hasScanned { await library.scan() }
            }
        }
    }

    private var storageCard: some View {
        let used = max(library.capacityBytes - library.freeBytes, 0)
        let fraction = library.capacityBytes > 0 ? Double(used) / Double(library.capacityBytes) : 0
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Almacenamiento").font(.headline)
                Spacer()
                Text("Libre: \(Format.bytes(library.freeBytes))")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            ProgressView(value: fraction)
                .tint(fraction > 0.9 ? .red : Color.brand)
                .scaleEffect(x: 1, y: 2.2, anchor: .center)
                .padding(.vertical, 4)
            Text("Ocupado \(Format.bytes(used)) de \(Format.bytes(library.capacityBytes))")
                .font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
    }

    private var scanCard: some View {
        VStack(spacing: 12) {
            if library.isScanning {
                Text("Analizando tu galería…").font(.headline)
                ProgressView(value: library.progress)
                Text(library.progress, format: .percent.precision(.fractionLength(0))).font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
            } else if library.hasScanned {
                Text("Puedes liberar").font(.subheadline).foregroundStyle(.secondary)
                Text(Format.bytes(library.reclaimableBytes))
                    .font(.system(size: 44, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(Color.brand.gradient)
                if library.freedBytes > 0 {
                    Label("Ya has liberado \(Format.bytes(library.freedBytes))", systemImage: "checkmark.seal.fill")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(.green)
                }
                Button("Volver a analizar") { Task { await library.scan() } }
                    .font(.subheadline)
            } else {
                Button {
                    Task { await library.scan() }
                } label: {
                    Text("Analizar galería").font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 14))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
    }

    private var proCard: some View {
        Button { showPaywall = true } label: {
            HStack(spacing: 14) {
                Image(systemName: "crown.fill").font(.title2).foregroundStyle(.yellow)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Despeja Pro").font(.headline)
                    Text("Hoy te quedan \(library.quota.remaining()) borrados gratis. Con Pro, sin límite.")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
    }
}
