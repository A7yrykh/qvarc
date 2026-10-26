import SwiftUI

/// Примерная медиатека для снимков экрана App Store (`-demoData`). В реальном режиме не используется.
enum DemoLibrary {
    static func items() -> [MediaItem] {
        var out: [MediaItem] = []
        let start = Date(timeIntervalSince1970: 1_750_000_000)
        var rng = SplitMix(seed: 7)

        // Дубликаты: 46 пар копий (пересланные из мессенджеров, сохранённые дважды).
        for i in 0..<46 {
            let hash = rng.next()
            let date = start.addingTimeInterval(Double(i) * 86_400)
            out.append(MediaItem(id: "dup-\(i)-a", date: date, pixelWidth: 4032, pixelHeight: 3024,
                                 bytes: Int64(2_600_000 + Int(rng.next() % 1_600_000)), hash: hash))
            out.append(MediaItem(id: "dup-\(i)-b", date: date.addingTimeInterval(3_600 * 5), pixelWidth: 1600,
                                 pixelHeight: 1200, bytes: Int64(380_000 + Int(rng.next() % 300_000)), hash: hash))
            if i % 4 == 0 {
                out.append(MediaItem(id: "dup-\(i)-c", date: date.addingTimeInterval(86_400 * 2), pixelWidth: 4032,
                                     pixelHeight: 3024, bytes: 3_100_000, hash: hash))
            }
        }
        // Серии похожих: 31 серия по 3–6 снимков.
        for s in 0..<31 {
            let base = rng.next()
            let date = start.addingTimeInterval(Double(s) * 86_400 * 3 + 40_000)
            for k in 0..<(3 + s % 4) {
                out.append(MediaItem(id: "sim-\(s)-\(k)", date: date.addingTimeInterval(Double(k) * 4),
                                     pixelWidth: 4032, pixelHeight: 3024,
                                     bytes: Int64(2_200_000 + Int(rng.next() % 2_000_000)),
                                     isFavorite: k == 1 && s % 5 == 0,
                                     hash: base ^ (UInt64(0b111) << UInt64(k * 3))))
            }
        }
        // Снимки экрана.
        for i in 0..<214 {
            out.append(MediaItem(id: "shot-\(i)", date: start.addingTimeInterval(Double(i) * 50_000),
                                 pixelWidth: 1206, pixelHeight: 2622, bytes: Int64(450_000 + Int(rng.next() % 900_000)),
                                 isScreenshot: true, hash: rng.next()))
        }
        // Видео.
        let videoSizes: [Int64] = [1_840, 1_210, 960, 744, 610, 522, 488, 402, 356, 290, 241, 198, 164, 133, 97, 72, 58]
        for (i, mb) in videoSizes.enumerated() {
            out.append(MediaItem(id: "vid-\(i)", kind: .video, date: start.addingTimeInterval(Double(i) * 400_000),
                                 pixelWidth: 3840, pixelHeight: 2160, bytes: mb * 1_000_000,
                                 duration: Double(mb) / 6.2))
        }
        return out
    }

    /// Картинка-заглушка: градиент и символ, разные для разных серий.
    static func style(for id: String) -> (colors: [Color], symbol: String) {
        let palettes: [[Color]] = [
            [.orange, .pink], [.teal, .blue], [.green, .mint], [.indigo, .purple],
            [.yellow, .orange], [.cyan, .teal], [.red, .orange], [.blue, .indigo],
        ]
        let symbols = ["mountain.2.fill", "sun.max.fill", "pawprint.fill", "fork.knife", "beach.umbrella.fill",
                       "figure.walk", "leaf.fill", "building.2.fill", "birthday.cake.fill", "car.fill"]
        if id.hasPrefix("shot") {
            // Снимки экрана: светлые «экраны» разных приложений.
            let n = Int(id.split(separator: "-").last ?? "0") ?? 0
            let tints: [Color] = [.blue, .green, .orange, .purple, .pink, .teal, .indigo]
            let icons = ["message.fill", "map.fill", "ticket.fill", "chart.bar.fill", "cart.fill",
                         "airplane", "qrcode", "music.note", "envelope.fill", "calendar"]
            return ([Color(white: 0.97), tints[n % tints.count].opacity(0.35)], icons[(n * 3) % icons.count])
        }
        // Копии одной серии выглядят одинаково: берём номер серии без суффикса.
        let parts = id.split(separator: "-")
        let key = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        let salt = id.hasPrefix("sim") ? 3 : id.hasPrefix("vid") ? 5 : 0
        return (palettes[(key + salt) % palettes.count], symbols[(key * 7 + salt) % symbols.count])
    }
}

struct SplitMix {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
