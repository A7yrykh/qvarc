import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        Group {
            switch app.phase {
            case .loading:
                ZStack {
                    Brand.graphite.ignoresSafeArea()
                    Image("LogoWordmarkMilky").resizable().scaledToFit().frame(width: 180)
                        .accessibilityLabel("Кварц")
                }
            case .login:
                LoginView()
            case .main:
                MainTabView()
            }
        }
        .task { await app.start() }
    }
}
