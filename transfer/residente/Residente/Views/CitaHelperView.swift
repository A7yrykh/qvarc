import SwiftData
import SwiftUI

/// Помощник записи: что выбрать в портале, честные советы, журнал попыток и дата приёма.
/// Слоты приложение не проверяет и записывать за пользователя не пытается.
struct CitaHelperView: View {
    @Environment(\.lang) private var lang
    @Environment(\.openURL) private var openURL
    @Query private var allActive: [ActiveTramite]
    @Query private var profiles: [Profile]
    @Query private var documents: [StoredDocument]

    let tramite: Tramite
    @State private var showDateEditor = false

    private var active: ActiveTramite? { allActive.first { $0.tramiteID == tramite.id } }
    private var provinceName: String { profiles.first?.province?.name ?? "" }

    var body: some View {
        List {
            if let cita = tramite.cita {
                Section {
                    InfoRow(symbol: "mappin.and.ellipse", title: S.whereLabel[lang], text: cita.whereText[lang])
                    if let service = cita.serviceName {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(S.serviceToChoose[lang]).font(.caption).foregroundStyle(.secondary)
                            HStack(alignment: .top) {
                                Text(service).font(.callout.monospaced()).textSelection(.enabled)
                                Spacer()
                                CopyButton(value: service)
                            }
                        }
                    }
                    portalButton(cita)
                    if cita.portal == .icp, !provinceName.isEmpty {
                        Text(S.chooseProvinceFirst.format(lang, provinceName)).font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section(S.tips[lang]) {
                    ForEach(cita.tips + S.citaGeneralTips, id: \.self) { tip in
                        Label(tip[lang], systemImage: "lightbulb").font(.subheadline)
                    }
                    Label(S.resellWarning[lang], systemImage: "exclamationmark.shield")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }
            }

            if let active {
                CitaFileSection(active: active, tramite: tramite, onChange: reschedule)
            } else {
                Section {
                    Text(S.startTramite[lang]).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(S.citaHelper[lang])
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func portalButton(_ cita: CitaInfo) -> some View {
        switch cita.portal {
        case .icp:
            Button {
                active?.citaAttempts.append(Date())
                openURL(CitaInfo.icpURL)
            } label: {
                Label(S.openPortal[lang], systemImage: "safari").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        case .other(let url?):
            Button {
                openURL(url)
            } label: {
                Label(S.openSite[lang], systemImage: "safari").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        case .other(nil):
            // Padrón: у каждого ayuntamiento свой сайт, поэтому ищем его.
            Button {
                let query = "cita previa empadronamiento ayuntamiento \(provinceName)"
                var comps = URLComponents(string: "https://www.google.com/search")!
                comps.queryItems = [URLQueryItem(name: "q", value: query)]
                if let url = comps.url { openURL(url) }
            } label: {
                Label(S.searchTownHall[lang], systemImage: "magnifyingglass").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func reschedule() {
        Task { await NotificationService.reschedule(documents: documents, tramites: allActive, lang: lang) }
    }
}

struct CitaFileSection: View {
    @Environment(\.lang) private var lang
    @Bindable var active: ActiveTramite
    let tramite: Tramite
    let onChange: () -> Void

    var body: some View {
        Section(S.attemptsLog[lang]) {
            HStack {
                Text(S.attemptsCount.format(lang, active.citaAttempts.count))
                Spacer()
                Button(S.logAttempt[lang]) { active.citaAttempts.append(Date()) }
                    .buttonStyle(.bordered)
            }
            if let last = active.citaAttempts.last {
                Text(formatDate(last, lang: lang, time: true)).font(.caption).foregroundStyle(.secondary)
            }
        }

        Section(S.gotCita[lang]) {
            Toggle(S.gotCita[lang], isOn: Binding(
                get: { active.citaDate != nil },
                set: { has in
                    active.citaDate = has ? Calendar.current.date(byAdding: .day, value: 7, to: Date()) : nil
                    if has, let step = tramite.steps.first(where: \.isCita), !active.completedSteps.contains(step.id) {
                        active.completedSteps.append(step.id)
                    }
                    onChange()
                }
            ))
            if active.citaDate != nil {
                DatePicker(S.citaDate[lang], selection: Binding(
                    get: { active.citaDate ?? Date() },
                    set: { active.citaDate = $0; onChange() }
                ))
                TextField(S.citaPlace[lang], text: $active.citaPlace)
                    .onSubmit(onChange)
            }
        }

        if active.citaDate != nil {
            Section(S.bringList[lang]) {
                ForEach(tramite.documents) { req in
                    CheckRow(isOn: active.checkedDocuments.contains(req.id), title: req.text[lang]) {
                        active.toggleDocument(req.id)
                    }
                }
            }
        }
    }
}
