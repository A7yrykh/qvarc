import UIKit

/// Отчёт для налоговой/пограничников: PDF (A4) и CSV со всеми поездками.
enum ReportExporter {
    struct Input {
        let traveler: Traveler
        let year: Int
    }

    static func csvFile(for travelers: [Traveler]) throws -> URL {
        let today = Day.today()
        let rows = travelers.flatMap { t in
            (t.stays ?? []).map { ReportBuilder.Row(traveler: t.displayName, stay: $0.stay(today: today), ongoing: $0.isOngoing) }
        }
        let header = ["Traveller", "Country code", "Country", "Schengen", "Entry", "Exit", "Days"]
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("stays-\(today.iso).csv")
        try ReportBuilder.csv(rows: rows, header: header).write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    static func pdfFile(_ input: Input) throws -> URL {
        let today = Day.today()
        let traveler = input.traveler
        let stays = traveler.stayList(today: today)
        let schengen = SchengenCalculator(stays: stays)
        let residency = ResidencyCalculator(stays: stays)
        let page = CGRect(x: 0, y: 0, width: 595, height: 842)
        let margin: CGFloat = 48
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("report-\(traveler.displayName)-\(input.year).pdf".replacingOccurrences(of: " ", with: "-"))

        let renderer = UIGraphicsPDFRenderer(bounds: page)
        try renderer.writePDF(to: url) { ctx in
            var y: CGFloat = margin
            func newPageIfNeeded(_ height: CGFloat) {
                if y + height > page.height - margin {
                    ctx.beginPage()
                    y = margin
                }
            }
            func draw(_ text: String, font: UIFont, color: UIColor = .black, x: CGFloat = margin, width: CGFloat? = nil) -> CGFloat {
                let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
                let w = width ?? (page.width - x - margin)
                let rect = (text as NSString).boundingRect(with: CGSize(width: w, height: .greatestFiniteMagnitude),
                                                           options: .usesLineFragmentOrigin, attributes: attrs, context: nil)
                (text as NSString).draw(with: CGRect(x: x, y: y, width: w, height: rect.height),
                                        options: .usesLineFragmentOrigin, attributes: attrs, context: nil)
                return ceil(rect.height)
            }

            ctx.beginPage()
            y += draw(String(localized: "Travel days report"), font: .boldSystemFont(ofSize: 22)) + 6
            y += draw(String(localized: "Traveller: \(traveler.displayName)"), font: .systemFont(ofSize: 12)) + 2
            y += draw(String(localized: "Generated: \(today.formattedLong)"), font: .systemFont(ofSize: 12), color: .darkGray) + 18

            y += draw(String(localized: "Schengen 90/180"), font: .boldSystemFont(ofSize: 15)) + 4
            let used = schengen.used(on: today)
            y += draw(String(localized: "Days used in the last 180 days: \(used) of 90. Remaining: \(schengen.remaining(on: today))."),
                      font: .systemFont(ofSize: 12)) + 18

            y += draw(String(localized: "Days by country in \(String(input.year))"), font: .boldSystemFont(ofSize: 15)) + 4
            let totals = residency.totals(year: input.year)
            if totals.isEmpty {
                y += draw(String(localized: "No stays recorded."), font: .systemFont(ofSize: 12)) + 4
            }
            for item in totals {
                newPageIfNeeded(18)
                let mark = item.reachesThreshold ? "  ≥ 183" : ""
                _ = draw("\(Countries.name(item.country)) (\(item.country))", font: .systemFont(ofSize: 12))
                y += draw("\(item.days)\(mark)", font: .monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
                          x: page.width - margin - 120, width: 120) + 4
            }
            y += 18

            y += draw(String(localized: "Stays"), font: .boldSystemFont(ofSize: 15)) + 6
            let cols: [CGFloat] = [margin, margin + 190, margin + 300, margin + 410]
            let header = [String(localized: "Country"), String(localized: "Entry"), String(localized: "Exit"), String(localized: "Days")]
            for (i, title) in header.enumerated() {
                _ = draw(title, font: .boldSystemFont(ofSize: 11), color: .darkGray, x: cols[i], width: 110)
            }
            y += 18
            let records = (traveler.stays ?? []).sorted { $0.startOrdinal < $1.startOrdinal }
            for record in records {
                let stay = record.stay(today: today)
                guard stay.end.year >= input.year - 1, stay.start.year <= input.year else { continue }
                newPageIfNeeded(16)
                let schengenMark = stay.isSchengen ? " ●" : ""
                _ = draw("\(Countries.name(stay.country))\(schengenMark)", font: .systemFont(ofSize: 11), x: cols[0], width: 185)
                _ = draw(stay.start.iso, font: .monospacedDigitSystemFont(ofSize: 11, weight: .regular), x: cols[1], width: 105)
                _ = draw(record.isOngoing ? String(localized: "ongoing") : stay.end.iso,
                         font: .monospacedDigitSystemFont(ofSize: 11, weight: .regular), x: cols[2], width: 105)
                y += draw("\(stay.length)", font: .monospacedDigitSystemFont(ofSize: 11, weight: .regular), x: cols[3], width: 80) + 3
            }
            y += 20
            newPageIfNeeded(80)
            _ = draw(String(localized: "● Schengen area. Entry and exit days count as full days. Data entered by the traveller or recorded by the app from the phone's location; it is not an official record. The EES and tax authorities keep their own counts."),
                     font: .systemFont(ofSize: 9), color: .darkGray)
        }
        return url
    }
}
