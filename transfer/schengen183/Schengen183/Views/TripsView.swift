import SwiftUI
import SwiftData

struct TripsView: View {
    let traveler: Traveler
    @Environment(\.modelContext) private var context
    @State private var editing: StayRecord?
    @State private var showNew = false

    private var records: [StayRecord] {
        (traveler.stays ?? []).sorted { $0.startOrdinal > $1.startOrdinal }
    }

    var body: some View {
        let today = Day.today()
        let byYear = Dictionary(grouping: records) { $0.start.year }

        NavigationStack {
            Group {
                if records.isEmpty {
                    ContentUnavailableView {
                        Label("No trips yet", systemImage: "airplane.departure")
                    } description: {
                        Text("Add your stays abroad for the last 180 days to see how many Schengen days you have left.")
                    } actions: {
                        Button("Add trip") { showNew = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    List {
                        ForEach(byYear.keys.sorted(by: >), id: \.self) { year in
                            Section(String(year)) {
                                ForEach(byYear[year] ?? []) { record in
                                    Button { editing = record } label: { row(record, today: today) }
                                        .foregroundStyle(.primary)
                                }
                                .onDelete { offsets in
                                    let items = byYear[year] ?? []
                                    for i in offsets { context.delete(items[i]) }
                                    try? context.save()
                                    Reminders.reschedule(context: context)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Trips")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { TravelerSwitcher() }
                ToolbarItem(placement: .primaryAction) {
                    Button { showNew = true } label: { Label("Add trip", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $showNew) { TripEditor(traveler: traveler, record: nil) }
            .sheet(item: $editing) { record in TripEditor(traveler: traveler, record: record) }
        }
    }

    private func row(_ record: StayRecord, today: Day) -> some View {
        let stay = record.stay(today: today)
        return HStack(alignment: .top, spacing: 12) {
            Text(Countries.flag(stay.country)).font(.title2)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(Countries.name(stay.country)).font(.body.weight(.medium))
                    if stay.isSchengen { SchengenBadge() }
                    if record.isAuto {
                        Image(systemName: "location.fill").font(.caption2).foregroundStyle(.secondary)
                            .accessibilityLabel("Recorded automatically")
                    }
                }
                Group {
                    if record.isOngoing {
                        Text("\(stay.start.formatted) – now")
                    } else {
                        Text("\(stay.start.formatted) – \(stay.end.formatted)")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                if !record.note.isEmpty {
                    Text(record.note).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            Text("\(stay.length) d")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}

struct TripEditor: View {
    let traveler: Traveler
    let record: StayRecord?
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var country = "ES"
    @State private var entry = Date()
    @State private var exit = Date()
    @State private var ongoing = false
    @State private var note = ""
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NavigationLink {
                        CountryPicker(selection: $country)
                    } label: {
                        HStack {
                            Text("Country")
                            Spacer()
                            CountryLabel(code: country).foregroundStyle(.secondary)
                        }
                    }
                    if Countries.countsTowardSchengen(country) {
                        Label("Counts toward 90/180", systemImage: "checkmark.seal")
                            .font(.footnote)
                            .foregroundStyle(Color.accentColor)
                    }
                }
                Section {
                    DatePicker("Entry", selection: $entry, displayedComponents: .date)
                    Toggle("I'm still there", isOn: $ongoing)
                    if !ongoing {
                        DatePicker("Exit", selection: $exit, in: entry..., displayedComponents: .date)
                    }
                } footer: {
                    Text("Entry and exit days both count as full days.")
                }
                Section("Note") {
                    TextField("Optional", text: $note, axis: .vertical)
                }
                if let record {
                    Section {
                        Button("Delete trip", role: .destructive) {
                            context.delete(record)
                            try? context.save()
                            Reminders.reschedule(context: context)
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(record == nil ? Text("New trip") : Text("Edit trip"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save) }
            }
            .onAppear(perform: load)
            .onChange(of: entry) { _, value in
                if exit < value { exit = value }
            }
        }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let record {
            country = record.country
            entry = record.start.date()
            exit = (record.end ?? Day.today()).date()
            ongoing = record.isOngoing
            note = record.note
        } else if let last = (traveler.stays ?? []).max(by: { $0.startOrdinal < $1.startOrdinal }) {
            country = last.country
        }
    }

    private func save() {
        let start = Day(entry)
        let end: Day? = ongoing ? nil : max(start, Day(exit))
        if let record {
            record.country = country
            record.start = start
            record.end = end
            record.note = note
        } else {
            context.insert(StayRecord(country: country, start: start, end: end, note: note, traveler: traveler))
        }
        try? context.save()
        Reminders.reschedule(context: context)
        dismiss()
    }
}
