import PhotosUI
import SwiftData
import SwiftUI
import VisionKit

struct DocumentsView: View {
    @Environment(\.lang) private var lang
    @EnvironmentObject private var access: FullAccess
    @Query(sort: \StoredDocument.createdAt, order: .reverse) private var documents: [StoredDocument]
    @State private var showAdd = false
    @State private var showUnlock = false

    var body: some View {
        List {
            if documents.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "doc.viewfinder").font(.largeTitle).foregroundStyle(Color.brand)
                        Text(S.emptyDocuments[lang]).font(.subheadline)
                    }
                    .padding(.vertical, 8)
                }
            }
            ForEach(documents) { doc in
                NavigationLink {
                    DocumentDetailView(document: doc)
                } label: {
                    DocumentRow(document: doc)
                }
            }
            Section {
            } footer: {
                Label(S.privacyNote[lang], systemImage: "lock.shield").font(.caption)
            }
        }
        .navigationTitle(W.vault[lang])
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: add) { Image(systemName: "plus") }
                    .accessibilityLabel(S.addDocument[lang])
            }
        }
        .sheet(isPresented: $showAdd) {
            NavigationStack { AddDocumentView(presetKind: nil) }
        }
        .sheet(isPresented: $showUnlock) { UnlockSheet(reason: S.limitDocuments[lang]) }
    }

    private func add() {
        if !access.isUnlocked, documents.count >= FreeLimits.documents {
            showUnlock = true
        } else {
            showAdd = true
        }
    }
}

