import SwiftUI

/// Онлайн-регистрация: гости → паспорта → правила → оплата
struct CheckinView: View {
    let bookingId: String
    @Environment(AppState.self) private var app
    @State private var state: CheckinState?
    @State private var loadError: String?
    @State private var error: String?
    @State private var rulesChecked = false
    @State private var busy = false

    var body: some View {
        Group {
            if let state {
                content(state)
            } else if let loadError {
                RetryView(message: loadError) { await load() }
            } else {
                LoadingView()
            }
        }
        .screenBackground()
        .navigationTitle("Регистрация")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .errorAlert($error)
    }

    private func content(_ s: CheckinState) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Онлайн-регистрация",
                            subtitle: "Заполните заранее, и в день заезда код от двери придёт в приложение. На ресепшен заходить не нужно.")
                if app.isDemo { DemoBanner() }

                VStack(spacing: 0) {
                    NavigationLink {
                        GuestsEditView(bookingId: bookingId, state: s) { await load() }
                    } label: {
                        stepRow(1, "Состав гостей", s.guests.isEmpty ? "Укажите всех, кто будет жить" : s.guests.map { "\($0.firstName) \($0.lastName)" }.joined(separator: ", "), done: s.steps.guests)
                    }
                    divider
                    if s.documentsRequired {
                        NavigationLink {
                            PassportView(bookingId: bookingId, guests: s.guests) { await load() }
                        } label: {
                            let filled = s.guests.filter { $0.document != nil }.count
                            stepRow(2, "Паспортные данные", s.guests.isEmpty ? "Сначала укажите гостей" : "Заполнено \(filled) из \(s.guests.count) гостей", done: s.documentsDone)
                        }
                        .disabled(s.guests.isEmpty)
                        divider
                    }
                    rulesRow(s, number: s.documentsRequired ? 3 : 2)
                    divider
                    NavigationLink {
                        PaymentView(title: "Оплата проживания", purpose: "booking", targetId: bookingId, amount: s.balanceDue) {
                            await load()
                        }
                    } label: {
                        stepRow(s.documentsRequired ? 4 : 3, "Оплата проживания", s.steps.payment ? "Оплачено" : "Осталось оплатить \(Fmt.money(s.balanceDue))", done: s.steps.payment)
                    }
                    .disabled(s.steps.payment || s.balanceDue == 0)
                }
                .card(padding: 0)

                unitReadyCard(s)

                if s.doneCount == s.guestSteps.count {
                    Button("Открыть код двери") { app.tab = .access }
                        .buttonStyle(PrimaryButtonStyle())
                } else {
                    Text("Код от двери появится в разделе «Доступ», когда все шаги будут выполнены и дом будет готов.")
                        .font(.footnote).foregroundStyle(Brand.secondaryText)
                }
            }
            .padding(20)
        }
    }

    private var divider: some View {
        Rectangle().fill(Brand.separator).frame(height: 1).padding(.leading, 60)
    }

    private func stepRow(_ n: Int, _ title: String, _ subtitle: String, done: Bool) -> some View {
        HStack(spacing: 14) {
            stepBadge(n, done: done)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline).foregroundStyle(Brand.ink)
                Text(subtitle).font(.footnote).foregroundStyle(done ? Brand.success : Brand.secondaryText).lineLimit(2)
            }
            Spacer()
            if !done { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Brand.tertiaryText) }
        }
        .padding(16)
        .contentShape(Rectangle())
    }

    private func stepBadge(_ n: Int, done: Bool) -> some View {
        ZStack {
            Circle().fill(done ? Brand.graphite : Brand.chipBackground).frame(width: 30, height: 30)
            if done {
                Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(Brand.milky)
            } else {
                Text("\(n)").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            }
        }
        .accessibilityLabel(done ? "Готово" : "Шаг \(n)")
    }

    private func rulesRow(_ s: CheckinState, number: Int) -> some View {
        let done = s.steps.rules && s.steps.consent
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                stepBadge(number, done: done)
                Text("Правила проживания").font(.headline).foregroundStyle(Brand.ink)
                Spacer()
            }
            if done {
                Text("Приняты").font(.footnote).foregroundStyle(Brand.success).padding(.leading, 44)
            } else {
                NavigationLink {
                    LegalDocumentView(code: "rules")
                } label: {
                    Label("Читать правила проживания", systemImage: "doc.text")
                        .font(.footnote.weight(.semibold)).foregroundStyle(Brand.graphite)
                }
                .padding(.leading, 44)
                Toggle(isOn: $rulesChecked) {
                    Text("Я прочитал(а) правила проживания и согласен(на) на обработку персональных данных")
                        .font(.footnote).foregroundStyle(Brand.ink)
                }
                .toggleStyle(CheckboxStyle())
                .padding(.leading, 44)
                Button {
                    Task { await acceptRules(s) }
                } label: {
                    if busy { ProgressView().tint(Brand.milky) } else { Text("Подтвердить") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!rulesChecked || busy)
                .padding(.leading, 44)
            }
        }
        .padding(16)
    }

    @ViewBuilder
    private func unitReadyCard(_ s: CheckinState) -> some View {
        HStack(spacing: 14) {
            Image(systemName: s.steps.unitReady ? "house.fill" : "house")
                .font(.title3).foregroundStyle(Brand.graphite).frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.steps.unitReady ? "Дом готов" : "Дом готовится").font(.headline).foregroundStyle(Brand.ink)
                Text(s.steps.unitReady ? "Можно заселяться" : "Сообщим, когда можно заселяться").font(.footnote).foregroundStyle(Brand.secondaryText)
            }
        }
        .card()
    }

    private func load() async {
        do {
            state = try await app.backend.checkin(bookingId)
            loadError = nil
            await app.reloadBookings()
        } catch {
            if state == nil { loadError = error.localizedDescription } else { self.error = error.localizedDescription }
        }
    }

    private func acceptRules(_ s: CheckinState) async {
        busy = true
        defer { busy = false }
        do {
            try await app.backend.acceptRules(bookingId, rulesVersion: s.rulesVersion)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Квадратная галочка вместо переключателя
struct CheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.title3).foregroundStyle(Brand.graphite)
                configuration.label.multilineTextAlignment(.leading)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}

