import Foundation

/// Меню ресторана «Лето 2026» — из файла владельца (backend/data/menu-summer-2026.json).
/// Это настоящие блюда и цены; в демо-режиме ненастоящий только сам заказ.
enum DemoMenu {
    private static func dish(_ id: String, _ name: String, _ price: Int, grams: Int?, ml: Int?, note: String?) -> MenuItem {
        MenuItem(id: id, name: name, description: note, weightGrams: grams, volumeMl: ml, price: price,
                 isAvailable: true, photos: [], allergens: [])
    }

    static let categories: [MenuCategory] = [
        MenuCategory(id: "demo-cat-0", name: "Салаты и закуски", items: [
            dish("demo-dish-0-0", "Салат Греческий с авокадо и сыром Белпер Кнолле", 59000, grams: 250, ml: nil, note: nil),
            dish("demo-dish-0-1", "Теплый салат с хрустящими баклажанами и томатами", 59000, grams: 200, ml: nil, note: nil),
            dish("demo-dish-0-2", "Салат Дачный с куриным бедром, свежими овощами и зеленью", 45000, grams: 250, ml: nil, note: nil),
            dish("demo-dish-0-3", "Салат с вяленой свеклой", 45000, grams: 200, ml: nil, note: nil),
            dish("demo-dish-0-4", "Сыры местные: Белпер Кнолле/Марбье/Качотта с пажитником", 95000, grams: 280, ml: nil, note: nil),
            dish("demo-dish-0-5", "Паштет из куриной печени с глинтвейном из вишни", 54000, grams: 160, ml: nil, note: nil),
            dish("demo-dish-0-6", "Тартар из говядины с бородинским хлебом, соленым огурцом и сыром", 95000, grams: 270, ml: nil, note: nil),
        ]),
        MenuCategory(id: "demo-cat-1", name: "К пиву", items: [
            dish("demo-dish-1-0", "Джерки индейка/курица", 39000, grams: 40, ml: nil, note: nil),
            dish("demo-dish-1-1", "Креветки тигровые с чесноком и лимонным айоли", 99000, grams: 200, ml: nil, note: nil),
            dish("demo-dish-1-2", "Крылья куриные в соевом соусе с медом", 49000, grams: 210, ml: nil, note: nil),
        ]),
        MenuCategory(id: "demo-cat-2", name: "Супы", items: [
            dish("demo-dish-2-0", "Окрошка «из СССР» с колбасой, жгучей горчицей и сметаной", 49000, grams: nil, ml: 350, note: nil),
            dish("demo-dish-2-1", "Солянка мясная наваристая", 64000, grams: nil, ml: 350, note: nil),
            dish("demo-dish-2-2", "Рыбный домашний суп из судака и местной рыбы", 64000, grams: nil, ml: 350, note: nil),
        ]),
        MenuCategory(id: "demo-cat-3", name: "Горячее", items: [
            dish("demo-dish-3-0", "Бифштекс из говядины с яйцом пашот и картофельным пюре", 79000, grams: 400, ml: nil, note: nil),
            dish("demo-dish-3-1", "Котлета из щуки, чиненая сыром с пюре из тыквы и картофеля", 79000, grams: 350, ml: nil, note: nil),
            dish("demo-dish-3-2", "Филе судака с запеченным картофелем", 76000, grams: 250, ml: nil, note: nil),
            dish("demo-dish-3-3", "Плов из мраморной говядины со свежими овощами", 55000, grams: 350, ml: nil, note: nil),
            dish("demo-dish-3-4", "Ребро быка в соусе BBQ с картофельным пюре и трюфельным маслом", 139000, grams: 360, ml: nil, note: nil),
        ]),
        MenuCategory(id: "demo-cat-4", name: "Гарниры", items: [
            dish("demo-dish-4-0", "Батат фри с пармезаном", 35000, grams: 200, ml: nil, note: nil),
            dish("demo-dish-4-1", "Брокколи в ореховом соусе", 35000, grams: 250, ml: nil, note: nil),
            dish("demo-dish-4-2", "Картофель фри", 35000, grams: 250, ml: nil, note: nil),
        ]),
        MenuCategory(id: "demo-cat-5", name: "Паста", items: [
            dish("demo-dish-5-0", "Паста «Качо э пепе»", 79000, grams: 200, ml: nil, note: nil),
            dish("demo-dish-5-1", "Спагетти «Карбонара»", 79000, grams: 210, ml: nil, note: nil),
            dish("demo-dish-5-2", "Паста с брокколи и креветками", 82000, grams: 150, ml: nil, note: nil),
        ]),
        MenuCategory(id: "demo-cat-6", name: "Римская пицца", items: [
            dish("demo-dish-6-0", "Пицца пепперони", 73000, grams: 400, ml: nil, note: nil),
            dish("demo-dish-6-1", "Пицца маргарита", 65000, grams: 400, ml: nil, note: nil),
            dish("demo-dish-6-2", "Лепешка с розмарином и пармезаном", 49000, grams: 290, ml: nil, note: nil),
            dish("demo-dish-6-3", "Хрустящая сырная лепешка", 45000, grams: 290, ml: nil, note: nil),
        ]),
        MenuCategory(id: "demo-cat-7", name: "Хоспер", items: [
            dish("demo-dish-7-0", "Стейк Рибай", 110000, grams: 100, ml: nil, note: "Цена за 100 г"),
            dish("demo-dish-7-1", "Шашлык из говядины", 110000, grams: 100, ml: nil, note: "Цена за 100 г"),
            dish("demo-dish-7-2", "Шашлык из говяжьего языка с маринованным луком и соленым огурцом", 124000, grams: 350, ml: nil, note: nil),
            dish("demo-dish-7-3", "Шашлык из куриного бедра со свежими овощами", 79000, grams: 350, ml: nil, note: nil),
            dish("demo-dish-7-4", "Овощи гриль", 39000, grams: 150, ml: nil, note: nil),
            dish("demo-dish-7-5", "Авокадо на гриле", 64000, grams: 150, ml: nil, note: nil),
        ]),
        MenuCategory(id: "demo-cat-8", name: "Десерты", items: [
            dish("demo-dish-8-0", "Басский чизкейк", 48000, grams: 200, ml: nil, note: nil),
            dish("demo-dish-8-1", "Карабашский черничный пирог", 48000, grams: 230, ml: nil, note: nil),
            dish("demo-dish-8-2", "Мороженное в ассортименте", 20000, grams: 70, ml: nil, note: nil),
        ]),
    ]
}
