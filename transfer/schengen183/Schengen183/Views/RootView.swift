import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var purchases: PurchaseManager
    @EnvironmentObject private var tracker: LocationTracker
    @Query(sort: \Traveler.createdAt) private var travelers: [Traveler]
    @AppStorage(Prefs.selectedTraveler) private var selectedID = ""
    @AppStorage(Prefs.onboarded) private var onboarded = false

    private var current: Traveler? {
        let primary = travelers.first(where: \.isPrimary)
        guard purchases.isPro else { return primary }
        return travelers.first { $0.id.uuidString == selectedID } ?? primary
    }

    var body: some View {
        Group {
            if let current {
                TabView {
                    StatusView(traveler: current)
                        .tabItem { Label("Status", systemImage: "gauge.with.dots.needle.50percent") }
                    TripsView(traveler: current)
                        .tabItem { Label("Trips", systemImage: "airplane") }
                    PlannerView(traveler: current)
                        .tabItem { Label("Plan", systemImage: "calendar.badge.clock") }
                    TaxView(traveler: current)
                        .tabItem { Label("183 days", systemImage: "building.columns") }
                    SettingsView()
                        .tabItem { Label("Settings", systemImage: "gearshape") }
                }
            } else {
                ProgressView()
                    .task { Persistence.prepare() }
            }
        }
        .sheet(isPresented: Binding(get: { !onboarded }, set: { onboarded = !$0 })) {
            OnboardingView()
                .interactiveDismissDisabled()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                tracker.refreshNow()
                Reminders.reschedule(context: context)
            }
        }
    }
}