/// Состав гостей
struct GuestsEditView: View {
    let bookingId: String
    let state: CheckinState
    let onSaved: () async -> Void
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var guests: [GuestInput] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Состав гостей",
                            subtitle: "По брони: взрослых \(state.expectedGuests.adults), детей \(state.expectedGuests.children). Первым укажите того, кто бронировал.")
                ForEach($guests) { $g in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(g.id == guests.first?.id ? "Основной гость" : "Гость").font(.headline).foregroundStyle(Brand.ink)
                            Spacer()
                            if guests.count > 1 {
                                Button(role: .destructive) {
                                    let id = g.id
                                    DispatchQueue.main.async { guests.removeAll { $0.id == id } }
                                } label: { Image(systemName: "trash") }
                                .accessibilityLabel("Удалить гостя")
                            }
                        }
                        LabeledField(title: "Фамилия", text: $g.lastName, contentType: .familyName, autocapitalization: .words)
                        LabeledField(title: "Имя", text: $g.firstName, contentType: .givenName, autocapitalization: .words)
                        LabeledField(title: "Отчество, если есть", text: $g.middleName, contentType: .middleName, autocapitalization: .words)
                        Toggle("Ребёнок до 14 лет", isOn: $g.isChild).tint(Brand.graphite).foregroundStyle(Brand.ink)
                    }
                    .card()
                }
                Button {
                    guests.append(GuestInput())
                } label: {
                    Label("Добавить гостя", systemImage: "plus")
                }
                .buttonStyle(SecondaryButtonStyle())

                Button {
                    Task { await save() }
                } label: {
                    if busy { ProgressView().tint(Brand.milky) } else { Text("Сохранить") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || guests.isEmpty || !guests.allSatisfy(\.isValid))

                if !state.guests.isEmpty {
                    Text("После изменения состава паспортные данные нужно будет проверить заново.")
                        .font(.footnote).foregroundStyle(Brand.secondaryText)
                }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("Гости")
        .navigationBarTitleDisplayMode(.inline)
        .errorAlert($error)
        .onAppear {
            guard guests.isEmpty else { return }
            if state.guests.isEmpty {
                let total = max(1, state.expectedGuests.adults + state.expectedGuests.children)
                guests = (0..<total).map { i in GuestInput(isChild: i >= state.expectedGuests.adults) }
            } else {
                guests = state.guests.map { GuestInput(firstName: $0.firstName, lastName: $0.lastName, middleName: $0.middleName ?? "", isChild: $0.isChild) }
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await app.backend.submitGuests(bookingId, guests: guests)
            await onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
