import SwiftUI

/// Паспортные данные всех гостей. Хранятся на сервере в зашифрованном виде,
/// после ввода в приложении показываются только последние 4 цифры.
struct PassportView: View {
    let bookingId: String
    let guests: [CheckinGuest]
    let onSaved: () async -> Void
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var docs: [DocumentInput] = []
    @State private var selected = 0
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Паспортные данные",
                            subtitle: "Нужны для регистрации гостей по закону. Данные передаются в зашифрованном виде и удаляются после выезда.")
                if app.isDemo { DemoBanner(text: "Демо-режим: данные никуда не отправляются. Можно ввести пример.") }

                if guests.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(guests.enumerated()), id: \.element.id) { i, g in
                                ChipButton(title: g.firstName, subtitle: docs.indices.contains(i) && docs[i].problem == nil ? "✓" : (g.document?.numberMasked ?? "—"),
                                           isSelected: i == selected) { selected = i }
                                    .frame(minWidth: 110)
                            }
                        }
                    }
                }

                if docs.indices.contains(selected) {
                    form(guest: guests[selected], doc: $docs[selected])
                }

                if let problem = firstProblem {
                    Text(problem).font(.footnote).foregroundStyle(Brand.attention)
                }

                Button {
                    Task { await save() }
                } label: {
                    if busy { ProgressView().tint(Brand.milky) } else { Text(guests.count > 1 ? "Сохранить для всех гостей" : "Сохранить") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || firstProblem != nil)

                Label("Номер паспорта не показывается в приложении и уведомлениях.", systemImage: "lock")
                    .font(.footnote).foregroundStyle(Brand.secondaryText)
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("Паспорта")
        .navigationBarTitleDisplayMode(.inline)
        .errorAlert($error)
        .onAppear {
            guard docs.isEmpty else { return }
            docs = guests.map { g in
                DocumentInput(bookingGuestId: g.id, kind: g.isChild ? .birthCertificate : .ruPassport)
            }
        }
    }

    /// Первая ошибка: «Анна: Серия паспорта: 4 цифры»
    private var firstProblem: String? {
        for (i, d) in docs.enumerated() where needed(i) {
            if let p = d.problem {
                return guests.count > 1 ? "\(guests[i].firstName): \(p)" : p
            }
        }
        return nil
    }

    /// Документ уже сохранён и гость не начал вводить новый — повторно не отправляем.
    private func needed(_ i: Int) -> Bool {
        guests[i].document == nil || !docs[i].number.isEmpty
    }

    private func form(guest: CheckinGuest, doc: Binding<DocumentInput>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(guest.fullName).font(.headline).foregroundStyle(Brand.ink)
            if let existing = guest.document {
                Text("Уже заполнено: \(existing.numberMasked). Чтобы изменить, введите данные заново.")
                    .font(.footnote).foregroundStyle(Brand.secondaryText)
            }
            Picker("Документ", selection: doc.kind) {
                ForEach(DocumentInput.Kind.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.menu)
            .tint(Brand.graphite)

            switch doc.wrappedValue.kind {
            case .ruPassport:
                HStack(spacing: 12) {
                    LabeledField(title: "Серия", text: digits(doc.series, 4), placeholder: "0000", keyboard: .numberPad)
                    LabeledField(title: "Номер", text: digits(doc.number, 6), placeholder: "000000", keyboard: .numberPad)
                }
                LabeledField(title: "Кем выдан", text: doc.issuedBy, placeholder: "ГУ МВД России по Челябинской области")
                issueDatePicker(doc.issueDate)
                LabeledField(title: "Код подразделения", text: divisionCode(doc.divisionCode), placeholder: "740-000", keyboard: .numberPad)
                LabeledField(title: "Место рождения", text: doc.birthPlace, placeholder: "г. Челябинск")
                LabeledField(title: "Адрес регистрации", text: doc.registrationAddress, placeholder: "Город, улица, дом, квартира", contentType: .fullStreetAddress)
            case .foreignPassport:
                LabeledField(title: "Гражданство (код страны)", text: doc.citizenship, placeholder: "KZ", autocapitalization: .characters)
                HStack(spacing: 12) {
                    LabeledField(title: "Серия, если есть", text: doc.series, autocapitalization: .characters)
                    LabeledField(title: "Номер", text: doc.number, autocapitalization: .characters)
                }
                LabeledField(title: "Кем выдан, если указано", text: doc.issuedBy)
            case .birthCertificate:
                HStack(spacing: 12) {
                    LabeledField(title: "Серия", text: doc.series, placeholder: "IV-ИВ", autocapitalization: .characters)
                    LabeledField(title: "Номер", text: digits(doc.number, 6), placeholder: "000000", keyboard: .numberPad)
                }
                issueDatePicker(doc.issueDate, optional: true)
            }
        }
        .card()
    }

    private func issueDatePicker(_ date: Binding<Date?>, optional: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(optional ? "Дата выдачи, если знаете" : "Дата выдачи").font(.footnote).foregroundStyle(Brand.secondaryText)
            if let value = date.wrappedValue {
                DatePicker("", selection: Binding(get: { value }, set: { date.wrappedValue = $0 }), in: ...Date(), displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.locale, Fmt.locale)
                    .environment(\.timeZone, Fmt.timeZone)
            } else {
                Button("Выбрать дату") {
                    date.wrappedValue = Fmt.calendar.date(byAdding: .year, value: -5, to: Date())
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    /// Только цифры, не больше n
    private func digits(_ b: Binding<String>, _ n: Int) -> Binding<String> {
        Binding(get: { b.wrappedValue }, set: { b.wrappedValue = String($0.filter(\.isNumber).prefix(n)) })
    }

    /// Код подразделения: дефис ставим сами
    private func divisionCode(_ b: Binding<String>) -> Binding<String> {
        Binding(get: { b.wrappedValue }, set: { new in
            let d = String(new.filter(\.isNumber).prefix(6))
            b.wrappedValue = d.count > 3 ? "\(d.prefix(3))-\(d.dropFirst(3))" : d
        })
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let toSend = docs.indices.filter(needed).map { docs[$0] }
            if !toSend.isEmpty { try await app.backend.submitDocuments(bookingId, documents: toSend) }
            await onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
