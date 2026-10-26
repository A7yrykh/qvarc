// Рисует иконку 1024×1024 без прозрачности: swift tools/make_icon.swift Schengen183/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon-1024.png"
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                           samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let s = CGFloat(size)
let rect = NSRect(x: 0, y: 0, width: s, height: s)

// Фон: градиент «синий ЕС» сверху вниз.
NSGradient(starting: NSColor(srgbRed: 22/255, green: 110/255, blue: 210/255, alpha: 1),
           ending: NSColor(srgbRed: 10/255, green: 52/255, blue: 140/255, alpha: 1))!.draw(in: rect, angle: 90)

let center = NSPoint(x: s / 2, y: s / 2)
let radius: CGFloat = 345 - 30
let line: CGFloat = 60

func arc(from: CGFloat, to: CGFloat, color: NSColor) {
    let path = NSBezierPath()
    path.appendArc(withCenter: center, radius: radius, startAngle: from, endAngle: to, clockwise: true)
    path.lineWidth = line
    path.lineCapStyle = .round
    color.setStroke()
    path.stroke()
}
// Дорожка и заполненная часть (≈250° по часовой стрелке от 12 часов).
let track = NSBezierPath(ovalIn: NSRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
track.lineWidth = line
NSColor(srgbRed: 70/255, green: 120/255, blue: 200/255, alpha: 1).setStroke()
track.stroke()
arc(from: 90, to: 90 - 250, color: NSColor(srgbRed: 1, green: 204/255, blue: 0, alpha: 1))

func drawCentered(_ text: String, font: NSFont, color: NSColor, centerY: CGFloat) {
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let str = NSAttributedString(string: text, attributes: attrs)
    let b = str.size()
    str.draw(at: NSPoint(x: center.x - b.width / 2, y: centerY - b.height / 2))
}
drawCentered("90", font: .systemFont(ofSize: 300, weight: .heavy), color: .white, centerY: center.y + 50)
NSColor.white.setFill()
NSRect(x: center.x - 115, y: center.y - 112, width: 230, height: 11).fill()
drawCentered("180", font: .systemFont(ofSize: 110, weight: .semibold),
             color: NSColor(srgbRed: 225/255, green: 235/255, blue: 1, alpha: 1), centerY: center.y - 185)

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("icon → \(out)")
