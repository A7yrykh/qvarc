import Foundation

/// Корзина заказа еды. Живёт, пока открыто приложение.
@Observable
@MainActor
final class Cart {
    struct Line: Identifiable, Hashable {
        let item: MenuItem
        var quantity: Int
        var id: String { item.id }
    }

    private(set) var lines: [Line] = []

    var count: Int { lines.reduce(0) { $0 + $1.quantity } }
    var total: Int { lines.reduce(0) { $0 + $1.item.price * $1.quantity } }
    var isEmpty: Bool { lines.isEmpty }

    func quantity(of item: MenuItem) -> Int {
        lines.first { $0.id == item.id }?.quantity ?? 0
    }

    func add(_ item: MenuItem) {
        if let i = lines.firstIndex(where: { $0.id == item.id }) {
            lines[i].quantity = min(20, lines[i].quantity + 1)
        } else {
            lines.append(Line(item: item, quantity: 1))
        }
    }

    func remove(_ item: MenuItem) {
        guard let i = lines.firstIndex(where: { $0.id == item.id }) else { return }
        if lines[i].quantity > 1 { lines[i].quantity -= 1 } else { lines.remove(at: i) }
    }

    func clear() { lines = [] }

    var orderItems: [FoodOrderItemInput] {
        lines.map { FoodOrderItemInput(menuItemId: $0.item.id, quantity: $0.quantity) }
    }
}
