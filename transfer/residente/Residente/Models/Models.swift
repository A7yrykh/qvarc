import Foundation
import SwiftData

/// Ситуация пользователя и личные данные для форм. Одна запись.
@Model
final class Profile {
    var isEUCitizen: Bool
    var stageRaw: String
    var provinceCode: String
    var personalJSON: Data?
    var createdAt: Date
    /// С какого дня идёт законное проживание (первая резолюция или въезд по визе) — для проверки отсутствий.
    var residenceStartOrdinal: Int?
    /// Какое правило отсутствий проверять (AbsenceRule), nil — не проверять.
    var absenceRuleRaw: String?

    init(isEUCitizen: Bool, stage: Stage, provinceCode: String) {
        self.isEUCitizen = isEUCitizen
        self.stageRaw = stage.rawValue
        self.provinceCode = provinceCode
        self.createdAt = Date()
    }

    var stage: Stage {
        get { Stage(rawValue: stageRaw) ?? .justArrived }
        set { stageRaw = newValue.rawValue }
    }

    var situation: Situation { Situation(isEUCitizen: isEUCitizen, stage: stage) }

    var province: Province? { Province.named(code: provinceCode) }

    var residenceStart: Day? {
        get { residenceStartOrdinal.map(Day.init(ordinal:)) }
        set { residenceStartOrdinal = newValue?.ordinal }
    }

    var absenceRule: AbsenceRule? {
        get { absenceRuleRaw.flatMap(AbsenceRule.init(rawValue:)) }
        set { absenceRuleRaw = newValue?.rawValue }
    }

    /// Правило по умолчанию для ситуации: граждане ЕС — постоянное проживание, остальные — larga duración.
    var suggestedAbsenceRule: AbsenceRule { isEUCitizen ? .euPermanent : .longTerm }

    var personal: PersonalData {
        get {
            guard let personalJSON, let data = try? JSONDecoder().decode(PersonalData.self, from: personalJSON) else {
                return PersonalData()
            }
            return data
        }
        set { personalJSON = try? JSONEncoder().encode(newValue) }
    }
}

/// Трамит, который пользователь ведёт: отметки, даты, номер дела.
@Model
final class ActiveTramite {
    @Attribute(.unique) var tramiteID: String
    var startedAt: Date
    var completedSteps: [String]
    var checkedDocuments: [String]
    var citaDate: Date?
    var citaPlace: String
    var citaAttempts: [Date]
    var submittedAt: Date?
    var expediente: String
    var notes: String
    var finishedAt: Date?

    init(tramiteID: String) {
        self.tramiteID = tramiteID
        self.startedAt = Date()
        self.completedSteps = []
        self.checkedDocuments = []
        self.citaPlace = ""
        self.citaAttempts = []
        self.expediente = ""
        self.notes = ""
    }

    var tramite: Tramite? { Catalog.tramite(id: tramiteID) }

    var isFinished: Bool { finishedAt != nil }

    var progress: Double { tramite?.progress(completedSteps: Set(completedSteps)) ?? 0 }

    func toggleStep(_ id: String) {
        if let i = completedSteps.firstIndex(of: id) { completedSteps.remove(at: i) } else { completedSteps.append(id) }
    }

    func toggleDocument(_ id: String) {
        if let i = checkedDocuments.firstIndex(of: id) { checkedDocuments.remove(at: i) } else { checkedDocuments.append(id) }
    }
}

/// Документ в хранилище. Сами изображения лежат файлами (см. VaultStorage), здесь — имена файлов.
@Model
final class StoredDocument {
    var id: UUID
    var kindRaw: String
    var title: String
    var expiryDate: Date?
    var issueDate: Date?
    var number: String
    var pageFiles: [String]
    var recognizedText: String
    var remindersOn: Bool
    var createdAt: Date

    init(kind: DocumentKind, title: String, pageFiles: [String]) {
        self.id = UUID()
        self.kindRaw = kind.rawValue
        self.title = title
        self.number = ""
        self.pageFiles = pageFiles
        self.recognizedText = ""
        self.remindersOn = true
        self.createdAt = Date()
    }

    var kind: DocumentKind {
        get { DocumentKind(rawValue: kindRaw) ?? .other }
        set { kindRaw = newValue.rawValue }
    }

    var milestones: [Milestone] {
        Deadlines.milestones(kind: kind, expiry: expiryDate, issued: issueDate)
    }
}

/// Поездка или пребывание в стране. Испания — дом: достаточно записывать поездки за границу.
@Model
final class Trip {
    var id: UUID = UUID()
    var country: String = "FR"
    /// Дни хранятся номерами (Day.ordinal), чтобы смена часового пояса не сдвигала даты.
    var startOrdinal: Int = 0
    /// nil — поездка продолжается.
    var endOrdinal: Int?
    var note: String = ""
    /// Записано автоучётом по геопозиции.
    var isAuto: Bool = false
    var createdAt: Date = Date()

    init(country: String, start: Day, end: Day?, note: String = "", isAuto: Bool = false) {
        self.country = country.uppercased()
        self.startOrdinal = start.ordinal
        self.endOrdinal = end?.ordinal
        self.note = note
        self.isAuto = isAuto
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

    func stay(today: Day = .today()) -> Stay {
        Stay(country: country, start: start, end: end ?? max(start, today))
    }
}

extension Array where Element == Trip {
    func stays(today: Day = .today()) -> [Stay] { map { $0.stay(today: today) } }
}

/// Что открыто бесплатно. Полная версия («Residente completo») снимает лимиты.
enum FreeLimits {
    static let activeTramites = 1
    static let documents = 3
}
