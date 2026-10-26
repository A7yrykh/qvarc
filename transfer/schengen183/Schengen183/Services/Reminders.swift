import Foundation
import SwiftData
import UserNotifications

/// Локальные напоминания (Pro): когда пора покинуть Шенген и когда близко 183 дня.
enum Reminders {
    static let prefix = "stay-reminder-"

    static var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: Prefs.reminders)
    }

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    @MainActor
    static func reschedule(context: ModelContext) {
        let center = UNUserNotificationCenter.current()
        // Других уведомлений у приложения нет, поэтому пересоздаём всё.
        center.removeAllPendingNotificationRequests()
        guard isEnabled, PurchaseManager.shared.isPro else { return }

        let today = Day.today()
        let travelers = (try? context.fetch(FetchDescriptor<Traveler>())) ?? []
        for traveler in travelers {
            let stays = traveler.stayList(today: today)
            let calc = SchengenCalculator(stays: stays)
            let name = traveler.displayName
            let inSchengen = (traveler.stays ?? []).contains { $0.isOngoing && Countries.countsTowardSchengen($0.country) }
            if inSchengen, let last = calc.lastAllowedDay(stayingFrom: today) {
                for before in [14, 7, 1, 0] {
                    let day = last.adding(-before)
                    guard day >= today else { continue }
                    let body = before == 0
                        ? String(localized: "\(name): today is the last day you can stay in the Schengen area.")
                        : String(localized: "\(name): \(before) days left in the Schengen area. Leave by \(last.formatted).")
                    schedule(id: "\(prefix)\(traveler.id)-s\(before)", on: day, title: String(localized: "90/180 limit"), body: body)
                }
            }
            // 183 дня: предупреждение за 14 дней до порога в стране, где человек сейчас.
            if let open = (traveler.stays ?? []).first(where: \.isOngoing) {
                let used = ResidencyCalculator(stays: stays).days(in: open.country,
                                                                  from: Day(year: today.year, month: 1, day: 1), to: today)
                let reachOn = today.adding(ResidencyCalculator.threshold - used)
                let warnOn = reachOn.adding(-14)
                if used < ResidencyCalculator.threshold, warnOn >= today, warnOn.year == today.year {
                    let country = Countries.name(open.country)
                    schedule(id: "\(prefix)\(traveler.id)-t", on: warnOn, title: String(localized: "183-day threshold"),
                             body: String(localized: "\(name): in 14 days you will reach 183 days in \(country) this year."))
                }
            }
        }
    }

    private static func schedule(id: String, on day: Day, title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let c = day.components
        let trigger = UNCalendarNotificationTrigger(
            dateMatching: DateComponents(year: c.year, month: c.month, day: c.day, hour: 10), repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }
}

extension Day {
    var formatted: String {
        date().formatted(date: .abbreviated, time: .omitted)
    }

    var formattedLong: String {
        date().formatted(date: .long, time: .omitted)
    }
}
