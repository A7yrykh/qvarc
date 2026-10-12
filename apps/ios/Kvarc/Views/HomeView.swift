import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var app
    @State private var checkin: CheckinState?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if app.isDemo { DemoBanner() }
                if let b = app.booking {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Words.greeting()).font(.subheadline).foregroundStyle(Brand.secondaryText)
                        Text(headline(b)).font(.system(size: 28, weight: .semibold)).foregroundStyle(Brand.ink)
                    }
                    bookingCard(b)
                    tiles
                } else {
                    NoBookingView()
                }
                aboutLinks
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .screenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await reload() }
        .task(id: app.booking) { await loadCheckin() }
    }

    private var header: some View {
        HStack {
            Image("LogoWordmarkGraphite").resizable().scaledToFit().frame(width: 112).accessibilityLabel("Кварц")
            Spacer()
            Menu {
                Button("Обновить") { Task { await reload() } }
                Button("Выйти", role: .destructive) { Task { await app.logout() } }
            } label: {
                Image(systemName: "person.crop.circle")
                    .font(.title2)
                    .foregroundStyle(Brand.graphite)
                    .frame(width: 44, height: 44)
                    .background(Brand.card, in: Circle())
            }
            .accessibilityLabel("Профиль")
        }
        .padding(.top, 12)
    }

    private func headline(_ b: Booking) -> String {
        if b.isCheckedOut { return "Спасибо, что были у нас" }
        let cal = Fmt.calendar
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: b.arrivalAt)).day ?? 0
        if days > 1 { return "До заезда \(Words.days(days))" }
        if days == 1 { return "Заезд завтра" }
        if days == 0 { return "Заезд сегодня" }
        return Date() < b.departureAt ? "Хорошего отдыха" : "Время выезда прошло"
    }

    private func bookingCard(_ b: Booking) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("БРОНЬ № \(b.number)").font(.footnote).tracking(1).foregroundStyle(Brand.onGraphiteSecondary)
                    Text(b.unitTitle).font(.title3.weight(.semibold))
                }
                Spacer()
                Image("LogoMarkMilky").resizable().scaledToFit().frame(width: 26).opacity(0.9).accessibilityHidden(true)
            }
            HStack(alignment: .top) {
                dateBlock("Заезд", "\(Fmt.dayMonth(b.arrivalAt)), с \(Fmt.time(b.arrivalAt))")
                dateBlock("Выезд", "\(Fmt.dayMonth(b.departureAt)), до \(Fmt.time(b.departureAt))")
            }
            Rectangle().fill(Brand.graphiteLine).frame(height: 1)
            HStack(spacing: 10) {
                Text(b.checkinStatusLabel)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Brand.graphite)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Brand.milky, in: RoundedRectangle(cornerRadius: 10))
                if let c = checkin, !b.isCheckedOut {
                    Text("\(c.doneCount) из \(c.guestSteps.count) шагов").font(.footnote).foregroundStyle(Brand.onGraphiteSecondary)
                }
            }
            if let c = checkin, !b.isCheckedOut {
                HStack(spacing: 6) {
                    ForEach(Array(c.guestSteps.enumerated()), id: \.offset) { _, s in
                        Capsule().fill(s.done ? Brand.milky : Color(hex: 0x5A646C)).frame(height: 4)
                    }
                }
                .accessibilityHidden(true)
                if c.doneCount < c.guestSteps.count {
                    NavigationLink {
                        CheckinView(bookingId: b.id)
                    } label: {
                        Text(c.doneCount == 0 ? "Пройти регистрацию" : "Продолжить регистрацию")
                    }
                    .buttonStyle(PrimaryButtonStyle(inverted: true))
                } else {
                    Button("Открыть код двери") { app.tab = .access }
                        .buttonStyle(PrimaryButtonStyle(inverted: true))
                }
            }
            if b.balanceDue > 0 && !b.isCheckedOut {
                Text("Осталось оплатить \(Fmt.money(b.balanceDue))").font(.footnote).foregroundStyle(Brand.onGraphiteSecondary)
            }
        }
        .foregroundStyle(Brand.milky)
        .padding(20)
        .background(Brand.graphite, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func dateBlock(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.footnote).foregroundStyle(Brand.onGraphiteSecondary)
            Text(value).font(.callout.weight(.medium))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var tiles: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            tile("lock", "Код двери", accessHint) { app.tab = .access }
            tile("fork.knife", "Ресторан", "столик и еда в дом") { app.tab = .restaurant }
            tile("sailboat", "Прокат", "катамаран, сапы, дайвинг") { app.tab = .rental }
            if let url = URL(string: "tel:\(app.booking?.property.phone ?? AppConfig.adminPhone)") {
                Link(destination: url) {
                    tileLabel("phone", "Администратор", "круглосуточно")
                }
            }
        }
    }

    /// Проживание и правила — видно всегда, даже без брони
    private var aboutLinks: some View {
        VStack(spacing: 0) {
            NavigationLink {
                AccommodationsView()
            } label: {
                linkRow("bed.double", "Номера, апартаменты и коттедж")
            }
            Rectangle().fill(Brand.separator).frame(height: 1).padding(.leading, 52)
            NavigationLink {
                PropertyLoader { info in AboutView(info: info) }
            } label: {
                linkRow("questionmark.circle", "О базе, правила и ответы")
            }
        }
        .buttonStyle(.plain)
        .background(Brand.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func linkRow(_ icon: String, _ title: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).font(.title3).foregroundStyle(Brand.graphite).frame(width: 24)
            Text(title).font(.headline).foregroundStyle(Brand.ink)
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Brand.tertiaryText)
        }
        .padding(16)
        .contentShape(Rectangle())
    }

    private var accessHint: String {
        guard let c = checkin else { return "после регистрации" }
        return c.doneCount == c.guestSteps.count ? "в разделе «Доступ»" : "после регистрации"
    }

    private func tile(_ icon: String, _ title: String, _ subtitle: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { tileLabel(icon, title, subtitle) }.buttonStyle(.plain)
    }

    private func tileLabel(_ icon: String, _ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading) {
            Image(systemName: icon).font(.title2).foregroundStyle(Brand.graphite)
            Spacer(minLength: 12)
            Text(title).font(.headline).foregroundStyle(Brand.ink)
            Text(subtitle).font(.footnote).foregroundStyle(Brand.secondaryText).lineLimit(2)
        }
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
        .padding(16)
        .background(Brand.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func reload() async {
        await app.reloadBookings()
        await loadCheckin()
    }

    private func loadCheckin() async {
        guard let id = app.booking?.id else { checkin = nil; return }
        checkin = try? await app.backend.checkin(id)
    }
}
