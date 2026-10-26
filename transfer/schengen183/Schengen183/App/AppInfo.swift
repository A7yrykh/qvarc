import Foundation

enum AppInfo {
    static let proYearlyID = "es.avsyrykh.schengen183.pro.yearly"
    static let privacyURL = URL(string: "https://avsyrykh.es/schengen183/privacidad")!
    static let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!
    static let supportURL = URL(string: "https://avsyrykh.es/schengen183/")!
    static let supportEmail = "alexander@avsyrykh.es"
    static let eesInfoURL = URL(string: "https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/smart-borders/entry-exit-system_en")!
    static let shortStayCalculatorURL = URL(string: "https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/border-crossing_en")!

    static var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }
}

enum Prefs {
    static let selectedTraveler = "selectedTraveler"
    static let autoTracking = "autoTracking"
    static let reminders = "reminders"
    static let onboarded = "onboarded"
    static let isPro = "isPro"
}
