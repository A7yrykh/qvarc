import SwiftUI

/// Меню ресторана с добавлением в корзину. Над меню — активные заказы гостя.
struct FoodMenuSection: View {
    let restaurant: Restaurant
    @Environment(AppState.self) private var app
    @State private var menu: RestaurantMenu?
    @State private var orders: [FoodOrder] = []
    @State private var loadError: String?
    @State private var category: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(orders.filter(\.isActive)) { o in
                NavigationLink {
                    FoodOrderView(orderId: o.id)
                } label: {
                    activeOrderRow(o)
                }
                .buttonStyle(.plain)
            }

            if let menu {
                if !menu.isOpenNow {
                    Label("Ресторан сейчас не принимает заказы. Меню можно посмотреть.", systemImage: "clock")
                        .font(.footnote).foregroundStyle(Brand.attention)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(menu.categories) { c in
                            ChipButton(title: c.name, isSelected: (category ?? menu.categories.first?.id) == c.id) { category = c.id }
                                .fixedSize()
                        }
                    }
                }
                if let c = menu.categories.first(where: { $0.id == (category ?? menu.categories.first?.id) }) {
                    VStack(spacing: 0) {
                        ForEach(Array(c.items.enumerated()), id: \.element.id) { i, item in
                            if i > 0 { Rectangle().fill(Brand.separator).frame(height: 1) }
                            DishRow(item: item, canOrder: menu.isOpenNow)
                        }
                    }
                    .card(padding: 0)
                }
                Text("Если у вас аллергия или непереносимость продуктов, напишите об этом в комментарии к заказу.")
                    .font(.footnote).foregroundStyle(Brand.secondaryText)
            } else if let loadError {
                RetryView(message: loadError) { await load() }.frame(height: 240)
            } else {
                LoadingView().frame(height: 200)
            }
        }
        .task { await load() }
    }

    private func activeOrderRow(_ o: FoodOrder) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "takeoutbag.and.cup.and.straw").font(.title3).foregroundStyle(Brand.milky)
            VStack(alignment: .leading, spacing: 2) {
                Text("Заказ \(o.number)").font(.headline)
                Text(o.statusLabel).font(.subheadline).foregroundStyle(Brand.onGraphiteSecondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Brand.onGraphiteSecondary)
        }
        .foregroundStyle(Brand.milky)
        .padding(16)
        .background(Brand.graphite, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func load() async {
        do {
            menu = try await app.backend.menu(restaurant.id)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        // Заказы видны только после входа; ошибка здесь не мешает меню
        orders = (try? await app.backend.myFoodOrders()) ?? []
    }
}

/// Строка блюда: название, порция, цена и кнопки «−/+»
struct DishRow: View {
    let item: MenuItem
    let canOrder: Bool
    @Environment(AppState.self) private var app

    var body: some View {
        let qty = app.cart.quantity(of: item)
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.name).font(.body).foregroundStyle(item.isAvailable ? Brand.ink : Brand.tertiaryText)
                HStack(spacing: 6) {
                    Text(Fmt.money(item.price)).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                    if let p = item.portion { Text("· \(p)").font(.subheadline).foregroundStyle(Brand.secondaryText) }
                }
                if let d = item.description { Text(d).font(.footnote).foregroundStyle(Brand.secondaryText) }
                if !item.isAvailable { Text("Сейчас нет").font(.footnote).foregroundStyle(Brand.attention) }
            }
            Spacer(minLength: 8)
            if item.isAvailable && canOrder {
                if qty == 0 {
                    Button { app.cart.add(item) } label: {
                        Image(systemName: "plus").font(.headline)
                            .frame(width: 40, height: 40)
                            .foregroundStyle(Brand.milky)
                            .background(Brand.graphite, in: Circle())
                    }
                    .accessibilityLabel("Добавить \(item.name)")
                } else {
                    QuantityControl(quantity: qty, name: item.name, minus: { app.cart.remove(item) }, plus: { app.cart.add(item) })
                }
            }
        }
        .padding(14)
    }
}

struct QuantityControl: View {
    let quantity: Int
    let name: String
    let minus: () -> Void
    let plus: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: minus) { Image(systemName: "minus").frame(width: 36, height: 36) }
                .accessibilityLabel("Убрать одну порцию: \(name)")
            Text("\(quantity)").font(.headline).frame(minWidth: 24)
                .accessibilityLabel("\(quantity) шт.")
            Button(action: plus) { Image(systemName: "plus").frame(width: 36, height: 36) }
                .accessibilityLabel("Добавить ещё: \(name)")
        }
        .foregroundStyle(Brand.graphite)
        .background(Brand.chipBackground, in: Capsule())
    }
}

/// Плашка корзины внизу экрана меню
struct CartBar: View {
    let restaurant: Restaurant
    @Environment(AppState.self) private var app

