import SwiftData
import SwiftUI

extension Profile {
    /// Режим учёта дней: с датой начала проживания — резидент, без неё — гость.
    var ledgerMode: DayLedger.Mode {
        residenceStart.map { .resident(since: $0) } ?? .visitor
    }

    func ledger(_ trips: [Trip], today: Day = .today()) -> DayLedger {
        DayLedger(stays: trips.stays(today: today), mode: ledgerMode, today: today)
    }

    func absenceCheck(_ trips: [Trip], today: Day = .today()) -> AbsenceCheck? {
        guard let rule = absenceRule, let start = residenceStart else { return nil }
        return Absences.check(rule, stays: trips.stays(today: today), residenceStart: start, today: today)
    }
}

/// Главный экран: всё о статусе человека на одной ленте карточек. Разделы открываются из карточек.
struct ExpedienteView: View {
    @Environment(\.lang) private var lang
    @EnvironmentObject private var access: FullAccess
    @Query private var profiles: [Profile]
    @Query(sort: \ActiveTramite.startedAt) private var active: [ActiveTramite]
    @Query private var documents: [StoredDocument]
    @Query(sort: \Trip.startOrdinal) private var trips: [Trip]

    private var profile: Profile? { profiles.first }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                residenceCard
                if let profile { countersRow(profile) }
                if let profile { absenceCard(profile) }
                upcoming
                sections
                Text(S.disclaimer[lang])
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: Шапка

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text(W.appName[lang].uppercased())
                    .font(.caption.weight(.heavy))
                    .tracking(2)
                    .foregroundStyle(Color.flagYellow)
                Text(W.home[lang])
                    .font(.system(.largeTitle, design: .serif, weight: .bold))
                    .foregroundStyle(Color.cream)
                if let p = profile?.province {
                    Label(p.name, systemImage: "mappin.and.ellipse")
                        .font(.footnote)
                        .foregroundStyle(Color.cream.opacity(0.8))
                }
            }
            Spacer()
            NavigationLink(value: Route.settings) {
                Image(systemName: "slider.horizontal.3")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.cream)
                    .frame(width: 44, height: 44)
                    .background(Color.white.opacity(0.12), in: Circle())
            }
            .accessibilityLabel(W.settings[lang])
        }
        .padding(20)
        .background(
            LinearGradient(colors: [.brandDeep, .brandNight], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.top, 8)
    }

    // MARK: ВНЖ

    private var residenceDoc: StoredDocument? {
        documents.filter { $0.kind.isRenewableResidence || $0.kind == .euRegistration }
            .max { ($0.expiryDate ?? .distantPast) < ($1.expiryDate ?? .distantPast) }
    }

    private var residenceCard: some View {
        NavigationLink(value: Route.vault) {
            Tile {
                HStack(spacing: 14) {
                    FlagBadge()
                    VStack(alignment: .leading, spacing: 4) {
                        Text(W.residence[lang]).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        if let doc = residenceDoc, let expiry = doc.expiryDate {
                            Text(W.validUntil.format(lang, formatDate(expiry, lang: lang)))
                                .font(.headline)
                            if let m = Deadlines.upcoming(doc.milestones).first {
                                Text(m.title(lang, document: doc.kind.title[lang]) + " · " + relativeDays(m.date, lang: lang))
                                    .font(.footnote)
                                    .foregroundStyle(urgencyColor(m.date))
                            }
                        } else {
                            Text(W.noResidenceDoc[lang]).font(.subheadline)
                            Text(W.addResidenceDoc[lang]).font(.footnote.weight(.semibold)).foregroundStyle(Color.brand)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: Счётчики дней

    private func countersRow(_ profile: Profile) -> some View {
        let ledger = profile.ledger(trips)
        let year = Day.today().year
        let inSpain = ledger.daysInSpain(year: year)
        return HStack(spacing: 12) {
            NavigationLink(value: Route.days) {
                Tile {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(W.daysInSpainYear.format(lang, year)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        DayGauge(value: inSpain, limit: ResidencyCalculator.threshold, tint: .brand)
                        Text(inSpain >= ResidencyCalculator.threshold ? W.taxResident[lang] : W.of183[lang])
                            .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
            }
            NavigationLink(value: Route.travel) {
                Tile {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(profile.residenceStart == nil ? W.schengenVisitor[lang] : W.schengenAbroad[lang])
                            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        DayGauge(value: ledger.schengenUsed, limit: SchengenCalculator.limit,
                                 tint: ledger.schengenLeft < 15 ? .flagRed : .brand)
                        Text(W.daysLeftOf90.format(lang, ledger.schengenLeft))
                            .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: Отсутствия

    @ViewBuilder
    private func absenceCard(_ profile: Profile) -> some View {
        if profile.residenceStart != nil {
            NavigationLink(value: Route.absences) {
                Tile {
                    HStack(spacing: 14) {
                        Image(systemName: "airplane.departure")
                            .font(.title2)
                            .foregroundStyle(Color.brand)
                            .frame(width: 40)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(W.absences[lang]).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            Text(W.title(profile.absenceRule ?? profile.suggestedAbsenceRule)[lang]).font(.headline)
                            if access.isUnlocked, let check = profile.absenceCheck(trips) {
                                StatusPill(status: check.status)
                            } else if !access.isUnlocked {
                                Label(W.full[lang], systemImage: "lock.fill").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                    }
                }
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Ближайшее

    private struct Upcoming: Identifiable {
        let id: String
        let date: Date
        let title: String
        let symbol: String
        let tramiteID: String?
        let hasTime: Bool
    }

    private var upcomingItems: [Upcoming] {
        var items: [Upcoming] = []
        for doc in documents where doc.remindersOn {
            let name = doc.title.isEmpty ? doc.kind.title[lang] : doc.title
            if let m = Deadlines.upcoming(doc.milestones).first {
                items.append(Upcoming(id: "doc-\(doc.id)", date: m.date, title: m.title(lang, document: name),
                                      symbol: doc.kind.symbol, tramiteID: nil, hasTime: false))
            }
        }
        for a in active where !a.isFinished {
            if let cita = a.citaDate, cita >= Date(), let t = a.tramite {
                items.append(Upcoming(id: "cita-\(a.tramiteID)", date: cita, title: "\(S.citaOn[lang]): \(t.title[lang])",
                                      symbol: "calendar", tramiteID: t.id, hasTime: true))
            }
        }
        return items.sorted { $0.date < $1.date }
    }

    private var recommended: [Tramite] {
        guard let profile else { return [] }
        let started = Set(active.map(\.tramiteID))
        return PlanBuilder.recommended(for: profile.situation)
            .filter { !started.contains($0) }
            .compactMap(Catalog.tramite(id:))
    }

    private var upcoming: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(W.nextSteps[lang])
            let current = active.filter { !$0.isFinished }
            if upcomingItems.isEmpty && current.isEmpty && recommended.isEmpty {
                Text(W.nothingNext[lang]).font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(upcomingItems.prefix(4)) { item in
                timelineRow(symbol: item.symbol, title: item.title,
                            detail: formatDate(item.date, lang: lang, time: item.hasTime),
                            trailing: relativeDays(item.date, lang: lang), color: urgencyColor(item.date))
            }
            ForEach(current) { a in
                if let t = a.tramite {
                    NavigationLink(value: t.id) {
                        HStack(spacing: 12) {
                            ProgressRing(value: a.progress)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.title[lang]).font(.subheadline.weight(.semibold))
                                Text(S.inProgress[lang]).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                        }
                        .padding(12)
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            ForEach(recommended.prefix(2)) { t in
                NavigationLink(value: t.id) {
                    HStack(spacing: 12) {
                        Image(systemName: "plus.circle.fill").font(.title3).foregroundStyle(Color.flagRed)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.title[lang]).font(.subheadline.weight(.semibold))
                            Text(S.recommended[lang]).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                    }
                    .padding(12)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 6)
    }

    private func timelineRow(symbol: String, title: String, detail: String, trailing: String, color: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(Color.brand).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(trailing).font(.caption.weight(.bold)).foregroundStyle(color)
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Разделы

    private var sections: some View {
        VStack(spacing: 0) {
            sectionLink(.papers, symbol: "building.columns", title: W.papers, hint: W.papersHint)
            Divider().padding(.leading, 56)
            sectionLink(.vault, symbol: "lock.doc", title: W.vault, hint: W.vaultHint)
            Divider().padding(.leading, 56)
            sectionLink(.days, symbol: "calendar", title: W.days, hint: W.daysHint)
            Divider().padding(.leading, 56)
            sectionLink(.travel, symbol: "airplane", title: W.canITravel, hint: W.tripCheck)
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.top, 6)
    }

    private func sectionLink(_ route: Route, symbol: String, title: LText, hint: LText) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.headline)
                    .foregroundStyle(Color.cream)
                    .frame(width: 32, height: 32)
                    .background(Color.brandDeep, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title[lang]).font(.body.weight(.semibold))
                    Text(hint[lang]).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Общие элементы нового каркаса

struct Tile<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct SectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.heavy))
            .tracking(1.2)
            .foregroundStyle(.secondary)
    }
}

/// Круг в цветах флага, как на иконке.
struct FlagBadge: View {
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(Color.flagRed)
            Rectangle().fill(Color.flagYellow).frame(height: size / 2)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.cream, lineWidth: 2))
    }
}

/// Полоса «использовано из лимита» с крупным числом.
struct DayGauge: View {
    let value: Int
    let limit: Int
    var tint: Color = .brand

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("\(value)").font(.system(size: 30, weight: .bold, design: .rounded)).monospacedDigit()
                Text("/ \(limit)").font(.subheadline).foregroundStyle(.secondary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(tint.opacity(0.15))
                    Capsule().fill(tint).frame(width: geo.size.width * min(1, Double(value) / Double(max(limit, 1))))
                }
            }
            .frame(height: 6)
        }
    }
}

struct StatusPill: View {
    @Environment(\.lang) private var lang
    let status: AbsenceCheck.Status

    var color: Color {
        switch status {
        case .ok: return .green
        case .close: return .orange
        case .broken: return .flagRed
        }
    }

    var body: some View {
        Text(W.status(status)[lang])
            .font(.caption.weight(.bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
    }
}
