import SwiftData
import SwiftUI

struct AjustesView: View {
    @AppStorage("lang") private var langRaw = Lang.preferred().rawValue
    @Environment(\.lang) private var lang
    @EnvironmentObject private var access: FullAccess
    @EnvironmentObject private var lock: AppLock
    @Query private var profiles: [Profile]
    @State private var showUnlock = false

    var body: some View {
        Form {
            Section {
                Picker(S.chooseLanguage[lang], selection: $langRaw) {
                    ForEach(Lang.allCases) { Text($0.nativeName).tag($0.rawValue) }
                }
            }

            if let profile = profiles.first {
                SituationSection(profile: profile)
                RuleSection(profile: profile)
            }

            Section {
                NavigationLink(S.personalData[lang]) { PersonalDataView() }
            } footer: {
                Text(S.personalDataHint[lang])
            }

            Section {
                if access.isUnlocked {
                    Label(W.fullActive[lang], systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                } else {
                    Button { showUnlock = true } label: {
                        HStack(spacing: 10) {
                            FlagBadge(size: 24)
                            Text(W.full[lang])
                        }
                    }
                }
                Button(S.restore[lang]) { Task { await access.restore() } }
            }

            Section {
                Toggle(S.faceIDLock[lang], isOn: Binding(get: { lock.isEnabled }, set: { lock.isEnabled = $0; lock.objectWillChange.send() }))
            } header: {
                Text(S.privacy[lang])
            } footer: {
                Text(S.privacyNote[lang])
            }

            Section(S.about[lang]) {
                Text(S.disclaimer[lang]).font(.footnote).foregroundStyle(.secondary)
                LabeledContent(S.developer[lang], value: AppInfo.developer)
                LabeledContent(S.version[lang], value: AppInfo.version)
                ExternalLinkRow(title: "Privacy Policy", url: AppInfo.privacyURL)
                ExternalLinkRow(title: "Terms of Use (EULA)", url: AppInfo.termsURL)
                ExternalLinkRow(title: AppInfo.supportEmail, url: URL(string: "mailto:\(AppInfo.supportEmail)")!)
            }
        }
        .navigationTitle(W.settings[lang])
        .sheet(isPresented: $showUnlock) { UnlockSheet(reason: nil) }
    }
}

struct SituationSection: View {
    @Environment(\.lang) private var lang
    @Bindable var profile: Profile

    var body: some View {
        Section(S.mySituation[lang]) {
            Toggle(S.euCitizen[lang], isOn: $profile.isEUCitizen)
            Picker(S.stage[lang], selection: Binding(get: { profile.stage }, set: { profile.stage = $0 })) {
                ForEach(Stage.allCases) { Text($0.title[lang]).tag($0) }
            }
            Picker(S.province[lang], selection: $profile.provinceCode) {
                ForEach(Province.sortedByName) { Text($0.name).tag($0.code) }
            }
        }
    }
}
