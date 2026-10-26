import SwiftUI
import SwiftData
import UIKit

struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// Кольцо «использовано из 90».
struct UsageRing: View {
    let used: Int
    var limit: Int = SchengenCalculator.limit

    private var fraction: Double { min(1, Double(used) / Double(limit)) }
    private var color: Color {
        used > limit ? .red : used >= limit - 10 ? .orange : .accentColor
    }

    var body: some View {
        ZStack {
            Circle().stroke(Color(.systemGray5), lineWidth: 18)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(color, style: StrokeStyle(lineWidth: 18, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeOut, value: fraction)
            VStack(spacing: 2) {
                Text("\(max(0, limit - used))")
                    .font(.system(size: 54, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text("days left")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("\(used) / \(limit) used")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .frame(width: 210, height: 210)
        .accessibilityElement(children: .combine)
    }
}

struct CountryLabel: View {
    let code: String

    var body: some View {
        HStack(spacing: 8) {
            Text(Countries.flag(code))
            Text(Countries.name(code))
        }
    }
}

struct SchengenBadge: View {
    var body: some View {
        Text("Schengen")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.accentColor.opacity(0.15), in: Capsule())
            .foregroundStyle(Color.accentColor)
    }
}

struct ProBadge: View {
    var body: some View {
        Text("PRO")
            .font(.caption2.weight(.heavy))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.orange.opacity(0.18), in: Capsule())
            .foregroundStyle(.orange)
    }
}

struct CountryPicker: View {
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    private let all = Countries.all()

    private var filtered: [String] {
        guard !search.isEmpty else { return all }
        return all.filter { Countries.name($0).localizedCaseInsensitiveContains(search) || $0.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        List {
            if search.isEmpty {
                Section("Schengen area") {
                    ForEach(all.filter(Countries.countsTowardSchengen), id: \.self, content: row)
                }
                Section("All countries") {
                    ForEach(all.filter { !Countries.countsTowardSchengen($0) }, id: \.self, content: row)
                }
            } else {
                ForEach(filtered, id: \.self, content: row)
            }
        }
        .searchable(text: $search)
        .navigationTitle("Country")
    }

    private func row(_ code: String) -> some View {
        Button {
            selection = code
            dismiss()
        } label: {
            HStack {
                CountryLabel(code: code).foregroundStyle(.primary)
                Spacer()
                if code == selection { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
            }
        }
    }
}

/// Переключатель путешественника (Pro: семья) в панели навигации.
struct TravelerSwitcher: View {
    @EnvironmentObject private var purchases: PurchaseManager
    @Query(sort: \Traveler.createdAt) private var travelers: [Traveler]
    @AppStorage(Prefs.selectedTraveler) private var selectedID = ""

    var body: some View {
        if purchases.isPro, travelers.count > 1 {
            Menu {
                Picker("Traveller", selection: $selectedID) {
                    ForEach(travelers) { t in
                        Text(t.displayName).tag(t.id.uuidString)
                    }
                }
            } label: {
                Label(current?.displayName ?? String(localized: "Me"), systemImage: "person.crop.circle")
                    .labelStyle(.titleAndIcon)
            }
        }
    }

    private var current: Traveler? {
        travelers.first { $0.id.uuidString == selectedID } ?? travelers.first(where: \.isPrimary)
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct ExportItem: Identifiable {
    let url: URL
    var id: URL { url }
}

struct ProLockedView: View {
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    let systemImage: String
    @State private var showPaywall = false

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        } actions: {
            Button("Unlock Pro") { showPaywall = true }
                .buttonStyle(.borderedProminent)
        }
        .sheet(isPresented: $showPaywall) { PaywallView() }
    }
}
