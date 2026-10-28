import Foundation
import UserNotifications

/// Локальные напоминания о сроках документов и о записях (cita).
/// Перестраиваются целиком при каждом изменении: так проще и надёжнее, чем точечные правки.
enum NotificationService {
    static let prefix = "tramites."
    /// iOS хранит не больше 64 запланированных уведомлений.
    static let limit = 60

    static func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    @MainActor
    static func reschedule(documents: [StoredDocument], tramites: [ActiveTramite], lang: Lang, now: Date = Date()) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: pending)

        var requests: [(Date, UNNotificationRequest)] = []
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Madrid")!

        for doc in documents where doc.remindersOn {
            let name = doc.title.isEmpty ? doc.kind.title[lang] : doc.title
            for m in Deadlines.upcoming(doc.milestones, after: now) {
                var comps = calendar.dateComponents([.year, .month, .day], from: m.date)
                comps.hour = 10
                guard let fire = calendar.date(from: comps), fire > now else { continue }
                let content = UNMutableNotificationContent()
                content.title = m.title(lang, document: name)
                content.body = body(for: m.kind, lang: lang)
                content.sound = .default
                let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                requests.append((fire, UNNotificationRequest(identifier: "\(prefix)doc.\(doc.id).\(m.id)", content: content, trigger: trigger)))
            }
        }

        for active in tramites where !active.isFinished {
            guard let cita = active.citaDate, let tramite = active.tramite else { continue }
            let reminders: [(Date?, LText)] = [
                (calendar.date(byAdding: .day, value: -1, to: cita).flatMap { calendar.date(bySettingHour: 19, minute: 0, second: 0, of: $0) },
                 LText(es: "Mañana tienes cita: revisa qué llevar.", en: "Your appointment is tomorrow: check what to bring.", ru: "Завтра приём: проверьте, что взять с собой.", uk: "Завтра прийом: перевірте, що взяти з собою.")),
                (calendar.date(byAdding: .hour, value: -2, to: cita),
                 LText(es: "Tu cita es en 2 horas.", en: "Your appointment is in 2 hours.", ru: "Приём через 2 часа.", uk: "Прийом за 2 години.")),
            ]
            for (index, reminder) in reminders.enumerated() {
                guard let fire = reminder.0, fire > now else { continue }
                let content = UNMutableNotificationContent()
                content.title = tramite.title[lang]
                content.body = reminder.1[lang] + (active.citaPlace.isEmpty ? "" : " · \(active.citaPlace)")
                content.sound = .default
                let comps = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
                let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                requests.append((fire, UNNotificationRequest(identifier: "\(prefix)cita.\(active.tramiteID).\(index)", content: content, trigger: trigger)))
            }
        }

        guard !requests.isEmpty else { return }
        // Разрешение спрашиваем только когда есть что напоминать: так понятнее, зачем оно.
        if await center.notificationSettings().authorizationStatus == .notDetermined {
            guard await requestAuthorization() else { return }
        }
        for (_, request) in requests.sorted(by: { $0.0 < $1.0 }).prefix(limit) {
            try? await center.add(request)
        }
    }

    static func body(for kind: Milestone.Kind, lang: Lang) -> String {
        switch kind {
        case .expiresSoon:
            return LText(es: "Prepara la documentación con tiempo.", en: "Get your documents ready in time.", ru: "Подготовьте документы заранее.", uk: "Підготуйте документи заздалегідь.")[lang]
        case .renewalWindowOpens:
            return LText(es: "Ya puedes pedir la renovación (hasta 90 días después de la caducidad).",
                         en: "You can apply for renewal now (until 90 days after expiry).",
                         ru: "Уже можно подавать на продление (до 90 дней после окончания срока).", uk: "Уже можна подавати на продовження (до 90 днів після закінчення строку).")[lang]
        case .expiresToday:
            return LText(es: "Si ya has pedido la renovación, guarda el justificante.", en: "If you have applied for renewal, keep the receipt handy.", ru: "Если вы уже подали на продление, держите квитанцию под рукой.", uk: "Якщо ви вже подали на продовження, тримайте квитанцію під рукою.")[lang]
        case .renewalWindowCloses:
            return LText(es: "Quedan 2 semanas para que cierre el plazo de renovación.", en: "2 weeks left before the renewal window closes.", ru: "До закрытия окна продления осталось 2 недели.", uk: "До закриття вікна продовження залишилося 2 тижні.")[lang]
        case .passportRenewSoon:
            return LText(es: "Muchos trámites exigen un pasaporte en vigor.", en: "Many procedures require a valid passport.", ru: "Для многих трамитов нужен действующий паспорт.", uk: "Для багатьох процедур потрібен чинний паспорт.")[lang]
        case .padronOld:
            return LText(es: "Muchas oficinas piden un volante de menos de 3 meses.", en: "Many offices ask for a certificate under 3 months old.", ru: "Многие офисы требуют справку не старше 3 месяцев.", uk: "Багато офісів вимагають довідку, не старшу за 3 місяці.")[lang]
        }
    }
}
