import SwiftData
import SwiftUI

struct TramiteDetailView: View {
    @Environment(\.lang) private var lang
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var access: FullAccess
    @Query private var allActive: [ActiveTramite]
    @Query private var documents: [StoredDocument]

    let tramite: Tramite
    @State private var showUnlock = false
    @State private var showAddDocument = false
    @State private var confirmRemove = false

    private var active: ActiveTramite? { allActive.first { $0.tramiteID == tramite.id } }

    var body: some View {
        List {
            Section {
                Text(tramite.summary[lang])
                InfoRow(symbol: "person.2", title: S.who[lang], text: tramite.who[lang])
                InfoRow(symbol: "mappin.and.ellipse", title: S.whereLabel[lang], text: tramite.whereToApply[lang])
                InfoRow(symbol: "eurosign", title: S.cost[lang], text: tramite.cost[lang])
                InfoRow(symbol: "clock", title: S.duration[lang], text: tramite.duration[lang])
                if let deadline = tramite.deadline {
                    InfoRow(symbol: "exclamationmark.triangle", title: S.deadline[lang], text: deadline[lang])
                }
            }

            if active == nil {
                Section {
                    Button(action: start) {
                        Label(S.startTramite[lang], systemImage: "play.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }

            if !tramite.forms.isEmpty {
                Section(S.forms[lang]) {
                    ForEach(tramite.forms) { form in
                        NavigationLink {
                            FormHelperView(form: form, tramite: tramite)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(form.title[lang]).font(.subheadline.weight(.semibold))
                                if let mark = form.mark {
                                    Text("\(S.mark[lang]): \(mark[lang])").font(.caption).foregroundStyle(.secondary)
                                }
                                if let amount = form.amount {
                                    Text("\(S.amount[lang]): \(formatEuro(amount, lang: lang))").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }

            Section(S.documentsNeeded[lang]) {
                ForEach(tramite.documents) { req in
                    CheckRow(isOn: active?.checkedDocuments.contains(req.id) ?? false,
                             title: req.text[lang], subtitle: req.note?[lang], enabled: active != nil) {
                        active?.toggleDocument(req.id)
                    }
                }
            }

            Section(S.steps[lang]) {
                ForEach(Array(tramite.steps.enumerated()), id: \.element.id) { index, step in
                    VStack(alignment: .leading, spacing: 8) {
                        CheckRow(isOn: active?.completedSteps.contains(step.id) ?? false,
                                 title: "\(index + 1). \(step.title[lang])", subtitle: step.detail[lang], enabled: active != nil) {
                            active?.toggleStep(step.id)
                        }
                        HStack(spacing: 16) {
                            if step.isCita, tramite.cita != nil {
                                NavigationLink {
                                    CitaHelperView(tramite: tramite)
                                } label: {
                                    Label(S.citaHelper[lang], systemImage: "calendar.badge.clock").font(.caption.weight(.semibold))
                                }
                                .buttonStyle(.bordered)
                            }
                            if let link = step.link, !step.isCita || tramite.cita == nil {
                                Link(destination: link) {
                                    Label(S.openLink[lang], systemImage: "arrow.up.right.square").font(.caption.weight(.semibold))
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .padding(.leading, 34)
                    }
                    .padding(.vertical, 2)
                }
            }

            if let active {
                ActiveFileSection(active: active, tramite: tramite)
                Section {
                    if active.isFinished {
                        Button(S.reopen[lang]) { active.finishedAt = nil }
                    } else {
                        Button(S.markFinished[lang]) {
                            active.finishedAt = Date()
                            if tramite.resultDocument != nil { showAddDocument = true }
                        }
                    }
                    if active.isFinished, tramite.resultDocument != nil {
                        Button(S.saveResult[lang]) { showAddDocument = true }
                    }
                    Button(S.removeTramite[lang], role: .destructive) { confirmRemove = true }
                }
            }

            if !tramite.tips.isEmpty || !(tramite.cita?.tips.isEmpty ?? true) {
                Section(S.tips[lang]) {
                    ForEach(tramite.tips + (tramite.cita?.tips ?? []), id: \.self) { tip in
                        Label(tip[lang], systemImage: "lightbulb").font(.subheadline)
                    }
                }
            }

            Section {
                ForEach(tramite.sources, id: \.url) { source in
                    ExternalLinkRow(title: source.title[lang], url: source.url)
                }
            } header: {
                Text(S.sources[lang])
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(S.verifiedOn.format(lang, verifiedDate))
                    Text(S.disclaimer[lang])
                }
            }
        }
        .navigationTitle(tramite.title[lang])
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showUnlock) { UnlockSheet(reason: S.limitTramites[lang]) }
        .sheet(isPresented: $showAddDocument) {
            if let kind = tramite.resultDocument {
                NavigationStack { AddDocumentView(presetKind: kind) }
            }
        }
        .confirmationDialog(S.removeTramite[lang], isPresented: $confirmRemove, titleVisibility: .visible) {
            Button(S.delete[lang], role: .destructive) {
                if let active { context.delete(active) }
                try? context.save()
                reschedule()
            }
            Button(S.cancel[lang], role: .cancel) {}
        }
    }

    private var verifiedDate: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: tramite.verifiedOn) else { return tramite.verifiedOn }
        return formatDate(d, lang: lang)
    }

    private func start() {
        let open = allActive.filter { !$0.isFinished }.count
        if !access.isUnlocked, open >= FreeLimits.activeTramites {
            showUnlock = true
            return
        }
        context.insert(ActiveTramite(tramiteID: tramite.id))
        try? context.save()
    }

    private func reschedule() {
        Task { await NotificationService.reschedule(documents: documents, tramites: allActive, lang: lang) }
    }
}

/// Даты, номер дела и заметки по активному трамиту.
struct ActiveFileSection: View {
    @Environment(\.lang) private var lang
    @Bindable var active: ActiveTramite
    let tramite: Tramite

    var body: some View {
        Section(S.myFile[lang]) {
            if let cita = active.citaDate {
                NavigationLink {
                    CitaHelperView(tramite: tramite)
                } label: {
                    InfoRow(symbol: "calendar", title: S.citaOn[lang],
                            text: formatDate(cita, lang: lang, time: true) + (active.citaPlace.isEmpty ? "" : " · \(active.citaPlace)"))
                }
            }
            Toggle(S.submittedOn[lang], isOn: Binding(
                get: { active.submittedAt != nil },
                set: { active.submittedAt = $0 ? Date() : nil }
            ))
            if active.submittedAt != nil {
                DatePicker(S.submittedOn[lang], selection: Binding(
                    get: { active.submittedAt ?? Date() },
                    set: { active.submittedAt = $0 }
                ), displayedComponents: .date)
            }
            HStack {
                TextField(S.expedienteNumber[lang], text: $active.expediente)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                CopyButton(value: active.expediente)
            }
            TextField(S.notes[lang], text: $active.notes, axis: .vertical)
                .lineLimit(2...8)
        }
    }
}
