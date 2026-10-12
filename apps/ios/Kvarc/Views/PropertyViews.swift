import SwiftUI

/// Загружает сведения о базе один раз и передаёт их в содержимое
struct PropertyLoader<Content: View>: View {
    @Environment(AppState.self) private var app
    @State private var info: PropertyInfo?
    @State private var loadError: String?
    private let content: (PropertyInfo) -> Content

    init(@ViewBuilder content: @escaping (PropertyInfo) -> Content) {
        self.content = content
    }

    var body: some View {
        Group {
            if let info {
                content(info)
            } else if let loadError {
                RetryView(message: loadError) { await load() }
            } else {
                LoadingView()
            }
        }
        .task { if info == nil { await load() } }
    }

    private func load() async {
        do {
            info = try await app.backend.property()
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// Список: Стандарт, Комфорт, Апартаменты, Семейный коттедж
struct AccommodationsView: View {
    var body: some View {
        PropertyLoader { info in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenTitle(title: "Проживание", subtitle: "Заезд после \(info.checkInTime), выезд до \(info.checkOutTime). Завтрак включён.")
                    ForEach(info.unitTypes) { t in
                        NavigationLink {
                            UnitTypeView(type: t, info: info)
                        } label: {
                            UnitTypeCard(type: t)
                        }
                        .buttonStyle(.plain)
                    }
                    NavigationLink {
                        AboutView(info: info)
                    } label: {
                        Label("Правила и ответы на вопросы", systemImage: "questionmark.circle")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .padding(20)
            }
        }
        .screenBackground()
        .navigationTitle("Проживание")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct UnitTypeCard: View {
    let type: UnitType

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RemotePhoto(photo: type.photos.first)
                .frame(height: 190)
                .clipped()
            VStack(alignment: .leading, spacing: 4) {
                Text(type.name).font(.title3.weight(.semibold)).foregroundStyle(Brand.ink)
                if !type.facts.isEmpty { Text(type.facts).font(.footnote).foregroundStyle(Brand.secondaryText) }
                if let s = type.summary { Text(s).font(.subheadline).foregroundStyle(Brand.ink).lineLimit(2) }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// Фото с сайта базы. Пока грузится — серый фон, при ошибке — значок.
struct RemotePhoto: View {
    let photo: UnitPhoto?

    var body: some View {
        ZStack {
            Brand.chipBackground
            if let s = photo?.url, let url = URL(string: s) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        Image(systemName: "photo").font(.largeTitle).foregroundStyle(Brand.tertiaryText)
                    default:
                        ProgressView()
                    }
                }
            } else {
                Image(systemName: "photo").font(.largeTitle).foregroundStyle(Brand.tertiaryText)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(photo?.caption ?? "Фото")
    }
}

struct UnitTypeView: View {
    let type: UnitType
    let info: PropertyInfo
    @State private var page = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !type.photos.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        TabView(selection: $page) {
                            ForEach(Array(type.photos.enumerated()), id: \.offset) { i, p in
                                RemotePhoto(photo: p).tag(i)
                            }
                        }
                        .tabViewStyle(.page(indexDisplayMode: .always))
                        .frame(height: 280)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        Text(type.photos[min(page, type.photos.count - 1)].caption)
                            .font(.footnote).foregroundStyle(Brand.secondaryText)
                    }
                }

                ScreenTitle(title: type.name, subtitle: type.facts.isEmpty ? nil : type.facts)
                if let s = type.summary { Text(s).foregroundStyle(Brand.ink) }

                VStack(alignment: .leading, spacing: 10) {
                    Text("В номере").font(.headline).foregroundStyle(Brand.ink)
                    ForEach(type.amenities, id: \.self) { a in
                        Label(a, systemImage: "checkmark").font(.subheadline).foregroundStyle(Brand.ink)
                    }
                }
                .card()

                VStack(alignment: .leading, spacing: 6) {
                    Text("Заезд после \(info.checkInTime), выезд до \(info.checkOutTime)")
                    Text("Завтрак с 09:00 до 11:00 и уборка входят в стоимость")
                }
                .font(.subheadline).foregroundStyle(Brand.secondaryText)

                if let url = info.bookingURL(for: type) {
                    Link(destination: url) {
                        Text("Забронировать на сайте")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle(type.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// О базе: удобства, контакты, правила и ответы
struct AboutView: View {
    let info: PropertyInfo

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(title: "О базе", subtitle: info.about)

                VStack(alignment: .leading, spacing: 8) {
                    Text("На территории").font(.headline).foregroundStyle(Brand.ink)
                    ForEach(info.facilities, id: \.self) { f in
                        Label(f, systemImage: "leaf").font(.subheadline).foregroundStyle(Brand.ink)
                    }
                }
                .card()

                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(info.faq.enumerated()), id: \.offset) { i, item in
                        if i > 0 { Rectangle().fill(Brand.separator).frame(height: 1) }
                        DisclosureGroup {
                            Text(item.a).font(.subheadline).foregroundStyle(Brand.secondaryText)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 6)
                        } label: {
                            Text(item.q).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                                .multilineTextAlignment(.leading)
                        }
                        .tint(Brand.graphite)
                        .padding(.vertical, 12)
                    }
                }
                .padding(.horizontal, 16)
                .background(Brand.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))

                NavigationLink {
                    LegalDocumentView(code: "rules")
                } label: {
                    Label("Правила проживания", systemImage: "doc.text")
                }
                .buttonStyle(SecondaryButtonStyle())

                NavigationLink {
                    LegalDocumentView(code: "privacy")
                } label: {
                    Label("Политика конфиденциальности", systemImage: "lock.doc")
                }
                .buttonStyle(SecondaryButtonStyle())

                VStack(alignment: .leading, spacing: 8) {
                    Text("Контакты").font(.headline).foregroundStyle(Brand.ink)
                    if let a = info.address { Text(a).font(.subheadline).foregroundStyle(Brand.ink) }
                    ForEach(info.phones, id: \.self) { p in
                        if let url = URL(string: "tel:\(p)") {
                            Link(Phone.pretty(p), destination: url).font(.subheadline.weight(.semibold))
                        }
                    }
                    if let e = info.email, let url = URL(string: "mailto:\(e)") {
                        Link(e, destination: url).font(.subheadline)
                    }
                }
                .card()
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("О базе")
        .navigationBarTitleDisplayMode(.inline)
    }
}
