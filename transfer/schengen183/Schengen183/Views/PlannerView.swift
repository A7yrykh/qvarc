import SwiftUI

struct PlannerView: View {
    let traveler: Traveler
    @State private var start = Calendar.current.date(byAdding: .day, value: 14, to: Date())!
    @State private var end = Calendar.current.date(byAdding: .day, value: 28, to: Date())!
    @State private var length = 30

    var body: some View {
        let today = Day.today()
        let calc = SchengenCalculator(stays: traveler.stayList(today: today))
        let trip = Day(start)...max(Day(start), Day(end))
        let result = calc.evaluate(trip: trip)

        NavigationStack {
            Form {
                Section {
                    DatePicker("Arrive", selection: $start, displayedComponents: .date)
                    DatePicker("Leave", selection: $end, in: start..., displayedComponents: .date)
                } header: {
                    Text("Planned Schengen trip")
                } footer: {
                    Text("Checked against all your recorded and planned trips.")
                }

                Section("Result") {
                    if result.isAllowed {
                        Label("This trip fits the 90/180 rule", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        LabeledContent("Trip length", value: String(localized: "\(trip.dayCount) days"))
                        LabeledContent("Most days used in any 180-day window", value: "\(result.maxUsed) / 90")
                    } else if let violation = result.firstViolation {
                        Label("This trip breaks the 90/180 rule", systemImage: "xmark.octagon.fill")
                            .foregroundStyle(.red)
                        LabeledContent("Limit exceeded on", value: violation.formatted)
                        LabeledContent("Days over the limit", value: "\(result.overstayDays)")
                    }
                    if let last = result.lastAllowedDay {
                        LabeledContent("Latest safe exit for this arrival", value: last.formatted)
                    } else {
                        Text("No Schengen days are available on the arrival date.")
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    Stepper(value: $length, in: 1...90) {
                        LabeledContent("Trip length", value: String(localized: "\(length) days"))
                    }
                    if let earliest = calc.earliestEntry(forDays: length, from: today) {
                        LabeledContent("Earliest arrival", value: earliest.formattedLong)
                        Button("Use these dates") {
                            start = earliest.date()
                            end = earliest.adding(length - 1).date()
                        }
                    }
                } header: {
                    Text("When can I come back?")
                } footer: {
                    Text("The earliest date from today when you can stay this many days in a row.")
                }
            }
            .navigationTitle("Plan a trip")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { TravelerSwitcher() }
            }
            .onChange(of: start) { _, value in
                if end < value { end = value }
            }
        }
    }
}