    var body: some View {
        NavigationLink {
            CartView(restaurant: restaurant)
        } label: {
            HStack {
                Image(systemName: "bag")
                Text("Корзина · \(app.cart.count)")
                Spacer()
                Text(Fmt.money(app.cart.total))
            }
            .padding(.horizontal, 6)
        }
        .buttonStyle(PrimaryButtonStyle())
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(Brand.milky.opacity(0.95))
    }
}

/// Оформление заказа
struct CartView: View {
    let restaurant: Restaurant
    @Environment(AppState.self) private var app
    @State private var delivery = true
    @State private var payOnline = true
    @State private var comment = ""
    @State private var idempotencyKey = UUID().uuidString
    @State private var busy = false
    @State private var error: String?
    @State private var created: FoodOrder?
    @State private var lastOrder: FoodOrder?

    /// Доставка возможна, если ресторан доставляет, у брони есть дом и гость сейчас живёт на базе
    private var deliveryUnit: String? {
        guard restaurant.acceptsDelivery, let b = app.booking, let unit = b.unit, !b.isCheckedOut else { return nil }
        // В демо заезд ещё не наступил, но доставку показываем, чтобы было видно весь сценарий
        if app.isDemo { return unit.code }
        let now = Date()
        guard b.arrivalAt.addingTimeInterval(-3600) <= now, now < b.departureAt else { return nil }
        return unit.code
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "Ваш заказ")
                if app.isDemo { DemoBanner(text: "Демо-режим: заказ не уйдёт на кухню, оплата не настоящая.") }

