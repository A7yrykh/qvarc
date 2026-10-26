import SwiftUI
import StoreKit

struct PaywallView: View {
    @EnvironmentObject private var purchases: PurchaseManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    Image(systemName: "airplane.circle.fill")
                        .font(.system(size: 72))
                        .foregroundStyle(Color.accentColor)
                        .padding(.top, 12)
                    Text("90/180 & 183 Pro")
                        .font(.largeTitle.bold())
                    VStack(alignment: .leading, spacing: 14) {
                        feature("location.fill", "Automatic tracking", "Your trips are recorded from the country your iPhone is in. No more typing dates.")
                        feature("building.columns", "183-day tax residency", "Days in every country per year or last 12 months, with a warning before 183.")
                        feature("person.2.fill", "Family and clients", "Separate counts for every traveller.")
                        feature("bell.badge.fill", "Reminders", "Know in advance when you must leave the Schengen area.")
                        feature("doc.richtext", "PDF and CSV reports", "Proof of your stays for a tax adviser, consulate or immigration lawyer.")
                    }
                    .padding(.horizontal)

                    if purchases.isPro {
                        Label("Pro is active", systemImage: "checkmark.seal.fill")
                            .font(.headline)
                            .foregroundStyle(.green)
                    } else if let product = purchases.product {
                        VStack(spacing: 8) {
                            Button {
                                Task {
                                    await purchases.purchase()
                                    if purchases.isPro { dismiss() }
                                }
                            } label: {
                                VStack(spacing: 2) {
                                    if purchases.isEligibleForTrial {
                                        Text("Try free for 1 week")
                                            .font(.headline)
                                        Text("then \(product.displayPrice) per year")
                                            .font(.subheadline)
                                    } else {
                                        Text("Subscribe for \(product.displayPrice) per year")
                                            .font(.headline)
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(purchases.isPurchasing)

                            Text("\(product.displayPrice) per year, renews automatically. Cancel anytime in Settings › Apple ID › Subscriptions at least 24 hours before the end of the period.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.horizontal)
                    } else {
                        ProgressView()
                            .task { await purchases.load() }
                    }

                    Button("Restore purchases") {
                        Task { await purchases.restore() }
                    }
                    .font(.subheadline)

                    HStack(spacing: 18) {
                        Link("Terms of use", destination: AppInfo.termsURL)
                        Link("Privacy policy", destination: AppInfo.privacyURL)
                    }
                    .font(.caption)
                    .padding(.bottom)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Close")
                }
            }
            .alert("Purchase", isPresented: Binding(get: { purchases.message != nil },
                                                    set: { if !$0 { purchases.message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(purchases.message ?? "")
            }
        }
    }

    private func feature(_ icon: String, _ title: LocalizedStringKey, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}
