import SwiftUI

struct OnboardingView: View {
    @AppStorage(Prefs.onboarded) private var onboarded = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "globe.europe.africa.fill")
                .font(.system(size: 80))
                .foregroundStyle(Color.accentColor)
            Text("90/180 & 183")
                .font(.largeTitle.bold())
            VStack(alignment: .leading, spacing: 18) {
                point("calendar", "Schengen 90/180", "Non-EU visitors may stay 90 days in any 180. Since the EES started, every entry and exit is recorded automatically.")
                point("airplane", "Your trips", "Add where you have been. We count your days and tell you how long you can stay.")
                point("building.columns", "183 days", "See days per country for tax residency, with reports for your adviser.")
                point("lock.shield", "Private", "No account. Everything stays on your iPhone.")
            }
            .padding(.horizontal, 28)
            Spacer()
            Text("Estimates only, not legal or tax advice.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                onboarded = true
            } label: {
                Text("Get started").frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 28)
            .padding(.bottom, 24)
        }
    }

    private func point(_ icon: String, _ title: LocalizedStringKey, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

struct HelpView: View {
    var body: some View {
        List {
            Section("The 90/180 rule") {
                Text("If you are not an EU/EEA or Swiss citizen and have no residence permit or long-stay visa, you can spend up to 90 days in the Schengen area in any rolling 180-day period. Each day, look back 180 days (including today) and count the days you were in the area: the total must not exceed 90.")
                Text("Entry and exit days count as full days. Days in all 29 Schengen countries are added together. Days in Cyprus, Ireland and non-Schengen countries do not count.")
            }
            Section("EES") {
                Text("The EU Entry/Exit System registers non-EU travellers' entries and exits electronically and calculates the remaining days automatically. An overstay can lead to a fine, an entry ban or refusal of a future visa.")
            }
            Section("183 days") {
                Text("Many countries treat you as a tax resident if you spend more than 183 days there in a tax year. Rules and tax years vary, and other ties (home, family, business) may also matter. Use the report as evidence and confirm with a tax adviser.")
            }
            Section("Automatic tracking") {
                Text("With Pro, the app uses iOS significant location changes (mobile network, low power) to note the country you are in. A stay continues until your iPhone is seen in another country; the travel day counts in both. Check and edit the trips if your phone was off.")
            }
        }
        .navigationTitle("How the rules work")
    }
}
