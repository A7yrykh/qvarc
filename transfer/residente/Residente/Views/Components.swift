import SwiftUI
import UIKit

extension Color {
    /// Фирменный сине-зелёный из иконки: читается в светлой и тёмной теме.
    static let brand = Color("AccentColor")
    static let brandSoft = Color("AccentColor").opacity(0.12)
    /// Цвета иконки: фон, силуэт полуострова, флаг.
    static let brandDeep = Color(red: 14 / 255, green: 74 / 255, blue: 92 / 255)
    static let brandNight = Color(red: 6 / 255, green: 38 / 255, blue: 56 / 255)
    static let cream = Color(red: 1, green: 246 / 255, blue: 228 / 255)
    static let flagRed = Color(red: 198 / 255, green: 11 / 255, blue: 30 / 255)
    static let flagYellow = Color(red: 1, green: 196 / 255, blue: 0)
}

struct InfoRow: View {
    let symbol: String
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(Color.brand)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Text(text).font(.subheadline)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Ссылка на официальный сайт: открывается в Safari, а не внутри приложения,
/// чтобы пользователь видел настоящий адрес госпортала.
struct ExternalLinkRow: View {
    @Environment(\.openURL) private var openURL
    let title: String
    let url: URL

    var body: some View {
        Button {
            openURL(url)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(.primary)
                    Text(url.host ?? url.absoluteString).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "arrow.up.right.square").foregroundStyle(Color.brand)
            }
        }
    }
}

struct CopyButton: View {
    @Environment(\.lang) private var lang
    let value: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = value
            copied = true
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                copied = false
            }
        } label: {
            Label(copied ? S.copied[lang] : S.copy[lang], systemImage: copied ? "checkmark" : "doc.on.doc")
                .labelStyle(.iconOnly)
                .frame(width: 32, height: 32)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(copied ? S.copied[lang] : S.copy[lang])
        .disabled(value.isEmpty)
    }
}

struct CheckRow: View {
    let isOn: Bool
    let title: String
    var subtitle: String? = nil
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isOn ? Color.green : Color.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .foregroundStyle(.primary)
                        .strikethrough(isOn, color: .secondary)
                    if let subtitle {
                        Text(subtitle).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

/// «через 10 дн.», «сегодня», «3 дн. назад».
func relativeDays(_ date: Date, lang: Lang) -> String {
    let days = Deadlines.daysUntil(date)
    if days == 0 { return S.today[lang] }
    return days > 0 ? S.inDays.format(lang, days) : S.daysAgo.format(lang, -days)
}

func formatDate(_ date: Date, lang: Lang, time: Bool = false) -> String {
    let f = DateFormatter()
    f.locale = lang.locale
    f.dateStyle = .medium
    f.timeStyle = time ? .short : .none
    return f.string(from: date)
}

func formatEuro(_ amount: Decimal, lang: Lang) -> String {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = "EUR"
    f.locale = Locale(identifier: lang == .en ? "en_IE" : (lang == .ru ? "ru_RU" : "es_ES"))
    return f.string(from: amount as NSDecimalNumber) ?? "\(amount) €"
}

/// Цвет срока: красный — меньше 14 дней или прошёл, оранжевый — меньше 60.
func urgencyColor(_ date: Date) -> Color {
    let days = Deadlines.daysUntil(date)
    if days < 14 { return .red }
    if days < 60 { return .orange }
    return .secondary
}

struct ProgressRing: View {
    let value: Double

    var body: some View {
        ZStack {
            Circle().stroke(Color.brandSoft, lineWidth: 4)
            Circle()
                .trim(from: 0, to: value)
                .stroke(Color.brand, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int((value * 100).rounded()))%").font(.system(size: 10, weight: .semibold)).monospacedDigit()
        }
        .frame(width: 38, height: 38)
        .accessibilityElement()
        .accessibilityValue("\(Int((value * 100).rounded())) %")
    }
}
