import SwiftData
import SwiftUI

/// Журнал поездок и все счётчики по нему.
struct DaysView: View {
    @Environment(\.lang) private var lang
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var access: FullAccess
    @EnvironmentObject private var tracker: LocationTracker
    @Query private var profiles: [Profile]
    @Query(sort: \Trip.startOrdinal, order: .reverse) private var trips: [Trip]
    @State private var editing: Trip?
    @State private var adding = false
    @State private var showUnlock = false
    @State private var share: SharedFile?

    var body: some View {
        List {
            if let profile = profiles.first {
                countersSection(profile)
            }

            Section {
                if trips.isEmpty {
                    Text(profiles.first?.residenceStart == nil ? W.noStaysVisitor[lang] : W.noTrips[lang])
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(trips) { trip in
                    Button { editing = trip } label: { TripRow(trip: trip) }
                        .buttonStyle(.plain)
                }
                .onDelete { offsets in
                    for i in offsets { context.delete(trips[i]) }
                    try? context.save()
                }
            } header: {
                Text(W.myTrips[lang])
            }

            Section {
                Toggle(W.autoTracking[lang], isOn: Binding(
                    get: { tracker.isEnabled && access.isUnlocked },
                    set: { on in
                        guard access.isUnlocked else { showUnlock = true; return }
                        on ? tracker.enable() : tracker.disable()
                    }))
                if let code = tracker.lastCountry, tracker.isEnabled {
                    LabeledContent(W.country[lang], value: "\(Countries.flag(code)) \(Countries.name(code, locale: lang.locale))")
                }
            } footer: {
                Text(W.autoTrackingHint[lang])
            }

            Section {
                Button { export(pdf: true) } label: { Label(W.exportPDF[lang], systemImage: "doc.richtext") }
                Button { export(pdf: false) } label: { Label(W.exportCSV[lang], systemImage: "tablecells") }
            }
        }
        .navigationTitle(W.days[lang])
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel(W.addTrip[lang])
            }
        }
        .sheet(isPresented: $adding) { NavigationStack { TripEditor(trip: nil) } }
        .sheet(item: $editing) { trip in NavigationStack { TripEditor(trip: trip) } }
        .sheet(isPresented: $showUnlock) { UnlockSheet(reason: W.limitFull[lang]) }
        .sheet(item: $share) { file in ShareSheet(items: [file.url]) }
    }

    private func countersSection(_ profile: Profile) -> some View {
        let ledger = profile.ledger(trips)
        let year = Day.today().year
        return Section(W.counters[lang]) {
            LabeledContent(W.daysInSpainYear.format(lang, year), value: "\(ledger.daysInSpain(year: year)) / 183")
            LabeledContent(W.daysInSpainYear.format(lang, year - 1), value: "\(ledger.daysInSpain(year: year - 1)) / 183")
            LabeledContent(profile.residenceStart == nil ? W.schengenVisitor[lang] : W.schengenAbroad[lang],
                           value: W.daysLeftOf90.format(lang, ledger.schengenLeft))
        }
    }

    private func export(pdf: Bool) {
        guard access.isUnlocked else { showUnlock = true; return }
        guard let profile = profiles.first else { return }
        let url = try? (pdf ? DaysReport.pdf(profile: profile, trips: trips, lang: lang)
                            : DaysReport.csv(trips: trips))
        share = url.map(SharedFile.init(url:))
    }
}

struct SharedFile: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct TripRow: View {
    @Environment(\.lang) private var lang
    let trip: Trip

    var body: some View {
        let stay = trip.stay()
        HStack(spacing: 12) {
            Text(Countries.flag(trip.country)).font(.title2)
            VStack(alignment: .leading, spacing: 2) {
                Text(Countries.name(trip.country, locale: lang.locale)).font(.subheadline.weight(.semibold))
                Text("\(formatDate(trip.start.date(), lang: lang)) – \(trip.isOngoing ? W.stillThere[lang] : formatDate(stay.end.date(), lang: lang))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(W.daysCount.format(lang, stay.length)).font(.caption.weight(.semibold)).monospacedDigit()
                if trip.isAuto {
                    Image(systemName: "location.fill").font(.caption2).foregroundStyle(Color.brand)
                }
            }
        }
        .contentShape(Rectangle())
    }
}

struct TripEditor: View {
    @Environment(\.lang) private var lang
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    let trip: Trip?

    @State private var country = "FR"
    @State private var start = Date()
    @State private var end = Date()
    @State private var ongoing = false
    @State private var note = ""

    var body: some View {
        Form {
            Picker(W.country[lang], selection: $country) {
                ForEach(Countries.all(locale: lang.locale), id: \.self) { code in
                    Text("\(Countries.flag(code)) \(Countries.name(code, locale: lang.locale))").tag(code)
                }
            }
            DatePicker(W.departure[lang], selection: $start, displayedComponents: .date)
            Toggle(W.stillThere[lang], isOn: $ongoing)
            if !ongoing {
                DatePicker(W.comeback[lang], selection: $end, in: start..., displayedComponents: .date)
            }
            TextField(W.note[lang], text: $note)
            if let trip {
                Section {
                    Button(S.delete[lang], role: .destructive) {
                        context.delete(trip)
                        try? context.save()
                        dismiss()
                    }
                }
            }
        }
        .navigationTitle(trip == nil ? W.addTrip[lang] : Countries.name(country, locale: lang.locale))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(S.cancel[lang]) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button(S.save[lang], action: save) }
        }
        .onAppear(perform: load)
    }

    private func load() {
        guard let trip else { return }
        country = trip.country
        start = trip.start.date()
        end = (trip.end ?? .today()).date()
        ongoing = trip.isOngoing
        note = trip.note
    }

    private func save() {
        let s = Day(start)
        let e: Day? = ongoing ? nil : max(s, Day(end))
        if let trip {
            trip.country = country
            trip.start = s
            trip.end = e
            trip.note = note
            trip.isAuto = false
        } else {
            context.insert(Trip(country: country, start: s, end: e, note: note))
        }
        try? context.save()
        dismiss()
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
