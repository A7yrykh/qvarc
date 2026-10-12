import SwiftUI

/// Оплата: проживание или прокат. Один ключ идемпотентности на экран —
/// повторное нажатие не создаст второй платёж.
struct PaymentView: View {
    let title: String
    /// "booking" или "service_booking"
    let purpose: String
    let targetId: String
    let amount: Int
    var details: String? = nil
    let onPaid: () async -> Void

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var idempotencyKey = UUID().uuidString
    @State private var payment: PaymentInfo?
    @State private var safariPage: WebPage?
    @State private var busy = false
    @State private var checking = false
    @State private var showDemoConfirm = false
    @State private var error: String?
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: title)
                if app.isDemo || payment?.demo == true {
                    DemoBanner(text: "Демо-оплата: деньги не списываются, банк не подключён.")
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("К оплате").font(.footnote).foregroundStyle(Brand.secondaryText)
                    Text(Fmt.money(amount)).font(.system(size: 34, weight: .semibold)).foregroundStyle(Brand.ink)
                    if let details { Text(details).font(.subheadline).foregroundStyle(Brand.secondaryText) }
                }
                .card()

                if payment?.isPaid == true {
                    paidCard
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Оплата картой через Сбербанк", systemImage: "creditcard")
                            .font(.subheadline.weight(.medium)).foregroundStyle(Brand.ink)
                        Text("Откроется защищённая страница банка. Данные карты приложение не видит и не хранит. Чек придёт на телефон или почту.")
                            .font(.footnote).foregroundStyle(Brand.secondaryText)
                    }
                    .card()

                    if failed {
                        Text("Оплата не прошла. Деньги не списаны — попробуйте ещё раз или другой картой.")
                            .font(.footnote).foregroundStyle(Brand.attention)
                    }

                    Button {
                        Task { await pay() }
                    } label: {
                        if busy || checking {
                            HStack(spacing: 8) {
                                ProgressView().tint(Brand.milky)
                                Text(checking ? "Проверяем оплату…" : "Создаём платёж…")
                            }
                        } else {
                            Text("Оплатить \(Fmt.money(amount))")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || checking || amount <= 0)

                    if payment != nil && !checking {
                        Button("Я оплатил(а), проверить") { Task { await poll() } }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("Оплата")
        .navigationBarTitleDisplayMode(.inline)
        .errorAlert($error)
        .sheet(item: $safariPage, onDismiss: { Task { await poll() } }) { page in
            SafariView(url: page.url).ignoresSafeArea()
        }
        .confirmationDialog("Демо-оплата", isPresented: $showDemoConfirm, titleVisibility: .visible) {
            Button("Имитировать успешную оплату") { Task { await confirmDemo() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Это демо-режим: настоящий банк не подключён, деньги не списываются.")
        }
        .onChange(of: app.paymentReturnTick) { _, _ in
            // Банк вернул гостя по ссылке qvarc://payment-return
            safariPage = nil
        }
    }

    private var paidCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Оплачено", systemImage: "checkmark.circle.fill")
                .font(.title3.weight(.semibold)).foregroundStyle(Brand.success)
            Text("Спасибо! Чек придёт от банка.").foregroundStyle(Brand.ink)
            Button("Готово") { dismiss() }
                .buttonStyle(PrimaryButtonStyle())
        }
        .card()
    }

    private func pay() async {
        busy = true
        defer { busy = false }
        failed = false
        do {
            let p = try await app.backend.createPayment(purpose: purpose, targetId: targetId, idempotencyKey: idempotencyKey)
            payment = p
            if p.isPaid { await onPaid(); return }
            if let s = p.confirmationUrl, let url = URL(string: s) {
                safariPage = WebPage(url: url)
            } else if app.isDemo {
                showDemoConfirm = true
            } else {
                error = "Банк не вернул страницу оплаты. Попробуйте ещё раз или позвоните администратору."
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func confirmDemo() async {
        guard let p = payment else { return }
        do {
            try await app.backend.confirmDemoPayment(p.id)
            await poll()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Банк сообщает серверу об оплате сам; приложение несколько раз спрашивает статус.
    private func poll() async {
        guard let id = payment?.id, !checking else { return }
        checking = true
        defer { checking = false }
        for attempt in 0..<8 {
            if attempt > 0 { try? await Task.sleep(nanoseconds: 2_000_000_000) }
            guard let p = try? await app.backend.payment(id) else { continue }
            payment = p
            if p.isPaid {
                await onPaid()
                return
            }
            if p.isFinalFailure {
                failed = true
                // Новый платёж — новый ключ, иначе сервер вернёт старый отменённый
                idempotencyKey = UUID().uuidString
                payment = nil
                return
            }
        }
    }
}

/// Страница для показа в листе
struct WebPage: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
