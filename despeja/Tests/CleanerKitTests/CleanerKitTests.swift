import CoreGraphics
import XCTest
@testable import CleanerKit

final class ImageHashTests: XCTestCase {
    func testGradientHash() {
        // Яркость убывает слева направо: каждый пиксель ярче правого соседа → все 64 бита = 1.
        let gray = (0..<72).map { UInt8(255 - ($0 % 9) * 20) }
        XCTAssertEqual(ImageHash.dHash(gray: gray), UInt64.max)
        // Возрастающая яркость → 0.
        let up = (0..<72).map { UInt8(($0 % 9) * 20) }
        XCTAssertEqual(ImageHash.dHash(gray: up), 0)
    }

    func testDistance() {
        XCTAssertEqual(ImageHash.distance(0, 0), 0)
        XCTAssertEqual(ImageHash.distance(0b1011, 0b0001), 2)
        XCTAssertEqual(ImageHash.distance(0, .max), 64)
    }

    func testScaledCopyHasSameHash() throws {
        let big = try XCTUnwrap(makeImage(width: 400, height: 300))
        let small = try XCTUnwrap(makeImage(width: 80, height: 60))
        let a = try XCTUnwrap(ImageHash.dHash(big))
        let b = try XCTUnwrap(ImageHash.dHash(small))
        XCTAssertLessThanOrEqual(ImageHash.distance(a, b), Grouping.duplicateDistance)
    }

    private func makeImage(width: Int, height: Int) -> CGImage? {
        let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        let colors = [CGColor(red: 1, green: 0.2, blue: 0.1, alpha: 1), CGColor(red: 0.1, green: 0.3, blue: 0.9, alpha: 1)]
        let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1])!
        ctx?.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: width, y: height / 3), options: [])
        ctx?.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx?.fillEllipse(in: CGRect(x: width / 2, y: height / 4, width: width / 4, height: height / 2))
        return ctx?.makeImage()
    }
}

final class GroupingTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_760_000_000)

    func item(_ id: String, hash: UInt64, w: Int = 4032, h: Int = 3024, bytes: Int64 = 3_000_000,
              at offset: TimeInterval = 0, favorite: Bool = false, screenshot: Bool = false) -> MediaItem {
        MediaItem(id: id, date: t0.addingTimeInterval(offset), pixelWidth: w, pixelHeight: h, bytes: bytes,
                  isFavorite: favorite, isScreenshot: screenshot, hash: hash)
    }

    func testExactDuplicatesAcrossTime() {
        let items = [
            item("a", hash: 0xABCD, at: 0),
            item("b", hash: 0xABCD, w: 1600, h: 1200, bytes: 400_000, at: 86_400 * 30),
            item("c", hash: 0xFFFF_0000, at: 10),
        ]
        let groups = Grouping.duplicates(items)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(Set(groups[0].items.map(\.id)), ["a", "b"])
        XCTAssertEqual(groups[0].keeperID, "a", "оставляем снимок с большим разрешением")
        XCTAssertEqual(groups[0].reclaimableBytes, 400_000)
    }

    func testNearDuplicatesMerged() {
        let items = [item("a", hash: 0b1111_0000), item("b", hash: 0b1111_0001), item("c", hash: 0b0000_1111)]
        let groups = Grouping.duplicates(items)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(Set(groups[0].items.map(\.id)), ["a", "b"])
    }

    func testDifferentShapeIsNotDuplicate() {
        let items = [item("a", hash: 42), item("b", hash: 42, w: 3024, h: 4032)]
        XCTAssertTrue(Grouping.duplicates(items).isEmpty)
    }

    func testFavoriteIsKept() {
        let items = [item("a", hash: 7), item("b", hash: 7, w: 1000, h: 750, favorite: true)]
        XCTAssertEqual(Grouping.duplicates(items).first?.keeperID, "b")
    }

    func testSimilarSeries() {
        let base: UInt64 = 0x0F0F_0F0F_0F0F_0F0F
        let items = [
            item("s1", hash: base, at: 0),
            item("s2", hash: base ^ 0b111, at: 20),
            item("s3", hash: base ^ 0b11_1000, at: 45),
            item("far", hash: base, at: 3_600),           // слишком поздно для серии
            item("other", hash: ~base, at: 60),            // совсем другой снимок
        ]
        let groups = Grouping.similar(items)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(Set(groups[0].items.map(\.id)), ["s1", "s2", "s3"])
    }

    func testSimilarExcludesDuplicatesAndScreenshots() {
        let items = [
            item("a", hash: 1, at: 0), item("b", hash: 1, at: 5),
            item("sc1", hash: 99, at: 10, screenshot: true), item("sc2", hash: 99, at: 12, screenshot: true),
        ]
        XCTAssertTrue(Grouping.similar(items, excluding: ["a", "b"]).isEmpty)
    }

    func testLargeVideosAndScreenshots() {
        let items = [
            MediaItem(id: "v1", kind: .video, bytes: 80_000_000),
            MediaItem(id: "v2", kind: .video, bytes: 300_000_000),
            MediaItem(id: "v3", kind: .video, bytes: 5_000_000),
            item("sc", hash: 0, at: 100, screenshot: true),
            item("sc-old", hash: 0, at: 0, screenshot: true),
        ]
        XCTAssertEqual(Grouping.largeVideos(items).map(\.id), ["v2", "v1"])
        XCTAssertEqual(Grouping.screenshots(items).map(\.id), ["sc-old", "sc"])
    }
}

final class DailyQuotaTests: XCTestCase {
    func testQuotaResetsNextDay() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "quota-test-\(UUID())"))
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Madrid")!
        let quota = DailyQuota(defaults: defaults, limit: 20, calendar: cal)
        let day1 = Date(timeIntervalSince1970: 1_760_000_000)
        XCTAssertEqual(quota.remaining(on: day1), 20)
        quota.consume(15, on: day1)
        XCTAssertEqual(quota.remaining(on: day1), 5)
        quota.consume(10, on: day1)
        XCTAssertEqual(quota.remaining(on: day1), 0)
        XCTAssertEqual(quota.remaining(on: day1.addingTimeInterval(86_400)), 20)
    }
}
