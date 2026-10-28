import SwiftData
import SwiftUI

struct CatalogView: View {
    @Environment(\.lang) private var lang
    @Query private var profiles: [Profile]
    @State private var search = ""

    private var items: [Tramite] {
        let isEU = profiles.first?.isEUCitizen
        let list = Catalog.all.filter { t in
            guard let isEU else { return true }
            return PlanBuilder.isApplicable(t, isEUCitizen: isEU)
        }
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return list }
        return list.filter { t in
            (t.title.all + t.summary.all).contains { $0.lowercased().contains(q) }
        }
    }

    var body: some View {
        List(items) { t in
            NavigationLink(value: t.id) { TramiteRow(tramite: t) }
        }
        .searchable(text: $search)
        .navigationTitle(W.papers[lang])
    }
}

struct TramiteRow: View {
    @Environment(\.lang) private var lang
    let tramite: Tramite

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: tramite.symbol)
                .font(.title3)
                .foregroundStyle(Color.brand)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text(tramite.title[lang]).font(.headline)
                Text(tramite.summary[lang]).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }
}
