import SwiftData
import SwiftUI

struct DocumentDetailView: View {
    @Environment(\.lang) private var lang
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var documents: [StoredDocument]
    @Query private var tramites: [ActiveTramite]
    @Bindable var document: StoredDocument
    @State private var confirmDelete = false
    @State private var fullScreenPage: Int?

    var body: some View {
        Form {
            if !document.pageFiles.isEmpty {
                Section(S.pages[lang]) {
                    ScrollView(.horizontal) {
                        HStack {
                            ForEach(Array(document.pageFiles.enumerated()), id: \.element) { index, file in
                                if let image = VaultStorage.image(file) {
                                    Image(uiImage: image)
                                        .resizable()
                                        .scaledToFit()
                                        .frame(height: 180)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                        .onTapGesture { fullScreenPage = index }
                                }
                            }
                        }
                    }
                    ShareLink(items: document.pageFiles.map(VaultStorage.url(for:))) {
                        Label(S.share[lang], systemImage: "square.and.arrow.up")
                    }
                }
            }

            Section {
                Picker(S.documentType[lang], selection: Binding(get: { document.kind }, set: { document.kind = $0; changed() })) {
                    ForEach(DocumentKind.allCases) { Text($0.title[lang]).tag($0) }
                }
                TextField(S.documentTitle[lang], text: $document.title)
                HStack {
                    TextField(S.documentNumber[lang], text: $document.number)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    CopyButton(value: document.number)
                }
                optionalDate(S.hasExpiry, S.expiry, \.expiryDate)
                optionalDate(S.hasIssue, S.issued, \.issueDate)
            }

            Section(S.reminders[lang]) {
                Toggle(S.reminders[lang], isOn: Binding(get: { document.remindersOn }, set: { document.remindersOn = $0; changed() }))
                if document.remindersOn {
                    ForEach(Deadlines.upcoming(document.milestones)) { m in
                        HStack {
                            Text(m.title(lang, document: document.kind.title[lang])).font(.subheadline)
                            Spacer()
                            Text(formatDate(m.date, lang: lang)).font(.caption).foregroundStyle(urgencyColor(m.date))
                        }
                    }
                }
            }

            if !document.recognizedText.isEmpty {
                Section {
                    DisclosureGroup(S.recognizedText[lang]) {
                        Text(document.recognizedText).font(.caption.monospaced()).textSelection(.enabled)
                    }
                }
            }

            Section {
                Button(S.delete[lang], role: .destructive) { confirmDelete = true }
            }
        }
        .navigationTitle(document.title.isEmpty ? document.kind.title[lang] : document.title)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(S.deleteDocumentConfirm[lang], isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(S.delete[lang], role: .destructive, action: delete)
            Button(S.cancel[lang], role: .cancel) {}
        }
        .fullScreenCover(item: Binding(get: { fullScreenPage.map(PageIndex.init) }, set: { fullScreenPage = $0?.id })) { page in
            PageViewer(files: document.pageFiles, start: page.id)
        }
    }

    private func optionalDate(_ toggle: LText, _ label: LText, _ key: ReferenceWritableKeyPath<StoredDocument, Date?>) -> some View {
        Group {
            Toggle(toggle[lang], isOn: Binding(
                get: { document[keyPath: key] != nil },
                set: { document[keyPath: key] = $0 ? Date() : nil; changed() }
            ))
            if document[keyPath: key] != nil {
                DatePicker(label[lang], selection: Binding(
                    get: { document[keyPath: key] ?? Date() },
                    set: { document[keyPath: key] = $0; changed() }
                ), displayedComponents: .date)
            }
        }
    }

    private func changed() {
        Task { await NotificationService.reschedule(documents: documents, tramites: tramites, lang: lang) }
    }

    private func delete() {
        VaultStorage.delete(document.pageFiles)
        context.delete(document)
        try? context.save()
        changed()
        dismiss()
    }
}

private struct PageIndex: Identifiable {
    let id: Int
}

/// Просмотр страниц на весь экран с увеличением.
struct PageViewer: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.lang) private var lang
    let files: [String]
    @State var start: Int

    var body: some View {
        NavigationStack {
            TabView(selection: $start) {
                ForEach(Array(files.enumerated()), id: \.element) { index, file in
                    ZoomableImage(image: VaultStorage.image(file)).tag(index)
                }
            }
            .tabViewStyle(.page)
            .background(Color.black)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(S.done[lang]) { dismiss() } }
            }
        }
    }
}

struct ZoomableImage: View {
    let image: UIImage?
    @State private var scale: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1

    var body: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .scaleEffect(scale * pinch)
                .gesture(MagnificationGesture()
                    .updating($pinch) { value, state, _ in state = value }
                    .onEnded { scale = min(max(scale * $0, 1), 5) })
                .onTapGesture(count: 2) { withAnimation { scale = scale > 1 ? 1 : 2.5 } }
        }
    }
}
