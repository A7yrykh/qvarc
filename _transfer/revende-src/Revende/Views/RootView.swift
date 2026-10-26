import SwiftUI

struct RootView: View {
    @State private var tab = RootView.initialTab

    var body: some View {
        TabView(selection: $tab) {
            InventoryView()
                .tabItem { Label("Inventario", systemImage: "tshirt") }
                .tag(0)
            CalculatorView()
                .tabItem { Label("Calculadora", systemImage: "eurosign.circle") }
                .tag(1)
            SummaryView()
                .tabItem { Label("Resumen", systemImage: "chart.bar") }
                .tag(2)
            SettingsView()
                .tabItem { Label("Ajustes", systemImage: "gearshape") }
                .tag(3)
        }
    }

    private static var initialTab: Int {
        #if DEBUG
        switch DemoData.screen {
        case "calculator": return 1
        case "summary": return 2
        case "settings": return 3
        default: return 0
        }
        #else
        return 0
        #endif
    }
}
