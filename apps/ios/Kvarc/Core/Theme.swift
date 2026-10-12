import SwiftUI

/// Цвета бренда «Кварц» — только из материалов «Русификация» (см. brand/BRAND.md).
enum Brand {
    static let graphite = Color(hex: 0x343C43)
    static let milky = Color(hex: 0xE9E9E6)
    static let ink = Color(hex: 0x36383F)
    static let card = Color.white
    static let secondaryText = Color(hex: 0x5E646A)
    static let tertiaryText = Color(hex: 0x6B6F75)
    static let separator = Color(hex: 0xD6D7D3)
    static let field = Color(hex: 0xCFD1CC)
    static let chipBackground = Color(hex: 0xDCDDD9)
    /// Второстепенный текст на графитовом фоне
    static let onGraphiteSecondary = Color(hex: 0xB9BEC2)
    static let graphiteLine = Color(hex: 0x4E5960)
    /// Приглушённый тёплый цвет для «нужно действие». Всегда вместе с текстом.
    static let attention = Color(hex: 0x8A4B1E)
    static let success = Color(hex: 0x3E6B4F)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// Основная кнопка: графит с молочным текстом (или наоборот на тёмном фоне).
struct PrimaryButtonStyle: ButtonStyle {
    var inverted = false

    func makeBody(configuration: Configuration) -> some View {
        PrimaryButtonBody(configuration: configuration, inverted: inverted)
    }

    private struct PrimaryButtonBody: View {
        let configuration: ButtonStyleConfiguration
        let inverted: Bool
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.headline)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 54)
                .padding(.horizontal, 12)
                .foregroundStyle(inverted ? Brand.graphite : Brand.milky)
                .background(inverted ? Brand.milky : Brand.graphite, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.4)
        }
    }
}

/// Второстепенная кнопка: белая с графитовым текстом.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(Brand.graphite)
            .background(Brand.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Brand.field, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// Белая карточка со скруглением.
struct CardModifier: ViewModifier {
    var padding: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Brand.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardModifier(padding: padding)) }

    /// Фон экрана приложения
    func screenBackground() -> some View {
        background(Brand.milky.ignoresSafeArea())
    }
}

/// Поле ввода в стиле приложения с подписью сверху.
struct LabeledField: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var autocapitalization: TextInputAutocapitalization = .sentences

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.footnote)
                .foregroundStyle(Brand.secondaryText)
            TextField(placeholder, text: $text)
                .keyboardType(keyboard)
                .textContentType(contentType)
                .textInputAutocapitalization(autocapitalization)
                .autocorrectionDisabled()
                .font(.body)
                .foregroundStyle(Brand.ink)
                .padding(.horizontal, 14)
                .frame(minHeight: 48)
                .background(Brand.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Brand.field, lineWidth: 1))
        }
    }
}

/// Плашка «Демо-режим»: показывается всегда, когда приложение не подключено к реальным системам.
struct DemoBanner: View {
    var text = "Демо-режим: данные — примеры, оплата и замки не настоящие."

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle")
                .accessibilityHidden(true)
            Text(text)
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Brand.ink)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0xF3E7C9), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Заголовок-подпись над группой
struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(Brand.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Выбираемая «таблетка» (дата, время, гость)
struct ChipButton: View {
    let title: String
    var subtitle: String? = nil
    let isSelected: Bool
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                if let subtitle {
                    Text(subtitle).font(.footnote)
                }
                Text(title)
                    .font(subtitle == nil ? .callout : .headline)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .strikethrough(!isEnabled)
            }
            .frame(maxWidth: .infinity, minHeight: subtitle == nil ? 44 : 56)
            .padding(.horizontal, 8)
            .foregroundStyle(isSelected ? Brand.milky : (isEnabled ? Brand.ink : Brand.tertiaryText))
            .background(isSelected ? Brand.graphite : (isEnabled ? Brand.card : Color.clear), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isSelected ? Brand.graphite : Brand.field, style: StrokeStyle(lineWidth: 1, dash: isEnabled ? [] : [4]))
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
