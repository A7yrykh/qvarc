import SwiftUI

/// Экран категории: группы (дубликаты, похожие) или сетка (скриншоты, видео) с выбором и удалением.
struct CategoryView: View {
    let category: CleanCategory
    @EnvironmentObject private var library: LibraryStore
    @State private var selected: Set<String> = []
    @State private var didPreselect = false

    var body: some View {
        let items = library.items(in: category)
        Group {
            if items.isEmpty {
                ContentUnavailableView {
                    Label("Todo limpio", systemImage: "checkmark.circle")
                } description: {
                    Text("No hay nada que borrar en esta sección.")
                }
            } else if category.isGrouped {
                groupList
            } else {
                grid(items)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(category.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !items.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    if selected.count == selectableIDs.count {
                        Button("Ninguno") { selected.removeAll() }
                    } else {
                        Button("Todos") { selected = selectableIDs }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !items.isEmpty {
                DeleteBar(selection: selectedItems) { selected.removeAll() }
            }
        }
        .task(id: library.hasScanned) {
            // В группах сразу отмечаем лишние копии: лучший снимок остаётся.
            if !didPreselect && category.isGrouped && !selectableIDs.isEmpty {
                selected = selectableIDs
                didPreselect = true
            }
        }
    }

    private var selectableIDs: Set<String> { Set(library.items(in: category).map(\.id)) }

    private var selectedItems: [MediaItem] {
        let all = category.isGrouped ? library.groups(in: category).flatMap(\.items) : library.items(in: category)
        return all.filter { selected.contains($0.id) }
    }

    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    // MARK: Группы

    private var groupList: some View {
        let groups = library.groups(in: category)
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                Text(category == .duplicates
                     ? LocalizedStringKey("Dejamos la mejor copia de cada foto (marcada con ★) y seleccionamos el resto.")
                     : LocalizedStringKey("En cada serie dejamos la mejor foto (★). Revisa la selección antes de borrar."))
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(.horizontal)
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            if let date = group.items.first?.date {
                                Text(date, format: .dateTime.day().month().year())
                                    .font(.subheadline.weight(.semibold))
                            }
                            Spacer()
                            Text("\(group.items.count) fotos · \(Format.bytes(group.reclaimableBytes))")
                                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(group.items) { item in
                                    cell(item, isBest: item.id == group.keeperID)
                                        .frame(width: 112, height: 112)
                                }
                            }
                        }
                    }
                    .padding(12)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
    }

    // MARK: Сетка

    private func grid(_ items: [MediaItem]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(category == .videos
                     ? LocalizedStringKey("Ordenados por tamaño. Los vídeos de más de 50 MB aparecen aquí.")
                     : LocalizedStringKey("Las más antiguas primero."))
                    .font(.footnote).foregroundStyle(.secondary)
                    .padding(.horizontal)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 4)], spacing: 4) {
                    ForEach(items) { item in
                        cell(item, isBest: false)
                            .aspectRatio(1, contentMode: .fit)
                            .overlay(alignment: .bottomTrailing) {
                                if category == .videos {
                                    Text(Format.bytes(item.bytes))
                                        .font(.caption2.weight(.bold).monospacedDigit())
                                        .padding(.horizontal, 5).padding(.vertical, 2)
                                        .background(.black.opacity(0.55), in: Capsule())
                                        .foregroundStyle(.white)
                                        .padding(5)
                                }
                            }
                    }
                }
                .padding(.horizontal, 4)
            }
            .padding(.vertical)
        }
    }

    private func cell(_ item: MediaItem, isBest: Bool) -> some View {
        Thumbnail(item: item)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topTrailing) { SelectionBadge(selected: selected.contains(item.id)) }
            .overlay(alignment: .topLeading) {
                if isBest {
                    Text("★ Mejor")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Color.brand, in: Capsule())
                        .foregroundStyle(.white)
                        .padding(6)
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(selected.contains(item.id) ? Color.brand : .clear, lineWidth: 3)
            }
            .contentShape(Rectangle())
            .onTapGesture { toggle(item.id) }
    }
}
