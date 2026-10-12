import SwiftUI

/// Ресторан: меню с заказом (в дом или с собой) и бронь столика.
struct RestaurantView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case menu = "Меню и заказ"
        case table = "Столик"
        var id: String { rawValue }
    }

    @Environment(AppState.self) private var app
    @State private var mode: Mode = .menu
    @State private var restaurant: Restaurant?
    @State private var loadError: String?
    @State private var day = Fmt.calendar.startOfDay(for: Date())
    @State private var partySize = 2
    @State private var slots: [TableSlot] = []
    @State private var slotsLoading = false
    @State private var selected: Date?
    @State private var busy = false
    @State private var error: String?
    @State private var reservation: TableReservation?
    @State private var idempotencyKey = UUID().uuidString

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Ресторан", subtitle: restaurant?.description)
                if app.isDemo { DemoBanner() }
                Picker("Раздел", selection: $mode) {
                    ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)

                switch mode {
                case .menu:
                    if let restaurant {
                        FoodMenuSection(restaurant: restaurant)
                    } else if let loadError {
                        RetryView(message: loadError) { await loadRestaurant() }.frame(height: 260)
                    } else {
                        LoadingView().frame(height: 200)
                    }
                case .table: tableSection
                }
            }
            .padding(20)
        }
        .screenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom) {
            if mode == .menu, let restaurant, !app.cart.isEmpty {
                CartBar(restaurant: restaurant)
            }
        }
        .task { await loadRestaurant() }
        .task(id: SlotQuery(restaurantId: restaurant?.id, day: day, partySize: partySize, mode: mode)) { await loadSlots() }
        .errorAlert($error)
        .alert("Столик забронирован", isPresented: Binding(get: { reservation != nil }, set: { if !$0 { reservation = nil } })) {
            Button("Хорошо", role: .cancel) {}
        } message: {
            if let r = reservation {
                Text("\(Fmt.dayMonthTime(r.startsAt)), гостей: \(r.partySize). Номер брони \(r.number).")
            }
        }
    }

    private struct SlotQuery: Equatable {
        let restaurantId: String?
        let day: Date
        let partySize: Int
        let mode: Mode
    }

    @ViewBuilder
    private var tableSection: some View {
        if let loadError {
            RetryView(message: loadError) { await loadRestaurant() }.frame(height: 260)
        } else if restaurant == nil {
            LoadingView().frame(height: 200)
        } else {
            SectionLabel("Дата")
            DayStrip(days: Fmt.upcomingDays(14), selected: $day)

            HStack {
                Text("Гостей").foregroundStyle(Brand.ink)
                Spacer()
                Stepper("\(partySize)", value: $partySize, in: 1...20)
                    .fixedSize()
                    .foregroundStyle(Brand.ink)
            }
            .card(padding: 14)

            SectionLabel("Время")
            if slotsLoading {
                ProgressView().frame(maxWidth: .infinity, minHeight: 80)
            } else if slots.isEmpty {
                Text("На этот день свободного времени нет. Выберите другой день или позвоните.")
                    .font(.subheadline).foregroundStyle(Brand.secondaryText)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(slots, id: \.startsAt) { s in
                        ChipButton(title: Fmt.time(s.startsAt), isSelected: selected == s.startsAt, isEnabled: s.available) {
                            selected = s.startsAt
                        }
                    }
                }
            }

            Button {
                Task { await reserve() }
            } label: {
                if busy { ProgressView().tint(Brand.milky) }
                else if let selected { Text("Забронировать на \(Fmt.time(selected))") }
                else { Text("Выберите время") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || selected == nil)

            if let r = restaurant, let phone = r.phone {
                CallAdminButton(title: "Позвонить в ресторан", phone: phone)
            }
        }
    }

    private func loadRestaurant() async {
        do {
            restaurant = try await app.backend.restaurants().first
            loadError = restaurant == nil ? "Ресторан пока не настроен." : nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func loadSlots() async {
        guard mode == .table, let id = restaurant?.id else { return }
        slotsLoading = true
        defer { slotsLoading = false }
        selected = nil
        do {
            slots = try await app.backend.tableSlots(id, date: day, partySize: partySize)
        } catch {
            slots = []
            self.error = error.localizedDescription
        }
    }

    private func reserve() async {
        guard let id = restaurant?.id, let selected else { return }
        busy = true
        defer { busy = false }
        do {
            reservation = try await app.backend.reserveTable(id, startsAt: selected, partySize: partySize,
                                                             bookingId: app.booking?.id, idempotencyKey: idempotencyKey)
            idempotencyKey = UUID().uuidString
            await loadSlots()
        } catch {
            self.error = error.localizedDescription
            await loadSlots()
        }
    }
}
