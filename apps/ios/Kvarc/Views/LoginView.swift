import SwiftUI

/// Вход по e-mail и коду из письма
struct LoginView: View {
    @Environment(AppState.self) private var app
    @State private var emailInput = ""
    @State private var email: String?
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var resendAt: Date?
    @FocusState private var codeFocused: Bool

    var body: some View {
        ZStack {
            Brand.graphite.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 12) {
                        Image("LogoWordmarkMilky").resizable().scaledToFit().frame(width: 170)
                            .accessibilityLabel("Кварц")
                        Text("МЕСТО ОТДЫХА · УВИЛЬДЫ")
                            .font(.footnote).tracking(1.5).foregroundStyle(Brand.onGraphiteSecondary)
                    }
                    .padding(.top, 40)
                    .padding(.bottom, 24)

                    if app.isDemo {
                        DemoBanner(text: "Демо-режим: сервер не подключён. Подойдёт любая почта и любой код из 6 цифр.")
                    }

                    if let email {
                        codeStep(email)
                    } else {
                        emailStep
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
        .errorAlert($error)
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Вход").font(.system(size: 30, weight: .semibold)).foregroundStyle(Brand.milky)
            Text("Укажите e-mail из бронирования. Пришлём код в письме, пароль не нужен.")
                .foregroundStyle(Brand.onGraphiteSecondary)
            darkField("E-mail", text: $emailInput, keyboard: .emailAddress, contentType: .emailAddress)
            Button {
                Task { await requestCode() }
            } label: {
                if busy { ProgressView().tint(Brand.graphite) } else { Text("Получить код") }
            }
            .buttonStyle(PrimaryButtonStyle(inverted: true))
            .disabled(busy || Self.normalizeEmail(emailInput) == nil)

            Text("Нажимая «Получить код», вы соглашаетесь с политикой обработки персональных данных")
                .font(.footnote).foregroundStyle(Brand.onGraphiteSecondary)
            if let url = URL(string: "https://xn--80adx0a4a.xn--p1acf") {
                Link(destination: url) {
                    Text("Ещё нет брони? ").foregroundStyle(Brand.onGraphiteSecondary) + Text("Забронировать на сайте").underline().foregroundStyle(Brand.milky)
                }
                .font(.subheadline)
            }
        }
    }

    private func codeStep(_ email: String) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Код из письма").font(.system(size: 30, weight: .semibold)).foregroundStyle(Brand.milky)
            Text("Отправили на \(email). Если письма нет, проверьте папку «Спам».").foregroundStyle(Brand.onGraphiteSecondary)
            darkField("Код", text: $code, keyboard: .numberPad, contentType: .oneTimeCode)
                .focused($codeFocused)
                .onChange(of: code) { _, new in
                    let digits = String(new.filter(\.isNumber).prefix(6))
                    if digits != new { code = digits }
                    if digits.count == 6 && !busy { Task { await verify(email) } }
                }
            Button {
                Task { await verify(email) }
            } label: {
                if busy { ProgressView().tint(Brand.graphite) } else { Text("Войти") }
            }
            .buttonStyle(PrimaryButtonStyle(inverted: true))
            .disabled(busy || code.count != 6)

            HStack {
                Button("Изменить почту") {
                    self.email = nil
                    code = ""
                }
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    let left = Int((resendAt ?? .distantPast).timeIntervalSince(ctx.date).rounded(.up))
                    Button(left > 0 ? "Повторить через \(left) с" : "Отправить ещё раз") {
                        Task { await requestCode() }
                    }
                    .disabled(left > 0 || busy)
                }
            }
            .font(.subheadline)
            .foregroundStyle(Brand.milky)
        }
        .onAppear { codeFocused = true }
    }

    private func darkField(_ title: String, text: Binding<String>, keyboard: UIKeyboardType, contentType: UITextContentType) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.footnote).foregroundStyle(Brand.onGraphiteSecondary)
            TextField("", text: text)
                .keyboardType(keyboard)
                .textContentType(contentType)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.title3)
                .foregroundStyle(Brand.milky)
                .padding(.horizontal, 14)
                .frame(minHeight: 54)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Brand.graphiteLine, lineWidth: 1))
        }
    }

    private func requestCode() async {
        guard let normalized = Self.normalizeEmail(email ?? emailInput) else {
            error = "Проверьте адрес почты"
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await app.backend.requestCode(email: normalized)
            email = normalized
            code = ""
            resendAt = Date().addingTimeInterval(60)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func verify(_ email: String) async {
        guard code.count == 6, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await app.backend.verify(email: email, code: code)
            await app.signedIn()
        } catch {
            code = ""
            self.error = error.localizedDescription
        }
    }

    /// Адрес в нижнем регистре без пробелов или nil, если он явно неверный. Точную проверку делает сервер.
    static func normalizeEmail(_ input: String) -> String? {
        let e = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return e.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil ? e : nil
    }
}
