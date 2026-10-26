import StoreKit
import SwiftUI

struct PaywallView: View {
    @EnvironmentObject private var subscription: SubscriptionService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(Color.accentColor)
                        Text("Revende Pro").font(.title.bold())
                        Text("Para quien vende de verdad en Vinted y Wallapop.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 8)
                }
                Section {
                    Label("Artículos ilimitados (gratis: \(SubscriptionService.freeItemLimit))", systemImage: "infinity")
                    Label("Todos los fondos del estudio de fotos", systemImage: "photo.artframe")
                    Label("Exportar ventas a CSV para tu gestor", systemImage: "tablecells")
                }
                Section {
                    if subscription.products.isEmpty {
                        Text("Cargando precios…").foregroundStyle(.secondary)
                    }
                    ForEach(subscription.products, id: \.id) { product in
                        Button {
                            Task {
                                await subscription.purchase(product)
                                if subscription.isPro { dismiss() }
                            }
                        } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(product.displayName).font(.headline)
                                    Text(product.description).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(product.displayPrice).bold()
                            }
                        }
                    }
                    Button("Restaurar compras") { Task { await subscription.restore() } }
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("El pago se carga a tu cuenta de Apple. La suscripción se renueva automáticamente salvo que la canceles al menos 24 horas antes del final del periodo, en Ajustes › tu nombre › Suscripciones.")
                        HStack(spacing: 16) {
                            Link("Condiciones de uso", destination: AppLinks.terms)
                            Link("Privacidad", destination: AppLinks.privacy)
                            Link("EULA", destination: AppLinks.appleEULA)
                        }
                    }
                }
                if let error = subscription.lastError {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } }
            }
            .task { if subscription.products.isEmpty { await subscription.load() } }
        }
    }
}
