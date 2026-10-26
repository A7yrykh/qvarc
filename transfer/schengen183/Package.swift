// swift-tools-version:5.9
import PackageDescription

// Ядро (Shared/) собирается и тестируется `swift test` на Mac; те же файлы входят в цель приложения.
let package = Package(
    name: "StayKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "StayKit", targets: ["StayKit"]),
    ],
    targets: [
        .target(name: "StayKit", path: "Shared"),
        .testTarget(name: "StayKitTests", dependencies: ["StayKit"], path: "Tests/StayKitTests"),
    ]
)
