import SwiftData
import SwiftUI

/// Куда можно перейти с главного экрана.
enum Route: Hashable {
    case papers, vault, days, absences, travel, settings
}

/// Корень приложения: язык, блокировка, первый запуск и одна навигационная стопка от «Mi expediente».
struct Shell: View {
    @AppStorage("lang") private var langRaw = Lang.preferred().rawValue
    @Query private var profiles: [Profile]
    @Query private var documents: [StoredDocument]
    @Query private var tramites: [ActiveTramite]
    @EnvironmentObject private var lock: AppLock
    @EnvironmentObject private var tracker: LocationTracker
    @Environment(\.scenePhase) private var scenePhase
    @State private var path = NavigationPath()

    private var lang: Lang { Lang(rawValue: langRaw) ?? .en }

    var body: some View {
        Group {
            if profiles.first != nil {
                NavigationStack(path: $path) {
                    ExpedienteView()
                        .navigationDestination(for: Route.self, destination: destination)
                        .navigationDestination(for: String.self) { id in
                            if let t = Catalog.tramite(id: id) { TramiteDetailView(tramite: t) }
                        }
                }
                .onAppear(perform: openInitialRoute)
            } else {
                SetupView()
            }
        }
        .tint(Color.brand)
        .environment(\.lang, lang)
        .environment(\.locale, lang.locale)
        .overlay {
            if lock.isLocked { LockScreen().environment(\.lang, lang) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { lock.lockIfNeeded() }
            if phase == .active {
                tracker.refreshNow()
                reschedule()
            }
        }
        .onChange(of: langRaw) { _, _ in reschedule() }
    }

    @ViewBuilder
    private func destination(_ route: Route) -> some View {
        switch route {
        case .papers: CatalogView()
        case .vault: DocumentsView()
        case .days: DaysView()
        case .absences: AbsencesView()
        case .travel: TravelCheckView()
        case .settings: AjustesView()
        }
    }

    private func openInitialRoute() {
        #if DEBUG
        guard path.isEmpty, let route = Fixtures.route else { return }
        switch route {
        case "papers": path.append(Route.papers)
        case "vault": path.append(Route.vault)
        case "days": path.append(Route.days)
        case "absences": path.append(Route.absences)
        case "travel": path.append(Route.travel)
        case "settings": path.append(Route.settings)
        default:
            if route.hasPrefix("tramite:") { path.append(String(route.dropFirst(8))) }
        }
        #endif
    }

    private func reschedule() {
        Task { await NotificationService.reschedule(documents: documents, tramites: tramites, lang: lang) }
    }
}

struct LockScreen: View {
    @Environment(\.lang) private var lang
    @EnvironmentObject private var lock: AppLock

    var body: some View {
        ZStack {
            LinearGradient(colors: [.brandDeep, .brandNight], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            VStack(spacing: 18) {
                Image(systemName: "lock.fill").font(.system(size: 40)).foregroundStyle(Color.cream)
                Text(S.locked[lang]).font(.headline).foregroundStyle(Color.cream)
                Button(S.unlock[lang]) {
                    Task { await lock.unlock(reason: S.locked[lang]) }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.flagYellow)
                .foregroundStyle(Color.brandNight)
            }
        }
        .task { await lock.unlock(reason: S.locked[lang]) }
    }
}
