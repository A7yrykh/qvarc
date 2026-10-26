// swift-tools-version:5.9
import PackageDescription

// Ядро Revende без UIKit: собирается и тестируется `swift test` на Mac.
// Те же файлы подключены в Xcode-проект приложения.
let package = Package(
    name: "RevendeKit",
    defaultLocalization: "es",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "RevendeKit", targets: ["RevendeKit"]),
    ],
    targets: [
        .target(name: "RevendeKit", path: "RevendeKit"),
        .testTarget(
            name: "RevendeKitTests",
            dependencies: ["RevendeKit"],
            path: "Tests/RevendeKitTests"
        ),
    ]
)
