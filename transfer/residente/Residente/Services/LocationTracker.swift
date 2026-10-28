import CoreLocation
import Foundation
import SwiftData

/// Автоучёт стран (полная версия): служба значительных изменений местоположения (вышки связи,
/// не GPS) почти не тратит батарею и будит приложение в фоне. Координаты не сохраняются:
/// из них берётся только код страны, всё остаётся на телефоне.
@MainActor
final class LocationTracker: NSObject, ObservableObject {
    static let shared = LocationTracker()
    private static let enabledKey = "autoTracking"

    @Published private(set) var authorization: CLAuthorizationStatus
    @Published private(set) var lastCountry: String?

    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()

    private override init() {
        authorization = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        lastCountry = UserDefaults.standard.string(forKey: "lastCountry")
    }

    var isEnabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }

    func enable() {
        UserDefaults.standard.set(true, forKey: Self.enabledKey)
        switch authorization {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            manager.requestAlwaysAuthorization()
            start()
        case .authorizedAlways: start()
        default: break
        }
        objectWillChange.send()
    }

    func disable() {
        UserDefaults.standard.set(false, forKey: Self.enabledKey)
        manager.stopMonitoringSignificantLocationChanges()
        objectWillChange.send()
    }

    func resumeIfEnabled() {
        guard isEnabled, FullAccess.shared.isUnlocked,
              authorization == .authorizedAlways || authorization == .authorizedWhenInUse else { return }
        start()
    }

    /// Разовая проверка страны при открытии приложения.
    func refreshNow() {
        guard isEnabled, FullAccess.shared.isUnlocked,
              authorization == .authorizedAlways || authorization == .authorizedWhenInUse else { return }
        manager.requestLocation()
    }

    private func start() {
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
        manager.startMonitoringSignificantLocationChanges()
        manager.requestLocation()
    }

    private func handle(_ location: CLLocation) async {
        guard let code = try? await geocoder.reverseGeocodeLocation(location).first?.isoCountryCode else { return }
        lastCountry = code
        UserDefaults.standard.set(code, forKey: "lastCountry")
        record(country: code, on: Day(location.timestamp))
    }

    /// Резиденту записываем только поездки за границу: возвращение в Испанию закрывает поездку.
    func record(country: String, on day: Day) {
        let context = Store.container.mainContext
        let trips = (try? context.fetch(FetchDescriptor<Trip>())) ?? []
        let open = trips.filter { $0.isAuto && $0.isOngoing }.max { $0.startOrdinal < $1.startOrdinal }
        let profile = (try? context.fetch(FetchDescriptor<Profile>()))?.first
        let resident = profile?.residenceStart != nil
        var current: (country: String, start: Day)? = open.map { (country: $0.country, start: $0.start) }
        if current == nil, resident { current = (country: SpainPresence.spain, start: day) }

        switch AutoTrack.action(current: current, observed: country, on: day) {
        case .none:
            return
        case let .open(code, start):
            context.insert(Trip(country: code, start: start, end: nil, isAuto: true))
        case let .move(closeOn, code):
            open?.end = closeOn
            if !(resident && code == SpainPresence.spain) {
                context.insert(Trip(country: code, start: closeOn, end: nil, isAuto: true))
            }
        }
        try? context.save()
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
        Task { @MainActor in await self.handle(location) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
