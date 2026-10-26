import SwiftUI

struct StatusView: View {
    let traveler: Traveler
    @EnvironmentObject private var purchases: PurchaseManager
    @EnvironmentObject private var tracker: LocationTracker
    @State private var showEditor = false
    @State private var showPaywall = false

    var body: some View {
        let today = Day.today()
        let stays = traveler.stayList(today: today)
        let calc = SchengenCalculator(stays: stays)
        let used = calc.used(on: today)
        let ongoing = (traveler.stays ?? []).filter(\.isOngoing)
        let inSchengen = ongoing.contains { Countries.countsTowardSchengen($0.country) }
        let lastAllowed = calc.lastAllowedDay(stayingFrom: today)

        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Card {
                        HStack {
                            Spacer()
                            UsageRing(used: used)
                            Spacer()
                        }
                        .padding(.vertical, 8)
                        Text("Schengen days in the last 180 days, counting today.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .multilineTextAlignment(.center)
                    }

                    statusCard(today: today, calc: calc, used: used, inSchengen: inSchengen,
                               lastAllowed: lastAllowed, ongoing: ongoing)

                    let timeline = calc.recoveryTimeline(from: today)
                    if !timeline.isEmpty, calc.available(enteringOn: today) < SchengenCalculator.limit {
                        Card {
                            Label("Days coming back", systemImage: "arrow.uturn.backward.circle")
                                .font(.headline)
                            ForEach(Array(timeline.prefix(5)), id: \.day) { point in
                                HStack {
                                    Text(point.day.formatted)
                                    Spacer()
                                    Text("\(point.available) days available")
                                        .monospacedDigit()
                                        .foregroundStyle(.secondary)
                                }
                                .font(.subheadline)
                            }
                            Text("If you stay outside the Schengen area until that date.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    taxCard(today: today, stays: stays)
                    trackingCard

                    Text("Estimates only. Border guards and the EES keep the official count of your stays.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("90/180")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { TravelerSwitcher() }
                ToolbarItem(placement: .primaryAction) {
                    Button { showEditor = true } label: { Label("Add trip", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $showEditor) { TripEditor(traveler: traveler, record: nil) }
            .sheet(isPresented: $showPaywall) { PaywallView() }
        }
    }

    @ViewBuilder
    private func statusCard(today: Day, calc: SchengenCalculator, used: Int, inSchengen: Bool,
                            lastAllowed: Day?, ongoing: [StayRecord]) -> some View {
        Card {
            if inSchengen {
                let country = ongoing.first { Countries.countsTowardSchengen($0.country) }?.country ?? "ES"
                Label {
                    Text("You are in \(Countries.name(country))")
                } icon: {
                    Text(Countries.flag(country))
                }
                .font(.headline)
                if used > SchengenCalculator.limit {
                    Label("Over the limit by \(used - SchengenCalculator.limit) days. Leave as soon as possible.",
                          systemImage: "exclamationmark.octagon.fill")
                        .foregroundStyle(.red)
                } else if let lastAllowed {
                    Text("Leave by **\(lastAllowed.formattedLong)**")
                    Text("\(lastAllowed - today) more days after today")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                Label("Outside the Schengen area", systemImage: "globe.europe.africa")
                    .font(.headline)
                if let lastAllowed {
                    Text("Enter today and you can stay until **\(lastAllowed.formattedLong)** (\(lastAllowed - today + 1) days).")
                } else if let next = calc.earliestEntry(forDays: 1, from: today) {
                    Label("No days available today. Next possible entry: \(next.formattedLong).", systemImage: "hourglass")
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    @ViewBuilder
    private func taxCard(today: Day, stays: [Stay]) -> some View {
        Card {
            HStack {
                Label("Tax residency \(String(today.year))", systemImage: "building.columns")
                    .font(.headline)
                Spacer()
                if !purchases.isPro { ProBadge() }
            }
            if purchases.isPro {
                let totals = ResidencyCalculator(stays: stays).totals(year: today.year)
                if totals.isEmpty {
                    Text("No days recorded this year.").foregroundStyle(.secondary)
                }
                ForEach(totals.prefix(3), id: \.country) { item in
                    HStack {
                        CountryLabel(code: item.country)
                        Spacer()
                        Text("\(item.days) / 183")
                            .monospacedDigit()
                            .foregroundStyle(item.reachesThreshold ? .orange : .secondary)
                    }
                    .font(.subheadline)
                }
            } else {
                Text("See how many days you spent in each country this year and when you reach 183.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Unlock Pro") { showPaywall = true }
                    .buttonStyle(.bordered)
            }
        }
    }

    @ViewBuilder
    private var trackingCard: some View {
        if purchases.isPro, tracker.isEnabled {
            Card {
                Label("Automatic tracking is on", systemImage: "location.fill")
                    .font(.headline)
                if let code = tracker.lastCountry, let date = tracker.lastUpdate {
                    Text("Last seen in \(Countries.flag(code)) \(Countries.name(code)), \(date.formatted(date: .abbreviated, time: .shortened))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if !tracker.hasAlwaysAccess {
                    Text("Allow location access “Always” so trips are recorded in the background.")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
            }
        }
    }
}
