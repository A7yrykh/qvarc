import SwiftData
import SwiftUI

/// Первый запуск: одна прокручиваемая анкета вместо пошагового онбординга.
struct SetupView: View {
    @AppStorage("lang") private var langRaw = Lang.preferred().rawValue
    @Environment(\.modelContext) private var context
    @Environment(\.lang) private var lang

    @State private var isEU: Bool?
    @State private var stage: Stage?
    @State private var provinceCode = "28"
    @State private var hasResidence = true
    @State private var residenceStart = Calendar.current.date(byAdding: .year, value: -1, to: Date()) ?? Date()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    Image("SetupMark")
                        .resizable()
                        .frame(width: 72, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    Text(W.setupTitle[lang])
                        .font(.system(.largeTitle, design: .serif, weight: .bold))
                        .foregroundStyle(Color.cream)
                    Text(W.setupHint[lang]).foregroundStyle(Color.cream.opacity(0.85))
                    HStack(spacing: 8) {
                        ForEach(Lang.allCases) { l in
                            Button(l.rawValue.uppercased()) { langRaw = l.rawValue }
                                .font(.footnote.weight(.bold))
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .foregroundStyle(langRaw == l.rawValue ? Color.brandNight : Color.cream)
                                .background(langRaw == l.rawValue ? Color.flagYellow : Color.white.opacity(0.12), in: Capsule())
                        }
                    }
                    .padding(.top, 4)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [.brandDeep, .brandNight], startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 26, style: .continuous))

                question(S.citizenshipQuestion[lang]) {
                    HStack(spacing: 10) {
                        chip(S.yes[lang], selected: isEU == true) { isEU = true }
                        chip(S.no[lang], selected: isEU == false) { isEU = false }
                    }
                }

                question(S.stageQuestion[lang]) {
                    VStack(spacing: 8) {
                        ForEach(Stage.allCases.filter { isEU != true || $0 != .renewing }) { s in
                            chip(s.title[lang], selected: stage == s, wide: true) { stage = s }
                        }
                    }
                }

                question(W.residenceStartQuestion[lang]) {
                    VStack(alignment: .leading, spacing: 8) {
                        if hasResidence {
                            DatePicker(W.residenceSince[lang], selection: $residenceStart, in: ...Date(), displayedComponents: .date)
                        }
                        Toggle(W.notYet[lang], isOn: Binding(get: { !hasResidence }, set: { hasResidence = !$0 }))
                    }
                }

                question(S.provinceQuestion[lang]) {
                    Picker(S.province[lang], selection: $provinceCode) {
                        ForEach(Province.sortedByName) { Text($0.name).tag($0.code) }
                    }
                    .pickerStyle(.menu)
                }

                Text(S.disclaimer[lang]).font(.caption).foregroundStyle(.secondary)

                Button(action: finish) {
                    Text(W.start[lang]).font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.brandDeep)
                .controlSize(.large)
                .disabled(isEU == nil || stage == nil)
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
    }

    private func finish() {
        guard let isEU, let stage else { return }
        let profile = Profile(isEUCitizen: isEU, stage: stage, provinceCode: provinceCode)
        if hasResidence {
            profile.residenceStart = Day(residenceStart)
            profile.absenceRule = profile.suggestedAbsenceRule
        }
        context.insert(profile)
        try? context.save()
    }

    private func question<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func chip(_ title: String, selected: Bool, wide: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).multilineTextAlignment(.leading)
                if wide { Spacer() }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(maxWidth: wide ? .infinity : nil, alignment: .leading)
            .foregroundStyle(selected ? Color.cream : Color.primary)
            .background(selected ? Color.brandDeep : Color(.tertiarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