                if app.cart.isEmpty {
                    if let o = lastOrder {
                        Text("Заказ \(o.number) оформлен.").foregroundStyle(Brand.ink)
                        Button("Открыть заказ") { created = o }
                            .buttonStyle(PrimaryButtonStyle())
                    } else {
                        Text("Корзина пуста.").foregroundStyle(Brand.secondaryText)
                    }
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(app.cart.lines.enumerated()), id: \.element.id) { i, line in
                            if i > 0 { Rectangle().fill(Brand.separator).frame(height: 1) }
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(line.item.name).foregroundStyle(Brand.ink)
                                    Text(Fmt.money(line.item.price * line.quantity)).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                                }
                                Spacer()
                                QuantityControl(quantity: line.quantity, name: line.item.name,
                                                minus: { app.cart.remove(line.item) }, plus: { app.cart.add(line.item) })
                            }
                            .padding(14)
                        }
                    }
                    .card(padding: 0)

                    SectionLabel("Как получить")
                    VStack(spacing: 8) {
                        if let unit = deliveryUnit {
                            ChipButton(title: "Доставить в дом · \(unit)", isSelected: delivery) { delivery = true }
                        }
                        ChipButton(title: "Заберу в ресторане", isSelected: !delivery || deliveryUnit == nil) { delivery = false }
                    }
                    if deliveryUnit == nil {
                        Text("Доставка в дом работает во время проживания.").font(.footnote).foregroundStyle(Brand.secondaryText)
                    }

                    SectionLabel("Оплата")
                    VStack(spacing: 8) {
                        ChipButton(title: "Картой сейчас", isSelected: payOnline) { payOnline = true }
                        ChipButton(title: "При получении", isSelected: !payOnline) { payOnline = false }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Комментарий: аллергия, приборы, пожелания").font(.footnote).foregroundStyle(Brand.secondaryText)
                        TextField("Например: без лука, 2 комплекта приборов", text: $comment, axis: .vertical)
                            .lineLimit(2...5)
                            .padding(12)
                            .background(Brand.card, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Brand.field))
                    }

                    HStack {
                        Text("Итого").font(.headline).foregroundStyle(Brand.ink)
                        Spacer()
                        Text(Fmt.money(app.cart.total)).font(.title3.weight(.semibold)).foregroundStyle(Brand.ink)
                    }
                    .card()

                    Button {
                        Task { await submit() }
                    } label: {
                        if busy { ProgressView().tint(Brand.milky) }
                        else { Text(payOnline ? "Перейти к оплате" : "Оформить заказ") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy)
                }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("Корзина")
        .navigationBarTitleDisplayMode(.inline)
        .errorAlert($error)
        .navigationDestination(item: $created) { order in
            // Экран заказа сам предложит оплату, если выбрана оплата картой
            FoodOrderView(orderId: order.id)
        }
    }

    private var trimmedComment: String { comment.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func submit() async {
        busy = true
        defer { busy = false }
        let useDelivery = delivery && deliveryUnit != nil
        do {
            let order = try await app.backend.createFoodOrder(
                restaurantId: restaurant.id, bookingId: app.booking?.id,
                fulfillment: useDelivery ? "delivery" : "pickup", paymentMethod: payOnline ? "online" : "on_delivery",
                items: app.cart.orderItems, comment: trimmedComment.isEmpty ? nil : trimmedComment, idempotencyKey: idempotencyKey)
            app.cart.clear()
            comment = ""
            idempotencyKey = UUID().uuidString
            lastOrder = order
            created = order
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Статус заказа: обновляется сам, пока заказ активен
struct FoodOrderView: View {
    let orderId: String
    @Environment(AppState.self) private var app
    @State private var order: FoodOrder?
    @State private var loadError: String?
    @State private var error: String?
    @State private var busy = false
    @State private var confirmCancel = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let o = order {
                    content(o)
                } else if let loadError {
                    RetryView(message: loadError) { await load() }.frame(height: 260)
                } else {
                    LoadingView().frame(height: 260)
                }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("Заказ")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .errorAlert($error)
        .task {
            await load()
            while !Task.isCancelled, order?.isActive ?? true {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                await load()
            }
        }
        .confirmationDialog("Отменить заказ?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Отменить заказ", role: .destructive) { Task { await cancel() } }
            Button("Не отменять", role: .cancel) {}
        } message: {
            Text("Если вы уже оплатили, деньги вернутся на карту.")
        }
    }

    @ViewBuilder
    private func content(_ o: FoodOrder) -> some View {
        if app.isDemo { DemoBanner(text: "Демо-режим: заказ не ушёл на кухню, статусы меняются сами для примера.") }

        VStack(alignment: .leading, spacing: 8) {
            Text("ЗАКАЗ № \(o.number)").font(.footnote).tracking(1).foregroundStyle(Brand.onGraphiteSecondary)
            Text(o.statusLabel).font(.title2.weight(.semibold))
            Text(fulfillmentText(o))
                .font(.subheadline).foregroundStyle(Brand.onGraphiteSecondary)
            if o.status != "cancelled" {
                progress(o)
            }
        }
        .foregroundStyle(Brand.milky)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.graphite, in: RoundedRectangle(cornerRadius: 22, style: .continuous))

        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(o.items.enumerated()), id: \.offset) { _, line in
                HStack(alignment: .top) {
                    Text("\(line.quantity) × \(line.name)").foregroundStyle(Brand.ink)
                    Spacer()
                    Text(Fmt.money(line.lineTotal)).foregroundStyle(Brand.ink)
                }
                .font(.subheadline)
            }
            Rectangle().fill(Brand.separator).frame(height: 1)
            HStack {
                Text("Итого").font(.headline)
                Spacer()
                Text(Fmt.money(o.total)).font(.headline)
            }
            .foregroundStyle(Brand.ink)
            Text(paymentText(o)).font(.footnote).foregroundStyle(Brand.secondaryText)
            if let c = o.comment, !c.isEmpty { Text("Комментарий: \(c)").font(.footnote).foregroundStyle(Brand.secondaryText) }
        }
        .card()

        if o.needsPayment {
            NavigationLink {
                PaymentView(title: "Оплата заказа", purpose: "food_order", targetId: o.id, amount: o.total, details: "Заказ \(o.number)") {
                    await load()
                }
            } label: {
                Text("Оплатить \(Fmt.money(o.total))")
            }
            .buttonStyle(PrimaryButtonStyle())
            Text("Кухня начнёт готовить после оплаты.").font(.footnote).foregroundStyle(Brand.secondaryText)
        }
        if o.canCancel {
            Button("Отменить заказ") { confirmCancel = true }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy)
        }
        CallAdminButton(title: "Позвонить в ресторан", phone: AppConfig.restaurantPhone)
    }

    private func progress(_ o: FoodOrder) -> some View {
        let flow = o.fulfillment == "delivery"
            ? ["new", "accepted", "cooking", "ready", "delivering", "delivered"]
            : ["new", "accepted", "cooking", "ready", "handed_over"]
        let current = flow.firstIndex(of: o.status) ?? 0
        let paidOrOffline = !o.needsPayment
        return HStack(spacing: 6) {
            ForEach(flow.indices, id: \.self) { i in
                Capsule().fill(paidOrOffline && i <= current ? Brand.milky : Color(hex: 0x5A646C)).frame(height: 4)
            }
        }
        .accessibilityHidden(true)
    }

    private func fulfillmentText(_ o: FoodOrder) -> String {
        guard o.fulfillment == "delivery" else { return "Заберёте в ресторане" }
        return "Доставка в дом" + (o.unitCode.map { " · " + $0 } ?? "")
    }

    private func paymentText(_ o: FoodOrder) -> String {
        switch (o.paymentMethod, o.paymentStatus) {
        case ("on_delivery", _): return "Оплата при получении"
        case (_, "paid"): return "Оплачено картой"
        case (_, "refunded"): return "Деньги возвращены"
        case (_, "partially_refunded"): return "Часть денег возвращена"
        case (_, "pending"): return "Ждём подтверждения оплаты от банка"
        default: return "Не оплачено"
        }
    }

    private func load() async {
        do {
            order = try await app.backend.foodOrder(orderId)
            loadError = nil
        } catch {
            if order == nil { loadError = error.localizedDescription }
        }
    }

    private func cancel() async {
        busy = true
        defer { busy = false }
        do {
            order = try await app.backend.cancelFoodOrder(orderId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