struct DocumentRow: View {
    @Environment(\.lang) private var lang
    let document: StoredDocument

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
            VStack(alignment: .leading, spacing: 3) {
                Text(document.title.isEmpty ? document.kind.title[lang] : document.title).font(.headline)
                if let expiry = document.expiryDate {
                    Text("\(S.expiry[lang]): \(formatDate(expiry, lang: lang))")
                        .font(.caption)
                        .foregroundStyle(urgencyColor(expiry))
                }
                if let status = statusText {
                    Text(status).font(.caption.weight(.semibold)).foregroundStyle(.orange)
                }
            }
        }
    }

    private var statusText: String? {
        guard let expiry = document.expiryDate else { return nil }
        if expiry < Date() {
            if document.kind.isRenewableResidence, Deadlines.renewalWindow(expiry: expiry).contains(Date()) {
                return S.renewalWindowOpen[lang]
            }
            return S.expired[lang]
        }
        if document.kind.isRenewableResidence, Deadlines.renewalWindow(expiry: expiry).contains(Date()) {
            return S.renewalWindowOpen[lang]
        }
        return nil
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let file = document.pageFiles.first, let image = VaultStorage.image(file) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            Image(systemName: document.kind.symbol)
                .font(.title2)
                .foregroundStyle(Color.brand)
                .frame(width: 48, height: 48)
                .background(Color.brandSoft, in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Добавление документа

struct AddDocumentView: View {
    @Environment(\.lang) private var lang
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var documents: [StoredDocument]
    @Query private var tramites: [ActiveTramite]

    let presetKind: DocumentKind?

    @State private var images: [UIImage] = []
    @State private var kind: DocumentKind = .tie
    @State private var title = ""
    @State private var number = ""
    @State private var hasExpiry = true
    @State private var expiry = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    @State private var hasIssue = false
    @State private var issue = Date()
    @State private var recognized = ""
    @State private var isRecognizing = false
    @State private var suggested = false
    @State private var showScanner = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var errorText: String?

    var body: some View {
        Form {
            Section(S.pages[lang]) {
                if !images.isEmpty {
                    ScrollView(.horizontal) {
                        HStack {
                            ForEach(images.indices, id: \.self) { i in
                                Image(uiImage: images[i]).resizable().scaledToFit().frame(height: 120)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                        }
                    }
                }
                HStack {
                    Button {
                        if VNDocumentCameraViewController.isSupported { showScanner = true } else { errorText = S.scannerUnavailable[lang] }
                    } label: {
                        Label(S.scan[lang], systemImage: "doc.viewfinder")
                    }
                    .buttonStyle(.bordered)
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 4, matching: .images) {
                        Label(S.fromPhotos[lang], systemImage: "photo.on.rectangle")
                    }
                    .buttonStyle(.bordered)
                }
                if isRecognizing {
                    HStack { ProgressView(); Text(S.recognizing[lang]).font(.caption) }
                }
                if let errorText {
                    Text(errorText).font(.caption).foregroundStyle(.red)
                }
            }

            Section {
                Picker(S.documentType[lang], selection: $kind) {
                    ForEach(DocumentKind.allCases) { Text($0.title[lang]).tag($0) }
                }
                TextField(S.documentTitle[lang], text: $title)
                TextField(S.documentNumber[lang], text: $number)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Toggle(S.hasExpiry[lang], isOn: $hasExpiry)
                if hasExpiry {
                    DatePicker(S.expiry[lang], selection: $expiry, displayedComponents: .date)
                }
                Toggle(S.hasIssue[lang], isOn: $hasIssue)
                if hasIssue {
                    DatePicker(S.issued[lang], selection: $issue, displayedComponents: .date)
                }
            } footer: {
                if suggested { Text(S.suggestedFromScan[lang]) }
            }
        }
        .navigationTitle(S.addDocument[lang])
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(S.cancel[lang]) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button(S.save[lang], action: save) }
        }
        .onAppear {
            if let presetKind {
                kind = presetKind
                hasExpiry = presetKind != .padron && presetKind != .nie && presetKind != .rentalContract
                hasIssue = presetKind == .padron
            }
        }
        .fullScreenCover(isPresented: $showScanner) {
            DocumentScanner { scanned in
                showScanner = false
                append(scanned)
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoItems) { _, items in
            Task {
                var loaded: [UIImage] = []
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        loaded.append(image)
                    }
                }
                photoItems = []
                append(loaded)
            }
        }
    }

    private func append(_ newImages: [UIImage]) {
        guard !newImages.isEmpty else { return }
        images += newImages
        isRecognizing = true
        Task {
            let text = await TextRecognizer.recognize(newImages)
            recognized += (recognized.isEmpty ? "" : "\n") + text
            applySuggestions(DocumentText.analyze(recognized))
            isRecognizing = false
        }
    }

    private func applySuggestions(_ a: DocumentTextAnalysis) {
        if let e = a.expiryDate {
            expiry = e
            hasExpiry = true
            suggested = true
        }
        if let i = a.issueDate {
            issue = i
            hasIssue = true
            suggested = true
        }
        if number.isEmpty, let nie = a.nies.first {
            number = NIE.formatted(nie)
            suggested = true
        }
        // TIE и сертификат NIE содержат номер NIE; паспорт — MRZ.
        let upper = recognized.uppercased()
        if presetKind == nil {
            if upper.contains("TARJETA DE IDENTIDAD DE EXTRANJERO") || upper.contains("PERMISO DE RESIDENCIA") {
                kind = .tie
            } else if upper.contains("CIUDADANO DE LA UNI") {
                kind = .euRegistration
            } else if upper.contains("P<") {
                kind = .passport
            } else if upper.contains("PADR") {
                kind = .padron
            }
        }
    }

    private func save() {
        do {
            let files = try VaultStorage.save(images)
            let doc = StoredDocument(kind: kind, title: title.trimmingCharacters(in: .whitespaces), pageFiles: files)
            doc.number = number
            doc.expiryDate = hasExpiry ? expiry : nil
            doc.issueDate = hasIssue ? issue : nil
            doc.recognizedText = recognized
            context.insert(doc)
            try context.save()
            Task { await NotificationService.reschedule(documents: documents + [doc], tramites: tramites, lang: lang) }
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

// MARK: - Сканер VisionKit

struct DocumentScanner: UIViewControllerRepresentable {
    let onFinish: ([UIImage]) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onFinish: ([UIImage]) -> Void
        init(onFinish: @escaping ([UIImage]) -> Void) { self.onFinish = onFinish }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            onFinish((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            onFinish([])
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            onFinish([])
        }
    }
}
