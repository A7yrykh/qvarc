import StoreKit
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var purchases: PurchaseManager
    @EnvironmentObject private var library: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var showPaywall = false
    @State private var showManage = false

    var body: some View {
        NavigationStack {
            List {
                Section("Suscripción") {
                    if purchases.isPro {
                        Label("Despeja Pro activo", systemImage: "crown.fill")
                        Button("Gestionar suscripción") { showManage = true }
                    } else {
                        Button("Pasar a Pro") { showPaywall = true }
                        Text("Hoy te quedan \(library.quota.remaining()) borrados gratis")
                            .foregroundStyle(.secondary)
                    }
                    Button("Restaurar compras") { Task { await purchases.restore() } }
                }
                Section("Privacidad") {
                    Text("Despeja analiza las fotos en el propio iPhone. No hay cuentas, servidores ni publicidad, y no recogemos ningún dato.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("Política de privacidad") { openURL(AppInfo.privacyURL) }
                    Button("Términos de uso (EULA)") { openURL(AppInfo.termsURL) }
                }
                Section("Ayuda") {
                    Button("Contacto y soporte") { openURL(AppInfo.supportURL) }
                    Text("Lo que borras va a «Eliminado» en la app Fotos y puedes recuperarlo durante 30 días.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    LabeledContent("Versión", value: AppInfo.version)
                    LabeledContent("Desarrollador", value: "AVSyrykh SL")
                }
            }
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } }
            }
            .sheet(isPresented: $showPaywall) { PaywallView() }
            .manageSubscriptionsSheet(isPresented: $showManage)
            .alert("Despeja Pro", isPresented: Binding(get: { purchases.message != nil },
                                                       set: { if !$0 { purchases.message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(purchases.message ?? "")
            }
        }
    }
}
