import SwiftUI

struct RootView: View {
    @EnvironmentObject private var library: LibraryStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var demoPaywall = AppInfo.demoScreen == "paywall"
    @State private var demoSettings = AppInfo.demoScreen == "settings"

    var body: some View {
        Group {
            if library.hasAccess {
                HomeView()
            } else {
                OnboardingView()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                library.refreshStatus()
                library.refreshStorage()
            }
        }
        .sheet(isPresented: $demoPaywall) { PaywallView() }
        .sheet(isPresented: $demoSettings) { SettingsView() }
    }
}

struct OnboardingView: View {
    @EnvironmentObject private var library: LibraryStore
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "sparkles")
                .font(.system(size: 64, weight: .semibold))
                .foregroundStyle(Color.brand.gradient)
            VStack(spacing: 10) {
                Text("Libera espacio en tu iPhone")
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                Text("Despeja encuentra fotos duplicadas, ráfagas, capturas y vídeos pesados para que decidas qué borrar.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            VStack(alignment: .leading, spacing: 14) {
                Point(symbol: "lock.shield", text: "Todo se analiza en el iPhone. Ninguna foto sale del dispositivo.")
                Point(symbol: "hand.tap", text: "Nada se borra sin tu confirmación.")
                Point(symbol: "arrow.uturn.backward", text: "Lo borrado pasa 30 días en «Eliminado» de Fotos.")
            }
            .padding(.horizontal, 8)
            Spacer()
            if library.status == .denied || library.status == .restricted {
                Text("Sin acceso a Fotos Despeja no puede buscar duplicados. Actívalo en Ajustes.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                } label: {
                    Text("Abrir Ajustes").font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
            } else {
                Button {
                    Task { await library.requestAccess() }
                } label: {
                    Text("Permitir acceso a Fotos").font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .buttonBorderShape(.roundedRectangle(radius: 14))
        .padding(24)
    }

    private struct Point: View {
        let symbol: String
        let text: LocalizedStringKey

        var body: some View {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: symbol).font(.title3).foregroundStyle(Color.brand).frame(width: 28)
                Text(text).font(.callout)
            }
        }
    }
}
