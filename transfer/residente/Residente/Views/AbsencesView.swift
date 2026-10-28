import SwiftData
import SwiftUI

/// Проверка отсутствий для продления, larga duración и постоянного проживания ЕС.
struct AbsencesView: View {
    @Environment(\.lang) private var lang
    @EnvironmentObject private var access: FullAccess
    @Query private var profiles: [Profile]
    @Query(sort: \Trip.startOrdinal) private var trips: [Trip]
    @State private var showUnlock = false

    var body: some View {
        List {
            if let profile = profiles.first {
                RuleSection(profile: profile)
                if !access.isUnlocked {
                    Section {
                        UnlockCard(reason: W.limitFull[lang]) { showUnlock = true }
                    }
                } else if let check = profile.absenceCheck(trips) {
                    resultSection(check)
                } else {
                    Text(W.setResidenceStart[lang]).foregroundStyle(.secondary)
                }
            }
            Section {
                Text(W.absenceDisclaimer[lang]).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle(W.absences[lang])
        .sheet(isPresented: $showUnlock) { UnlockSheet(reason: W.limitFull[lang]) }
    }

    private func resultSection(_ check: AbsenceCheck) -> some View {
        Section {
            HStack {
                Text("\(formatDate(check.period.lowerBound.date(), lang: lang)) – \(formatDate(check.period.upperBound.date(), lang: lang))")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                StatusPill(status: check.status)
            }
            ForEach(Array(check.lines.enumerated()), id: \.offset) { index, line in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(label(line, index: index)).font(.subheadline)
                        Spacer()
                        Text(W.valueOfLimit.format(lang, line.value, line.limit))
                            .font(.subheadline.weight(.semibold)).monospacedDigit()
                            .foregroundStyle(StatusPill(status: line.status).color)
                    }
                    ProgressView(value: min(1, Double(line.value) / Double(max(line.limit, 1))))
                        .tint(StatusPill(status: line.status).color)
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func label(_ line: AbsenceCheck.Line, index: Int) -> String {
        switch line.measure {
        case .longestAbsence: return W.longestAbsence[lang]
        case .totalAbsence:
            if profiles.first?.absenceRule == .euPermanent { return W.absenceInYear.format(lang, index + 1) }
            return W.totalAbsence[lang]
        case .daysInSpain(let year): return W.daysInSpainPermitYear.format(lang, year)
        }
    }
}

/// Дата начала проживания и правило, которое проверяем.
struct RuleSection: View {
    @Environment(\.lang) private var lang
    @Bindable var profile: Profile

    var body: some View {
        Section {
            Toggle(W.iLiveHere[lang], isOn: Binding(
                get: { profile.residenceStart != nil },
                set: { on in
                    profile.residenceStart = on ? Day.today().adding(-365) : nil
                    if on, profile.absenceRule == nil { profile.absenceRule = profile.suggestedAbsenceRule }
                }))
            if let start = profile.residenceStart {
                DatePicker(W.residenceSince[lang], selection: Binding(
                    get: { start.date() },
                    set: { profile.residenceStart = Day($0) }), in: ...Date(), displayedComponents: .date)
                Picker(W.absenceRule[lang], selection: Binding(
                    get: { profile.absenceRule ?? profile.suggestedAbsenceRule },
                    set: { profile.absenceRule = $0 })) {
                    ForEach(AbsenceRule.allCases) { Text(W.title($0)[lang]).tag($0) }
                }
            }
        } footer: {
            if profile.residenceStart != nil {
                Text(W.rule(profile.absenceRule ?? profile.suggestedAbsenceRule)[lang])
            } else {
                Text(W.iLiveHereHint[lang])
            }
        }
    }
}

/// «Можно ли поехать?»: 90/180 вне Испании и лимиты отсутствий в одном ответе.
struct TravelCheckView: View {
    @Environment(\.lang) private var lang
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var access: FullAccess
    @Query private var profiles: [Profile]
    @Query(sort: \Trip.startOrdinal) private var trips: [Trip]
    @State private var country = "FR"
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(86400 * 7)

    var body: some View {
        Form {
            Section(W.tripCheck[lang]) {
                Picker(W.country[lang], selection: $country) {
                    ForEach(Countries.all(locale: lang.locale), id: \.self) { code in
                        Text("\(Countries.flag(code)) \(Countries.name(code, locale: lang.locale))").tag(code)
                    }
                }
                DatePicker(W.departure[lang], selection: $start, displayedComponents: .date)
                DatePicker(W.comeback[lang], selection: $end, in: start..., displayedComponents: .date)
            }
            if let profile = profiles.first {
                verdict(profile)
            }
            Section {
                Button(W.addTrip[lang]) {
                    context.insert(Trip(country: country, start: Day(start), end: max(Day(start), Day(end))))
                    try? context.save()
                }
            }
        }
        .navigationTitle(W.canITravel[lang])
    }

    private func verdict(_ profile: Profile) -> some View {
        let trip = Stay(country: country, start: Day(start), end: Day(end))
        let today = Day.today()
        let ledger = profile.ledger(trips, today: today)
        let schengen = ledger.evaluate(trip: trip)
        var problems: [String] = []
        if let s = schengen, let day = s.firstViolation {
            problems.append(W.tripBreaksSchengen.format(lang, formatDate(day.date(), lang: lang)))
        }
        var latest: Day?
        if access.isUnlocked, let rule = profile.absenceRule, let since = profile.residenceStart, country != SpainPresence.spain {
            let stays = trips.stays(today: today) + [trip]
            let check = Absences.check(rule, stays: stays, residenceStart: since, today: max(today, trip.end))
            if check.status == .broken {
                problems.append(W.tripBreaksAbsence.format(lang, W.title(rule)[lang]))
            }
            latest = Absences.latestReturn(rule, stays: trips.stays(today: today), residenceStart: since, departure: trip.start)
        }
        if let last = schengen?.lastAllowedDay, schengen?.isAllowed == false {
            latest = min(latest ?? last, last)
        }
        return Section {
            if problems.isEmpty {
                Label(W.tripOK[lang], systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            }
            ForEach(problems, id: \.self) { p in
                Label(p, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Color.flagRed)
            }
            if let latest, !problems.isEmpty {
                Text(W.latestReturn.format(lang, formatDate(latest.date(), lang: lang))).font(.subheadline.weight(.semibold))
            }
            if let s = schengen {
                LabeledContent(W.schengenAbroad[lang], value: "\(s.maxUsed) / 90")
            }
        }
    }
}
