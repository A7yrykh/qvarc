import SwiftUI

struct MainTabView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.tab) {
            NavigationStack { HomeView() }
                .tabItem { Label("Главная", systemImage: "house") }
                .tag(AppTab.home)
            NavigationStack { AccessView() }
                .tabItem { Label("Доступ", systemImage: "key") }
                .tag(AppTab.access)
            NavigationStack { RestaurantView() }
                .tabItem { Label("Ресторан", systemImage: "fork.knife") }
                .tag(AppTab.restaurant)
            NavigationStack { RentalView() }
                .tabItem { Label("Прокат", systemImage: "sailboat") }
                .tag(AppTab.rental)
        }
    }
}

/// Нет активной брони (или ошибка загрузки)
struct NoBookingView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        VStack(spacing: 16) {
            if let err = app.loadError {
                RetryView(message: err) { await app.reloadBookings() }
            } else {
                Image("LogoMarkGraphite").resizable().scaledToFit().frame(width: 44).accessibilityHidden(true)
                Text("Брони не найдено").font(.title3.weight(.semibold)).foregroundStyle(Brand.ink)
                Text("Мы ищем бронь по номеру телефона, с которым вы вошли. Если бронировали на другой номер — войдите с ним или позвоните администратору.")
                    .multilineTextAlignment(.center).foregroundStyle(Brand.secondaryText)
                CallAdminButton()
                Button("Войти с другим номером") { Task { await app.logout() } }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(24)
    }
}
