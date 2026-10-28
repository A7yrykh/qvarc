// swift-tools-version:5.9
// Пакет только для тестов ядра: `swift test` на Mac. Приложение собирается из Residente.xcodeproj.
import PackageDescription

let package = Package(
    name: "ResidenteKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ResidenteKit", targets: ["ResidenteKit"])],
    targets: [
        .target(name: "ResidenteKit", path: "ResidenteKit"),
        .testTarget(name: "ResidenteKitTests", dependencies: ["ResidenteKit"], path: "Tests/ResidenteKitTests"),
    ]
)
