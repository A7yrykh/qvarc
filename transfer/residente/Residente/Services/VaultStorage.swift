import UIKit

/// Изображения документов: файлы в Application Support/Vault с защитой
/// `completeFileProtection` (недоступны, пока iPhone заблокирован).
enum VaultStorage {
    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Vault", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                     attributes: [.protectionKey: FileProtectionType.complete])
        }
        return dir
    }

    static func url(for file: String) -> URL {
        directory.appendingPathComponent(file)
    }

    /// Сохраняет страницы и возвращает имена файлов.
    static func save(_ images: [UIImage]) throws -> [String] {
        try images.map { image in
            let name = UUID().uuidString + ".jpg"
            guard let data = image.jpegData(compressionQuality: 0.8) else {
                throw CocoaError(.fileWriteUnknown)
            }
            try data.write(to: url(for: name), options: [.atomic, .completeFileProtection])
            return name
        }
    }

    static func image(_ file: String) -> UIImage? {
        UIImage(contentsOfFile: url(for: file).path)
    }

    static func delete(_ files: [String]) {
        for file in files { try? FileManager.default.removeItem(at: url(for: file)) }
    }
}
