#if DEBUG
import Foundation
import SwiftData

/// Сцены для скриншотов App Store, только в Debug.
/// Запуск: `-scene resident|visitor`, `-lang uk`, `-route days|absences|papers|vault|travel|unlock|tramite:tie-renewal`.
enum Fixtures {
    static var arguments: [String] { ProcessInfo.processInfo.arguments }

    static func value(_ key: String) -> String? {
        guard let i = arguments.firstIndex(of: key), i + 1 < arguments.count else { return nil }
        return arguments[i + 1]
    }

    /// Начальный экран для скриншота.
    static var route: String? { value("-route") }

    @MainActor
    static func applyIfRequested() {
        guard let scene = value("-scene") else { return }
        if let lang = value("-lang") { UserDefaults.standard.set(lang, forKey: "lang") }
        let context = Store.container.mainContext
        try? context.delete(model: Profile.self)
        try? context.delete(model: ActiveTramite.self)
        try? context.delete(model: StoredDocument.self)
        try? context.delete(model: Trip.self)

        let today = Day.today()
        let resident = scene == "resident"
        let profile = Profile(isEUCitizen: false, stage: resident ? .renewing : .justArrived, provinceCode: "46")
        if resident {
            profile.residenceStart = today.adding(-3 * 365 - 40)
            profile.absenceRule = .longTerm
        }
        var data = PersonalData()
        data.passport = "FE1234567"
        data.firstSurname = "Kovalenko"
        data.name = "Olena"
        data.sex = .m
        data.birthDate = Day(year: 1991, month: 4, day: 12).date()
        data.nationality = "Ucraniana"
        data.city = "Valencia"
        data.province = "Valencia"
        profile.personal = data
        context.insert(profile)

        if resident {
            let tie = StoredDocument(kind: .tie, title: "", pageFiles: [])
            tie.expiryDate = today.adding(48).date()
            tie.number = "Y1234567X"
            context.insert(tie)
            let renewal = ActiveTramite(tramiteID: "renewal")
            renewal.completedSteps = ["window", "gather"]
            renewal.checkedDocuments = ["passport", "tie"]
            context.insert(renewal)
            let trips: [(String, Int, Int?)] = [
                ("UA", -700, -640), ("PT", -500, -495), ("FR", -320, -310), ("UA", -260, -205),
                ("IT", -120, -114), ("DE", -60, -52), ("FR", -9, -4),
            ]
            for (c, from, to) in trips {
                context.insert(Trip(country: c, start: today.adding(from), end: to.map(today.adding)))
            }
        } else {
            let tieFirst = ActiveTramite(tramiteID: "tie-first")
            tieFirst.completedSteps = ["deadline", "cita"]
            tieFirst.citaDate = Calendar.current.date(bySettingHour: 9, minute: 40, second: 0, of: today.adding(6).date())
            tieFirst.citaPlace = "Comisaría · Valencia"
            context.insert(tieFirst)
            let passport = StoredDocument(kind: .passport, title: "", pageFiles: [])
            passport.expiryDate = today.adding(400).date()
            context.insert(passport)
            let stays: [(String, Int, Int?)] = [("GB", -200, -120), ("ES", -119, -80), ("PT", -79, -70), ("ES", -30, nil)]
            for (c, from, to) in stays {
                context.insert(Trip(country: c, start: today.adding(from), end: to.map(today.adding)))
            }
        }
        try? context.save()
        UserDefaults.standard.set(true, forKey: "autoTracking")
    }
}
#endif
