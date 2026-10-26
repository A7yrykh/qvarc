import Foundation
import SwiftData

@Model
final class Traveler {
    var id: UUID = UUID()
    var name: String = ""
    /// Владелец телефона: только его поездки пишет автоучёт.
    var isPrimary: Bool = false
    var createdAt: Date = Date()
    @Relationship(deleteRule: .cascade, inverse: \StayRecord.traveler)
    var stays: [StayRecord]? = []

    init(name: String, isPrimary: Bool = false) {
        self.name = name
        self.isPrimary = isPrimary
    }

    var displayName: String {
        name.isEmpty ? String(localized: "Me") : name
    }

    func stayList(today: Day = .today()) -> [Stay] {
        (stays ?? []).map { $0.stay(today: today) }
    }
}

@Model
final class StayRecord {
    var id: UUID = UUID()
    var country: String = "ES"
    /// Дни хранятся как номера дней (Day.ordinal), чтобы смена часового пояса не сдвигала даты.
    var startOrdinal: Int = 0
    /// nil — пребывание продолжается («я ещё здесь»).
    var endOrdinal: Int?
    var note: String = ""
    var isAuto: Bool = false
    var createdAt: Date = Date()
    var traveler: Traveler?

    init(country: String, start: Day, end: Day?, note: String = "", isAuto: Bool = false, traveler: Traveler?) {
        self.country = country.uppercased()
        self.startOrdinal = start.ordinal
        self.endOrdinal = end?.ordinal
        self.note = note
        self.isAuto = isAuto
        self.traveler = traveler
    }

    var start: Day {
        get { Day(ordinal: startOrdinal) }
        set { startOrdinal = newValue.ordinal }
    }

    var end: Day? {
        get { endOrdinal.map(Day.init(ordinal:)) }
        set { endOrdinal = newValue?.ordinal }
    }

    var isOngoing: Bool { endOrdinal == nil }

    /// Открытое пребывание тянется до сегодняшнего дня.
    func stay(today: Day = .today()) -> Stay {
        Stay(country: country, start: start, end: end ?? max(start, today))
    }
}

enum Persistence {
    static let container: ModelContainer = {
        do {
            return try ModelContainer(for: Traveler.self, StayRecord.self)
        } catch {
            fatalError("SwiftData: \(error)")
        }
    }()

    /// Создаёт основного путешественника при первом запуске и демо-данные для скриншотов.
    @MainActor
    static func prepare() {
        let context = container.mainContext
        let travelers = (try? context.fetch(FetchDescriptor<Traveler>())) ?? []
        if !travelers.contains(where: \.isPrimary) {
            context.insert(Traveler(name: "", isPrimary: true))
        }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-demoData") {
            DemoData.load(into: context)
        }
        #endif
        try? context.save()
    }

    @MainActor
    static func primaryTraveler(in context: ModelContext) -> Traveler {
        let travelers = (try? context.fetch(FetchDescriptor<Traveler>(sortBy: [SortDescriptor(\.createdAt)]))) ?? []
        if let me = travelers.first(where: \.isPrimary) { return me }
        let me = Traveler(name: "", isPrimary: true)
        context.insert(me)
        return me
    }
}

#if DEBUG
enum DemoData {
    @MainActor
    static func load(into context: ModelContext) {
        for t in (try? context.fetch(FetchDescriptor<Traveler>())) ?? [] { context.delete(t) }
        let me = Traveler(name: "", isPrimary: true)
        let partner = Traveler(name: "Emma")
        context.insert(me)
        context.insert(partner)
        let today = Day.today()
        let trips: [(String, Int, Int?)] = [
            ("GB", -300, -230), ("ES", -229, -190), ("PT", -189, -180), ("GB", -179, -120),
            ("FR", -119, -112), ("ES", -111, -70), ("GB", -69, -40), ("IT", -39, -33), ("ES", -32, nil),
        ]
        for (country, from, to) in trips {
            context.insert(StayRecord(country: country, start: today.adding(from), end: to.map(today.adding),
                                      isAuto: to == nil, traveler: me))
        }
        context.insert(StayRecord(country: "ES", start: today.adding(-50), end: today.adding(-10), traveler: partner))
    }
}
#endif
