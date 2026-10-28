import SwiftData
import SwiftUI

/// Шпаргалка по официальной форме: что отметить и что вписать в каждую графу.
struct FormHelperView: View {
    @Environment(\.lang) private var lang
    @Query private var profiles: [Profile]

    let form: FormRef
    let tramite: Tramite

    var body: some View {
        let data = profiles.first?.personal ?? PersonalData()
        List {
            Section {
                Text(S.formIntro[lang]).font(.subheadline)
                if let mark = form.mark {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(S.mark[lang]).font(.caption).foregroundStyle(.secondary)
                        HStack(alignment: .top) {
                            Text(mark[lang]).font(.callout.weight(.semibold)).textSelection(.enabled)
                            Spacer()
                            CopyButton(value: mark[lang])
                        }
                    }
                }
                if let amount = form.amount {
                    InfoRow(symbol: "eurosign", title: S.amount[lang], text: formatEuro(amount, lang: lang))
                }
                if form.kind == .tasa790012 {
                    Text(S.tasaSteps[lang]).font(.subheadline)
                }
                ExternalLinkRow(title: form.kind == .tasa790012 ? S.payTasa[lang] : S.downloadForm[lang], url: form.url)
            }

            ForEach(FormHelper.sections(for: form.kind, data: data)) { section in
                Section(section.title) {
                    ForEach(section.fields) { field in
                        HStack(alignment: .center) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(field.label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                Text(field.isEmpty ? S.emptyValue[lang] : field.value)
                                    .font(.body.monospaced())
                                    .foregroundStyle(field.isEmpty ? .tertiary : .primary)
                                    .textSelection(.enabled)
                                if let hint = field.hint {
                                    Text(hint[lang]).font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            CopyButton(value: field.value)
                        }
                    }
                }
            }

            Section {
                NavigationLink(S.editData[lang]) { PersonalDataView() }
            } footer: {
                Text(S.personalDataHint[lang])
            }
        }
        .navigationTitle(form.kind.code)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Редактор личных данных для форм.
struct PersonalDataView: View {
    @Environment(\.lang) private var lang
    @Query private var profiles: [Profile]
    @State private var data = PersonalData()
    @State private var loaded = false

    var body: some View {
        Form {
            Section(S.identity[lang]) {
                field(S.passport, $data.passport, caps: true)
                VStack(alignment: .leading) {
                    field(LText("NIE"), $data.nie, caps: true)
                    if !data.nie.isEmpty, !NIE.isValid(data.nie) {
                        Text(S.invalidNIE[lang]).font(.caption).foregroundStyle(.red)
                    }
                }
                field(S.givenName, $data.name)
                field(S.surname1, $data.firstSurname)
                field(S.surname2, $data.secondSurname)
                Picker(S.sex[lang], selection: $data.sex) {
                    Text(S.notSet[lang]).tag(PersonalData.Sex?.none)
                    ForEach(PersonalData.Sex.allCases, id: \.self) { Text($0.title[lang]).tag(Optional($0)) }
                }
                Toggle(S.birthDate[lang], isOn: Binding(
                    get: { data.birthDate != nil },
                    set: { data.birthDate = $0 ? (data.birthDate ?? Calendar.current.date(byAdding: .year, value: -30, to: Date())) : nil }
                ))
                if data.birthDate != nil {
                    DatePicker(S.birthDate[lang], selection: Binding(
                        get: { data.birthDate ?? Date() }, set: { data.birthDate = $0 }
                    ), displayedComponents: .date)
                }
                field(S.birthPlace, $data.birthPlace)
                field(S.birthCountry, $data.birthCountry)
                field(S.nationality, $data.nationality)
                Picker(S.maritalStatus[lang], selection: $data.maritalStatus) {
                    Text(S.notSet[lang]).tag(PersonalData.MaritalStatus?.none)
                    ForEach(PersonalData.MaritalStatus.allCases, id: \.self) { Text($0.title[lang]).tag(Optional($0)) }
                }
                field(S.father, $data.fatherName)
                field(S.mother, $data.motherName)
            }
            Section(S.addressInSpain[lang]) {
                field(S.street, $data.street)
                field(S.number, $data.number)
                field(S.floor, $data.floor)
                field(S.city, $data.city)
                field(S.postalCode, $data.postalCode, keyboard: .numberPad)
                field(S.province, $data.province)
            }
            Section {
                field(S.phone, $data.phone, keyboard: .phonePad)
                field(LText("E-mail"), $data.email, keyboard: .emailAddress)
            } header: {
                Text(S.contact[lang])
            } footer: {
                Text(S.personalDataHint[lang])
            }
        }
        .navigationTitle(S.personalData[lang])
        .onAppear {
            guard !loaded, let profile = profiles.first else { return }
            data = profile.personal
            if data.province.isEmpty { data.province = profile.province?.name ?? "" }
            loaded = true
        }
        .onChange(of: data) { _, newValue in
            profiles.first?.personal = newValue
        }
    }

    private func field(_ title: LText, _ text: Binding<String>, caps: Bool = false, keyboard: UIKeyboardType = .default) -> some View {
        let capitalization: TextInputAutocapitalization
        if caps {
            capitalization = .characters
        } else if keyboard == .emailAddress {
            capitalization = .never
        } else {
            capitalization = .words
        }
        return TextField(title[lang], text: text)
            .keyboardType(keyboard)
            .textInputAutocapitalization(capitalization)
            .autocorrectionDisabled()
    }
}
