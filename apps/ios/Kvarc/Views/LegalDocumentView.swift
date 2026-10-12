import SwiftUI

/// Полный текст документа базы, например правил проживания
struct LegalDocumentView: View {
    let code: String
    @Environment(AppState.self) private var app
    @State private var doc: LegalDocument?
    @State private var loadError: String?

    var body: some View {
        Group {
            if let doc {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        ScreenTitle(title: doc.title, subtitle: doc.issuer)
                        ForEach(Array(doc.sections.enumerated()), id: \.offset) { _, section in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(section.title).font(.headline).foregroundStyle(Brand.ink)
                                ForEach(Array(section.paragraphs.enumerated()), id: \.offset) { _, p in
                                    paragraph(p)
                                }
                            }
                            .card()
                        }
                    }
                    .padding(20)
                    .textSelection(.enabled)
                }
            } else if let loadError {
                RetryView(message: loadError) { await load() }
            } else {
                LoadingView()
            }
        }
        .screenBackground()
        .navigationTitle("Документы")
        .navigationBarTitleDisplayMode(.inline)
        .task { if doc == nil { await load() } }
    }

    @ViewBuilder
    private func paragraph(_ p: String) -> some View {
        if p.hasPrefix("• ") {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("•")
                Text(String(p.dropFirst(2)))
            }
            .font(.subheadline).foregroundStyle(Brand.secondaryText)
            .padding(.leading, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(p).font(.subheadline).foregroundStyle(Brand.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func load() async {
        do {
            doc = try await app.backend.legalDocument(code)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }
}
