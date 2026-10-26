// swift-tools-version:5.9
import PackageDescription

// Ядро без PhotoKit (CleanerKit/): хеши, группировка, лимиты. Тестируется `swift test` на Mac,
// те же файлы подключены к цели приложения в Xcode-проекте.
let package = Package(
    name: "CleanerKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CleanerKit", targets: ["CleanerKit"]),
    ],
    targets: [
        .target(name: "CleanerKit", path: "CleanerKit"),
        .testTarget(name: "CleanerKitTests", dependencies: ["CleanerKit"], path: "Tests/CleanerKitTests"),
    ]
)
