import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var purchases: PurchaseManager
    @EnvironmentObject private var tracker: LocationTracker
    @Query(sort: \Traveler.createdAt) private var travelers: [Traveler]
    @AppStorage(Prefs.reminders) private var reminders = false
    @State private var showPaywall = false
    @State private var showManage = false
    @State private var export: ExportItem?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if purchases.isPro {
                        Label("Pro is active", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(.green)
                        Button("Manage subscription") { showManage = true }
                    } else {
                        Button {
                            showPaywall = true
                        } label: {
                            HStack {
                                Label("Unlock Pro", systemImage: "star.fill")
                                Spacer()
                                ProBadge()
                            }
                        }
                    }
                }

                Section {
                    Toggle(isOn: Binding(get: { purchases.isPro && tracker.isEnabled }, set: setTracking)) {
                        Label("Automatic tracking", systemImage: "location")
                    }
                    if purchases.isPro, tracker.isEnabled {
                        switch tracker.authorization {
                        case .denied, .restricted:
                            Button("Allow location in Settings") { openSystemSettings() }
                        case .authorizedWhenInUse:
                            Button("Switch to “Always” in Settings") { openSystemSettings() }
                        default:
                            EmptyView()
                        }
                    }
                } footer: {
                    Text("Uses low-power significant location changes to note which country you are in each day. Only the country is saved, on this iPhone. Coordinates are never stored or sent to us.")
                }

                Section {
                    Toggle(isOn: Binding(get: { purchases.isPro && reminders }, set: setReminders)) {
                        Label("Reminders", systemImage: "bell")
                    }
                } footer: {
                    Text("Notifications 14, 7 and 1 days before you must leave the Schengen area, and 14 days before 183 days in a country.")
                }

                Section("Travellers and data") {
                    NavigationLink {
                        TravelersView()
                    } label: {
                        LabeledContent {
                            Text("\(travelers.count)")
                        } label: {
                            Label("Travellers", systemImage: "person.2")
                        }
                    }
                    Button {
                        guard purchases.isPro else { showPaywall = true; return }
                        export = (try? ReportExporter.csvFile(for: travelers)).map(ExportItem.init)
                    } label: {
                        HStack {
                            Label("Export all trips (CSV)", systemImage: "tablecells")
                            Spacer()
                            if !purchases.isPro { ProBadge() }
                        }
                    }
                }

                Section("About") {
                    NavigationLink {
                        HelpView()
                    } label: {
                        Label("How the rules work", systemImage: "questionmark.circle")
                    }
                    Link(destination: AppInfo.eesInfoURL) {
                        Label("EES – official EU information", systemImage: "link")
                    }
                    Link(destination: AppInfo.privacyURL) {
                        Label("Privacy policy", systemImage: "hand.raised")
                    }
                    Link(destination: AppInfo.termsURL) {
                        Label("Terms of use (EULA)", systemImage: "doc.text")
                    }
                    Link(destination: URL(string: "mailto:\(AppInfo.supportEmail)")!) {
                        Label("Contact support", systemImage: "envelope")
                    }
                    LabeledContent("Version", value: AppInfo.version)
                }

                Section {
                    Text("90/180 & 183 helps you estimate your days. It is not legal or tax advice, and the official count at the border or by the tax authority prevails.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } footer: {
                    Text("© 2026 AVSyrykh SL")
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showPaywall) { PaywallView() }
            .sheet(item: $export) { item in ShareSheet(items: [item.url]) }
            .manageSubscriptionsSheet(isPresented: $showManage)
        }
    }

    private func setTracking(_ on: Bool) {
        guard purchases.isPro else { showPaywall = true; return }
        if on { tracker.enable() } else { tracker.disable() }
    }

    private func setReminders(_ on: Bool) {
        guard purchases.isPro else { showPaywall = true; return }
        if on {
            Task {
                reminders = await Reminders.requestPermission()
                Reminders.reschedule(context: context)
            }
        } else {
            reminders = false
            Reminders.reschedule(context: context)
        }
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}

struct TravelersView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var purchases: PurchaseManager
    @Query(sort: \Traveler.createdAt) private var travelers: [Traveler]
    @AppStorage(Prefs.selectedTraveler) private var selectedID = ""
    @State private var showPaywall = false
    @State private var newName = ""
    @State private var adding = false

    var body: some View {
        List {
            Section {
                ForEach(travelers) { traveler in
                    TravelerRow(traveler: traveler, selected: traveler.id.uuidString == selectedID
                                || (selectedID.isEmpty && traveler.isPrimary))
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard purchases.isPro || traveler.isPrimary else { showPaywall = true; return }
                            selectedID = traveler.id.uuidString
                        }
                        .deleteDisabled(traveler.isPrimary)
                }
                .onDelete { offsets in
                    for i in offsets where !travelers[i].isPrimary {
                        if travelers[i].id.uuidString == selectedID { selectedID = "" }
                        context.delete(travelers[i])
                    }
                    try? context.save()
                }
            } footer: {
                Text("Keep separate counts for your partner, children or clients. Automatic tracking records only the owner of this iPhone.")
            }
            Section {
                Button {
                    if purchases.isPro { adding = true } else { showPaywall = true }
                } label: {
                    HStack {
                        Label("Add traveller", systemImage: "person.badge.plus")
                        Spacer()
                        if !purchases.isPro { ProBadge() }
                    }
                }
            }
        }
        .navigationTitle("Travellers")
        .sheet(isPresented: $showPaywall) { PaywallView() }
        .alert("New traveller", isPresented: $adding) {
            TextField("Name", text: $newName)
            Button("Add") {
                let t = Traveler(name: newName.trimmingCharacters(in: .whitespaces))
                context.insert(t)
                try? context.save()
                selectedID = t.id.uuidString
                newName = ""
            }
            Button("Cancel", role: .cancel) { newName = "" }
        }
    }
}

private struct TravelerRow: View {
    @Bindable var traveler: Traveler
    let selected: Bool

    var body: some View {
        HStack {
            Image(systemName: traveler.isPrimary ? "iphone" : "person")
                .foregroundStyle(.secondary)
                .frame(width: 24)
            TextField(traveler.isPrimary ? String(localized: "Me") : String(localized: "Name"), text: $traveler.name)
            Spacer()
            Text("\(traveler.stays?.count ?? 0) trips")
                .font(.caption)
                .foregroundStyle(.secondary)
            if selected {
                Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
            }
        }
    }
}
