import Foundation
import CoreLocation
import SwiftData

/// Автоучёт стран (Pro): служба значительных изменений местоположения (вышки сотовой связи,
/// не GPS) — почти не тратит батарею и перезапускает приложение в фоне. Координаты не
/// сохраняются: из них берётся только код страны, всё остаётся на телефоне.
@MainActor
final class LocationTracker: NSObject, ObservableObject {
    static let shared = LocationTracker()

    @Published private(set) var authorization: CLAuthorizationStatus
    @Published private(set) var lastCountry: String?
    @Published private(set) var lastUpdate: Date?
    @Published private(set) var isRunning = false

    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()

    private override init() {
        authorization = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        lastCountry = UserDefaults.standard.string(forKey: "lastCountry")
        lastUpdate = UserDefaults.standard.object(forKey: "lastUpdate") as? Date
    }

    var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: Prefs.autoTracking)
    }

    var hasAlwaysAccess: Bool { authorization == .authorizedAlways }

    func enable() {
        UserDefaults.standard.set(true, forKey: Prefs.autoTracking)
        switch authorization {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            manager.requestAlwaysAuthorization()
            startUpdates()
        case .authorizedAlways:
            startUpdates()
        default:
            break
        }
        objectWillChange.send()
    }

    func disable() {
        UserDefaults.standard.set(false, forKey: Prefs.autoTracking)
        stop()
        objectWillChange.send()
    }

    func stop() {
        manager.stopMonitoringSignificantLocationChanges()
        isRunning = false
    }

    func resumeIfEnabled() {
        guard isEnabled, PurchaseManager.shared.isPro else { return }
        if authorization == .authorizedAlways || authorization == .authorizedWhenInUse {
            startUpdates()
        }
    }

    /// Разовая проверка страны при открытии приложения.
    func refreshNow() {
        guard isEnabled, PurchaseManager.shared.isPro,
              authorization == .authorizedAlways || authorization == .authorizedWhenInUse else { return }
        manager.requestLocation()
    }

    private func startUpdates() {
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
        manager.startMonitoringSignificantLocationChanges()
        manager.requestLocation()
        isRunning = true
    }

    private func handle(_ location: CLLocation) async {
        guard let placemark = try? await geocoder.reverseGeocodeLocation(location).first,
              let code = placemark.isoCountryCode else { return }
        lastCountry = code
        lastUpdate = location.timestamp
        UserDefaults.standard.set(code, forKey: "lastCountry")
        UserDefaults.standard.set(location.timestamp, forKey: "lastUpdate")
        record(country: code, on: Day(location.timestamp))
    }

    func record(country: String, on day: Day) {
        let context = Persistence.container.mainContext
        let me = Persistence.primaryTraveler(in: context)
        let open = (me.stays ?? []).filter { $0.isAuto && $0.isOngoing }.max { $0.startOrdinal < $1.startOrdinal }
        let current = open.map { (country: $0.country, start: $0.start) }
        switch AutoTrack.action(current: current, observed: country, on: day) {
        case .none:
            return
        case let .open(code, start):
            context.insert(StayRecord(country: code, start: start, end: nil, isAuto: true, traveler: me))
        case let .move(closeOn, code):
            open?.end = closeOn
            context.insert(StayRecord(country: code, start: closeOn, end: nil, isAuto: true, traveler: me))
        }
        try? context.save()
        Reminders.reschedule(context: context)
    }
}

extension LocationTracker: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorization = status
            if self.isEnabled && status == .authorizedWhenInUse {
                // Сначала «При использовании», затем iOS предложит «Всегда» для фонового учёта.
                self.manager.requestAlwaysAuthorization()
            }
            self.resumeIfEnabled()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            await self.handle(location)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
