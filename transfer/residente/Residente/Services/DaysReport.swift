import UIKit

/// Отчёт по дням для налоговой, extranjería или пограничников: PDF (A4) на языке приложения и CSV.
enum DaysReport {
    static func csv(trips: [Trip]) throws -> URL {
        let today = Day.today()
        let rows = trips.map { ReportBuilder.Row(traveler: "", stay: $0.stay(today: today), ongoing: $0.isOngoing) }
        let header = ["Traveller", "Country code", "Country", "Schengen", "Start", "End", "Days"]
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("residente-days-\(today.iso).csv")
        try ReportBuilder.csv(rows: rows, header: header).write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    @MainActor
    static func pdf(profile: Profile, trips: [Trip], lang: Lang) throws -> URL {
        let today = Day.today()
        let ledger = profile.ledger(trips, today: today)
        let page = CGRect(x: 0, y: 0, width: 595, height: 842)
        let margin: CGFloat = 48
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("residente-\(today.iso).pdf")
        let name = [profile.personal.name, profile.personal.firstSurname].filter { !$0.isEmpty }.joined(separator: " ")

        try UIGraphicsPDFRenderer(bounds: page).writePDF(to: url) { ctx in
            var y = margin
            func ensure(_ h: CGFloat) { if y + h > page.height - margin { ctx.beginPage(); y = margin } }
            @discardableResult
            func draw(_ text: String, _ font: UIFont, _ color: UIColor = .black, x: CGFloat = margin, width: CGFloat? = nil) -> CGFloat {
                let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
                let w = width ?? (page.width - x - margin)
                let r = (text as NSString).boundingRect(with: CGSize(width: w, height: .greatestFiniteMagnitude),
                                                        options: .usesLineFragmentOrigin, attributes: attrs, context: nil)
                (text as NSString).draw(with: CGRect(x: x, y: y, width: w, height: r.height),
                                        options: .usesLineFragmentOrigin, attributes: attrs, context: nil)
                return ceil(r.height)
            }

            ctx.beginPage()
            y += draw("Residente · \(W.days[lang])", .boldSystemFont(ofSize: 22)) + 4
            if !name.isEmpty { y += draw(name, .systemFont(ofSize: 12)) + 2 }
            y += draw(formatDate(today.date(), lang: lang), .systemFont(ofSize: 12), .darkGray) + 18

            for year in [today.year, today.year - 1] {
                y += draw("\(W.daysInSpainYear.format(lang, year)): \(ledger.daysInSpain(year: year)) / 183", .systemFont(ofSize: 13)) + 4
            }
            let schengenTitle = profile.residenceStart == nil ? W.schengenVisitor[lang] : W.schengenAbroad[lang]
            y += draw("\(schengenTitle): \(W.daysLeftOf90.format(lang, ledger.schengenLeft))", .systemFont(ofSize: 13)) + 18

            y += draw(W.myTrips[lang], .boldSystemFont(ofSize: 15)) + 6
            let cols: [CGFloat] = [margin, margin + 200, margin + 310, margin + 420]
            for (i, title) in [W.country[lang], W.departure[lang], W.comeback[lang], W.days[lang]].enumerated() {
                draw(title, .boldSystemFont(ofSize: 11), .darkGray, x: cols[i], width: 105)
            }
            y += 18
            let mono = UIFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
            for trip in trips.sorted(by: { $0.startOrdinal < $1.startOrdinal }) {
                let stay = trip.stay(today: today)
                ensure(16)
                draw(Countries.name(stay.country, locale: lang.locale) + (stay.isSchengen ? " ●" : ""), .systemFont(ofSize: 11), x: cols[0], width: 195)
                draw(stay.start.iso, mono, x: cols[1], width: 105)
                draw(trip.isOngoing ? "…" : stay.end.iso, mono, x: cols[2], width: 105)
                y += draw("\(stay.length)", mono, x: cols[3], width: 80) + 3
            }
            y += 20
            ensure(60)
            draw("● Schengen. " + W.absenceDisclaimer[lang], .systemFont(ofSize: 9), .darkGray)
        }
        return url
    }
}
