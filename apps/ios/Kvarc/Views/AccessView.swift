import SwiftUI

/// Код от двери. Код показывается только здесь — не в SMS и не в уведомлениях.
struct AccessView: View {
    @Environment(AppState.self) private var app
    @State private var info: AccessInfo?
    @State private var loadError: String?
    @State private var error: String?
    @State private var showPin = false
    @State private var busy = false
    @State private var confirmCheckout = false
    @State private var problems = ""
    @State private var checkedOut = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Доступ")
                if let b = app.booking {
                    if let info {
                        content(info, booking: b)
                    } else if let loadError {
                        RetryView(message: loadError) { await load() }
                    } else {
                        LoadingView().frame(height: 300)
                    }
                } else {
                    NoBookingView()
                }
            }
            .padding(20)
        }
        .screenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task(id: app.booking) { await load() }
        .refreshable { await load() }
        .errorAlert($error)
        .sheet(isPresented: $confirmCheckout) { checkoutSheet }
    }

    @ViewBuilder
    private func content(_ a: AccessInfo, booking b: Booking) -> some View {
        if a.demo, let notice = a.demoNotice { DemoBanner(text: notice) }

        switch a.status {
        case "active":
            pinCard(a, booking: b)
            if let instructions = a.instructions {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Как открыть").font(.headline).foregroundStyle(Brand.ink)
                    Text(instructions).font(.subheadline).foregroundStyle(Brand.secondaryText)
                    Text("Код не передаётся в SMS и уведомлениях.").font(.footnote).foregroundStyle(Brand.tertiaryText)
                }
                .card()
            }
            CallAdminButton(title: "Не открывается? Позвонить", phone: b.property.phone ?? AppConfig.adminPhone)
            Button("Я выехал") { confirmCheckout = true }
                .buttonStyle(SecondaryButtonStyle())
        case "available_to_request":
            VStack(alignment: .leading, spacing: 12) {
                Text(b.unitTitle).font(.headline).foregroundStyle(Brand.ink)
                Text("Регистрация завершена, дом готов. Получите код от двери.").foregroundStyle(Brand.secondaryText)
                Button {
                    Task { await request() }
                } label: {
                    if busy { ProgressView().tint(Brand.milky) } else { Text("Получить код") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy)
            }
            .card()
        case "processing":
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Создаём код в замке…").font(.headline).foregroundStyle(Brand.ink)
                }
                Text("Обычно это занимает до минуты. Потяните экран вниз, чтобы обновить.").font(.subheadline).foregroundStyle(Brand.secondaryText)
            }
            .card()
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    await load()
                    if info?.status != "processing" { break }
                }
            }
        default:
            blockedCard(a, booking: b)
        }
    }

    private func pinCard(_ a: AccessInfo, booking b: Booking) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(b.unitTitle).font(.headline)
                Spacer()
                Text("Активен").font(.footnote.weight(.semibold)).foregroundStyle(Brand.graphite)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Brand.milky, in: Capsule())
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("КОД ДВЕРИ").font(.footnote).tracking(1.5).foregroundStyle(Brand.onGraphiteSecondary)
                Text(showPin ? spaced(a.pin ?? "") : "••• •••")
                    .font(.system(size: 44, weight: .semibold, design: .monospaced))
                    .accessibilityLabel(showPin ? spokenPin(a.pin ?? "") : "Код скрыт")
                    .privacySensitive()
                Button(showPin ? "Скрыть код" : "Показать код") { showPin.toggle() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Brand.milky)
                    .underline()
            }
            Rectangle().fill(Brand.graphiteLine).frame(height: 1)
            if let from = a.validFrom, let until = a.validUntil {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Действует с \(Fmt.dayMonthTime(from))")
                    Text("До \(Fmt.dayMonthTime(until))")
                }
                .font(.subheadline)
                .foregroundStyle(Brand.onGraphiteSecondary)
            }
        }
        .foregroundStyle(Brand.milky)
        .padding(20)
        .background(Brand.graphite, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func blockedCard(_ a: AccessInfo, booking b: Booking) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "lock").font(.title3).foregroundStyle(Brand.graphite)
                Text(checkedOut || b.isCheckedOut ? "Выезд оформлен" : "Код пока недоступен").font(.headline).foregroundStyle(Brand.ink)
            }
            if a.blockers.isEmpty {
                Text("Код появится здесь, когда дом будет готов.").font(.subheadline).foregroundStyle(Brand.secondaryText)
            }
            ForEach(a.blockers, id: \.code) { blocker in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "circle").font(.caption2).padding(.top, 5).foregroundStyle(Brand.attention)
                    Text(blocker.message).font(.subheadline).foregroundStyle(Brand.ink)
                }
            }
            if a.blockers.contains(where: { $0.code == "registration_incomplete" || $0.code == "payment_required" }) {
                NavigationLink {
                    CheckinView(bookingId: b.id)
                } label: {
                    Text("Перейти к регистрации")
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
        .card()
    }

    private var checkoutSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Подтвердите выезд. После этого код от двери перестанет действовать.")
                    .foregroundStyle(Brand.ink)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Что-то было не так? Напишите, если хотите").font(.footnote).foregroundStyle(Brand.secondaryText)
                    TextField("Например: не работал кондиционер", text: $problems, axis: .vertical)
                        .lineLimit(3...6)
                        .padding(12)
                        .background(Brand.card, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Brand.field))
                }
                Button {
                    Task { await checkout() }
                } label: {
                    if busy { ProgressView().tint(Brand.milky) } else { Text("Подтвердить выезд") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy)
                Spacer()
            }
            .padding(20)
            .screenBackground()
            .navigationTitle("Выезд")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { confirmCheckout = false } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func spokenPin(_ p: String) -> String { p.map { String($0) }.joined(separator: " ") }

    private func spaced(_ pin: String) -> String {
        guard pin.count == 6 else { return pin }
        return "\(pin.prefix(3)) \(pin.suffix(3))"
    }

    private func load() async {
        guard let id = app.booking?.id else { return }
        do {
            info = try await app.backend.access(id)
            loadError = nil
        } catch {
            if info == nil { loadError = error.localizedDescription } else { self.error = error.localizedDescription }
        }
    }

    private func request() async {
        guard let id = app.booking?.id else { return }
        busy = true
        defer { busy = false }
        do {
            info = try await app.backend.requestAccess(id)
            showPin = true
            await app.reloadBookings()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func checkout() async {
        guard let id = app.booking?.id else { return }
        busy = true
        defer { busy = false }
        do {
            try await app.backend.checkout(id, problems: problems)
            confirmCheckout = false
            checkedOut = true
            showPin = false
            await load()
            await app.reloadBookings()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
