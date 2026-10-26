import SwiftData
import SwiftUI

/// Прибыль за месяц и год, склад, пороги DAC7, экспорт CSV.
struct SummaryView: View {
    @EnvironmentObject private var subscription: SubscriptionService
    @Query private var items: [Item]

    @State private var year = Calendar.current.component(.year, from: .now)
    @State private var showPaywall = false

    private var calendar: Calendar { .current }

    private var soldThisYear: [Item] {
        items.filter { item in
            guard item.status == .sold, let soldAt = item.soldAt else { return false }
            return calendar.component(.year, from: soldAt) == year
        }
    }

    private var yearLines: [SaleLine] { soldThisYear.compactMap(\.saleLine) }

    private var monthLines: [SaleLine] {
        yearLines.filter { calendar.isDate($0.date, equalTo: .now, toGranularity: .month) }
    }

    private var stockItems: [Item] { items.filter { $0.status.isInStock } }
    private var stockValue: Decimal { stockItems.reduce(0) { $0 + $1.purchaseCost + $1.extraCosts } }

    private var years: [Int] {
        let current = calendar.component(.year, from: .now)
        let sold = items.compactMap { $0.soldAt }.map { calendar.component(.year, from: $0) }
        return Array(Set(sold + [current])).sorted(by: >)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Año", selection: $year) {
                        ForEach(years, id: \.self) { Text(String($0)).tag($0) }
                    }
                }

                Section {
                    let summary = SalesReport.summary(yearLines)
                    let month = SalesReport.summary(monthLines)
                    let days = summary.averageDaysToSell.map { String($0) } ?? "—"
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        StatTile(
                            title: "Beneficio \(String(year))",
                            value: Money.format(summary.netProfit),
                            footnote: String(localized: "\(summary.count) ventas"),
                            tint: summary.netProfit >= 0 ? .green : .red
                        )
                        StatTile(
                            title: "Este mes",
                            value: Money.format(month.netProfit),
                            footnote: String(localized: "\(month.count) ventas")
                        )
                        StatTile(
                            title: "Facturado",
                            value: Money.format(summary.revenue),
                            footnote: summary.marginPercent.map { String(localized: "Margen medio \(Money.percent($0))") }
                        )
                        StatTile(
                            title: "En stock",
                            value: Money.format(stockValue),
                            footnote: String(localized: "\(stockItems.count) artículos · días medios de venta: \(days)")
                        )
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                dac7Section

                Section {
                    if subscription.isPro {
                        if let url = exportFile() {
                            ShareLink(item: url) {
                                Label("Exportar ventas \(String(year)) (CSV)", systemImage: "tablecells")
                            }
                        }
                    } else {
                        Button {
                            showPaywall = true
                        } label: {
                            Label("Exportar ventas (CSV) · Pro", systemImage: "lock")
                        }
                    }
                } footer: {
                    Text("Para tu control o para tu gestor: fecha, artículo, plataforma, coste, precio, comisión y beneficio.")
                }
            }
            .navigationTitle("Resumen")
            .sheet(isPresented: $showPaywall) { PaywallView() }
        }
    }

    private var dac7Section: some View {
        Section {
            let records = soldThisYear.compactMap(\.saleRecord)
            let statuses = DAC7.statuses(year: year, sales: records, calendar: calendar)
            if statuses.isEmpty {
                Text("Aún no hay ventas en \(String(year)).").foregroundStyle(.secondary)
            }
            ForEach(statuses) { status in
                DAC7Row(status: status)
            }
        } header: {
            Text("Límites DAC7 (Hacienda)")
        } footer: {
            Text("Cada plataforma informa a Hacienda (modelo 238) de quien vende 30 o más artículos o más de 2.000 € en un año en esa plataforma. No es un impuesto, pero esas ventas aparecerán en tu borrador de la Renta. Revende no ofrece asesoramiento fiscal.")
        }
    }

    private func exportFile() -> URL? {
        let csv = SalesReport.csv(yearLines)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Revende-ventas-\(year).csv")
        do {
            try csv.write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            return nil
        }
    }
}

private struct DAC7Row: View {
    let status: DAC7.Status

    private var tint: Color {
        switch status.level {
        case .below: .green
        case .near: .orange
        case .reportable: .red
        }
    }

    private var message: String {
        switch status.level {
        case .below:
            String(localized: "Te quedan \(status.salesRemaining) ventas o \(Money.format(status.amountRemaining)).")
        case .near:
            String(localized: "Cerca del límite: quedan \(status.salesRemaining) ventas o \(Money.format(status.amountRemaining)).")
        case .reportable:
            String(localized: "\(status.platform.displayName) informará de tus ventas de este año a Hacienda.")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(status.platform.displayName).font(.headline)
                Spacer()
                Text("\(status.salesCount)/\(DAC7.salesThreshold) · \(Money.format(status.totalAmount))")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: status.progress).tint(tint)
            Text(message).font(.caption).foregroundStyle(tint)
        }
        .padding(.vertical, 4)
    }
}
