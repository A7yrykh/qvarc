import SafariServices
import SwiftUI

extension View {
    /// Показ ошибки сервера простым окном
    func errorAlert(_ message: Binding<String?>) -> some View {
        alert("Не получилось", isPresented: Binding(get: { message.wrappedValue != nil }, set: { if !$0 { message.wrappedValue = nil } })) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}

/// Страница банка внутри приложения
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Brand.graphite)
        vc.dismissButtonStyle = .close
        return vc
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

struct LoadingView: View {
    var text = "Загружаем…"
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(text).font(.subheadline).foregroundStyle(Brand.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Сообщение об ошибке загрузки с кнопкой «Повторить»
struct RetryView: View {
    let message: String
    let retry: () async -> Void
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(Brand.secondaryText)
            Text(message).multilineTextAlignment(.center).foregroundStyle(Brand.ink)
            Button("Повторить") { Task { await retry() } }
                .buttonStyle(SecondaryButtonStyle())
                .frame(maxWidth: 220)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Заголовок экрана в стиле макета (крупный, слева)
struct ScreenTitle: View {
    let title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 28, weight: .semibold)).foregroundStyle(Brand.ink)
            if let subtitle {
                Text(subtitle).font(.subheadline).foregroundStyle(Brand.secondaryText).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Кнопка звонка администратору
struct CallAdminButton: View {
    var title = "Позвонить администратору"
    var phone = AppConfig.adminPhone
    var body: some View {
        if let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
            Link(destination: url) {
                Label(title, systemImage: "phone")
            }
            .buttonStyle(SecondaryButtonStyle())
        }
    }
}

enum Words {
    /// «1 день», «2 дня», «5 дней»
    static func days(_ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        if m10 == 1 && m100 != 11 { return "\(n) день" }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return "\(n) дня" }
        return "\(n) дней"
    }

    static func greeting(_ now: Date = Date()) -> String {
        switch Fmt.calendar.component(.hour, from: now) {
        case 5..<12: return "Доброе утро"
        case 12..<18: return "Добрый день"
        case 18..<23: return "Добрый вечер"
        default: return "Доброй ночи"
        }
    }
}

/// Выбор даты — горизонтальная лента ближайших дней
struct DayStrip: View {
    let days: [Date]
    @Binding var selected: Date

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(days, id: \.self) { d in
                    ChipButton(title: Fmt.calendar.component(.day, from: d).description,
                               subtitle: Fmt.calendar.isDateInToday(d) ? "Сегодня" : Fmt.weekdayShort(d),
                               isSelected: Fmt.calendar.isDate(d, inSameDayAs: selected)) {
                        selected = d
                    }
                    .frame(width: 64)
                }
            }
        }
    }
}
