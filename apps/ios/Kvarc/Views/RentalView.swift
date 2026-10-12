import SwiftUI

/// Прокат: велосипеды, катамараны, катер, сапы, дайвинг, коньки (список — от владельца).
struct RentalView: View {
    @Environment(AppState.self) private var app
    @State private var categories: [ServiceCategory] = []
    @State private var loaded = false
    @State private var loadError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Прокат")
                if app.isDemo { DemoBanner(text: "Демо-режим: список проката от владельца, цены и свободное время — примеры.") }
                if let loadError {
                    RetryView(message: loadError) { await load() }.frame(height: 260)
                } else if !loaded {
                    LoadingView().frame(height: 200)
                } else if categories.allSatisfy({ $0.services.isEmpty }) {
                    Text("Прокат пока не настроен. Спросите у администратора.").foregroundStyle(Brand.secondaryText)
                } else {
                    ForEach(categories) { c in
                        if categories.count > 1 { SectionLabel(c.name) }
                        ForEach(c.services) { s in
                            NavigationLink {
                                RentalDetailView(service: s)
                            } label: {
                                row(s)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(20)
        }
        .screenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task { if !loaded { await load() } }
        .refreshable { await load() }
    }

    private func row(_ s: Service) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon(for: s.name))
                .font(.title3).foregroundStyle(Brand.graphite)
                .frame(width: 44, height: 44)
                .background(Brand.milky, in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 2) {
                Text(s.name).font(.headline).foregroundStyle(Brand.ink)
                if let d = s.description { Text(d).font(.footnote).foregroundStyle(Brand.secondaryText).lineLimit(2) }
            }
            Spacer()
            Text(s.priceText).font(.footnote.weight(.semibold)).foregroundStyle(s.price > 0 ? Brand.ink : Brand.tertiaryText)
                .multilineTextAlignment(.trailing)
        }
        .card(padding: 14)
    }

    private func icon(for name: String) -> String {
        let n = name.lowercased()
        if n.contains("велосипед") { return "bicycle" }
        if n.contains("катер") || n.contains("лодк") { return "ferry" }
        if n.contains("катамаран") { return "sailboat" }
        if n.contains("сап") { return "figure.surfing" }
        if n.contains("дайв") || n.contains("погруж") { return "water.waves" }
        if n.contains("коньк") { return "figure.skating" }
        return "star"
    }

    private func load() async {
        do {
            categories = try await app.backend.services()
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        loaded = true
    }
}

