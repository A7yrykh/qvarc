import LocalAuthentication
import SwiftUI

/// Блокировка приложения Face ID / код-паролем, если включена в настройках.
@MainActor
final class AppLock: ObservableObject {
    @AppStorage("faceIDLock") var isEnabled = false
    @Published private(set) var isLocked = false

    init() {
        isLocked = isEnabled
    }

    func lockIfNeeded() {
        if isEnabled { isLocked = true }
    }

    func unlock(reason: String) async {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // Нет ни Face ID, ни код-пароля: блокировать нечем.
            isLocked = false
            return
        }
        let ok = (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
        if ok { isLocked = false }
    }
}
