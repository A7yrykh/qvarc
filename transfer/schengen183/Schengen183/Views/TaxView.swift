import SwiftUI

struct TaxView: View {
    let traveler: Traveler
    @EnvironmentObject private var purchases: PurchaseManager
    @State private var year = Day.today().year
    @State private var rolling = false
    @State private var export: ExportItem?
    @State private var exportError: String?

    var body: some View {
        NavigationStack {
            Group {
                if purchases.isPro {
                    content
                } else {
                    ProLockedView(title: "183-day tax residency",
                                  message: "Count your days in every country per calendar year or the last 12 months, get a warning before 183 days and export a PDF report for your tax adviser.",
                                  systemImage: "building.columns")
                }
            }
            .navigationTitle("183 days")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { TravelerSwitcher() }
                if purchases.isPro {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            do {
                                export = ExportItem(url: try ReportExporter.pdfFile(.init(traveler: traveler, year: year)))
                            } catch {
                                exportError = error.localizedDescription
                            }
                        } label: {
                            Label("PDF report", systemImage: "square.and.arrow.up")
                        }
                    }
                }
            }
            .sheet(item: $export) { item in ShareSheet(items: [item.url]) }
            .alert("Export failed", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(exportError ?? "")
            }
        }
    }

    private var content: some View {
        let today = Day.today()
        let calc = ResidencyCalculator(stays: traveler.stayList(today: today))
        let years = Set(calc.years + [today.year]).sorted(by: >)
        let totals = rolling ? calc.rolling12Months(endingOn: today) : calc.totals(year: year)

        return List {
            Section {
                Picker("Period", selection: $rolling) {
                    Text("Calendar year").tag(false)
                    Text("Last 12 months").tag(true)
                }
                .pickerStyle(.segmented)
                if !rolling {
                    Picker("Year", selection: $year) {
                        ForEach(years, id: \.self) { Text(String($0)).tag($0) }
                    }
                }
            }
            Section {
                if totals.isEmpty {
                    Text("No days recorded for this period.").foregroundStyle(.secondary)
                }
                ForEach(totals, id: \.country) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            CountryLabel(code: item.country)
                            Spacer()
                            Text("\(item.days) days").monospacedDigit().font(.body.weight(.semibold))
                        }
                        ProgressView(value: Double(min(item.days, 183)), total: 183)
                            .tint(item.reachesThreshold ? .orange : .accentColor)
                        Text(item.reachesThreshold
                             ? String(localized: "183 days reached")
                             : String(localized: "\(item.remainingToThreshold) days to 183"))
                            .font(.caption)
                            .foregroundStyle(item.reachesThreshold ? .orange : .secondary)
                    }
                    .padding(.vertical, 4)
                }
            } footer: {
                Text("Days of physical presence; a travel day counts in both countries. Residency rules differ by country (for example, Spain uses more than 183 days in a calendar year; the UK uses the 6 April tax year and the Statutory Residence Test). This is not tax advice.")
            }
        }
    }
}