struct RentalDetailView: View {
    let service: Service
    @Environment(AppState.self) private var app
    @State private var day = Fmt.calendar.startOfDay(for: Date())
    @State private var slots: [ServiceSlot] = []
    @State private var loading = false
    @State private var selected: ServiceSlot?
    @State private var quantity = 1
    @State private var busy = false
    @State private var error: String?
    @State private var idempotencyKey = UUID().uuidString
    @State private var result: ServiceBookingResult?
    @State private var paid = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: service.name, subtitle: service.description)
                if app.isDemo { DemoBanner() }

                VStack(alignment: .leading, spacing: 6) {
                    Text(service.priceText).font(.headline).foregroundStyle(Brand.ink)
                    if service.price == 0 {
                        Text("Цену пока уточняем — администратор сообщит её при подтверждении.").font(.footnote).foregroundStyle(Brand.secondaryText)
                    }
                    if let age = service.minAge { Text("С \(age) лет").font(.footnote).foregroundStyle(Brand.secondaryText) }
                    if let rules = service.rules { Text(rules).font(.footnote).foregroundStyle(Brand.secondaryText) }
                    if let policy = service.cancellationPolicy { Text(policy).font(.footnote).foregroundStyle(Brand.secondaryText) }
                }
                .card()

                if let result {
                    resultCard(result)
                } else if app.booking == nil {
                    Text("Бронировать прокат можно, когда у вас есть бронь проживания.").foregroundStyle(Brand.secondaryText)
                } else {
                    picker
                }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("Прокат")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: day) { await loadSlots() }
        .errorAlert($error)
    }

    @ViewBuilder
    private var picker: some View {
        SectionLabel("Дата")
        DayStrip(days: Fmt.upcomingDays(14), selected: $day)

        SectionLabel(slotsTitle)
        if loading {
            ProgressView().frame(maxWidth: .infinity, minHeight: 80)
        } else if slots.isEmpty {
            Text("На этот день свободного времени нет.").font(.subheadline).foregroundStyle(Brand.secondaryText)
        } else {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(slots, id: \.startsAt) { s in
                    ChipButton(title: Fmt.time(s.startsAt), isSelected: selected == s, isEnabled: s.available > 0) {
                        selected = s
                        quantity = min(quantity, s.available)
                    }
                }
            }
        }

        if service.maxQuantity > 1 {
            HStack {
                Text("Количество").foregroundStyle(Brand.ink)
                Spacer()
                Stepper("\(quantity)", value: $quantity, in: 1...max(1, min(service.maxQuantity, selected?.available ?? service.maxQuantity)))
                    .fixedSize()
                    .foregroundStyle(Brand.ink)
            }
            .card(padding: 14)
        }

        Button {
            Task { await book() }
        } label: {
            if busy { ProgressView().tint(Brand.milky) } else { Text(cta) }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy || selected == nil)

        if service.price > 0 {
            Text("Время закрепляется за вами на 15 минут, пока идёт оплата")
                .font(.footnote).foregroundStyle(Brand.secondaryText)
        }
    }

    private var slotsTitle: String {
        if let d = service.durationMinutes { return "Время начала · \(d) мин" }
        return "Время начала"
    }

    private var cta: String {
        guard let s = selected else { return "Выберите время" }
        if service.price > 0 { return "Забронировать на \(Fmt.time(s.startsAt)) · \(Fmt.money(service.price * quantity))" }
        return "Забронировать на \(Fmt.time(s.startsAt))"
    }

    @ViewBuilder
    private func resultCard(_ r: ServiceBookingResult) -> some View {
        if r.status == "hold" && r.amount > 0 && !paid {
            NavigationLink {
                PaymentView(title: "Оплата проката", purpose: "service_booking", targetId: r.id, amount: r.amount,
                            details: "\(r.service), \(Fmt.dayMonthTime(r.startsAt)), \(r.quantity) шт.") {
                    paid = true
                }
            } label: {
                Text("Перейти к оплате \(Fmt.money(r.amount))")
            }
            .buttonStyle(PrimaryButtonStyle())
            if let until = r.holdExpiresAt {
                Text("Время закреплено до \(Fmt.time(until)). Если не оплатить, бронь снимется сама.")
                    .font(.footnote).foregroundStyle(Brand.secondaryText)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Label(r.status == "pending_confirmation" ? "Заявка отправлена" : "Забронировано", systemImage: "checkmark.circle.fill")
                    .font(.headline).foregroundStyle(Brand.success)
                Text("\(r.service), \(Fmt.dayMonthTime(r.startsAt)), \(r.quantity) шт.").foregroundStyle(Brand.ink)
                if r.status == "pending_confirmation" {
                    Text("Администратор подтвердит бронь и сообщит в приложении.").font(.footnote).foregroundStyle(Brand.secondaryText)
                }
                Button("Забронировать ещё") {
                    result = nil
                    paid = false
                    selected = nil
                    idempotencyKey = UUID().uuidString
                    Task { await loadSlots() }
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .card()
        }
    }

    private func loadSlots() async {
        loading = true
        defer { loading = false }
        selected = nil
        do {
            slots = try await app.backend.serviceSlots(service.id, date: day)
        } catch {
            slots = []
            self.error = error.localizedDescription
        }
    }

    private func book() async {
        guard let s = selected, let bookingId = app.booking?.id else { return }
        busy = true
        defer { busy = false }
        do {
            result = try await app.backend.bookService(service.id, bookingId: bookingId, startsAt: s.startsAt,
                                                       quantity: quantity, idempotencyKey: idempotencyKey)
        } catch {
            self.error = error.localizedDescription
            idempotencyKey = UUID().uuidString
            await loadSlots()
        }
    }
}
