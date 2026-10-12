import Foundation

/// Сведения о базе и типы размещения — с сайта базы (backend/data/property-kvarc.json).
/// Это настоящие данные; в демо-режиме приложение показывает их без сервера.
enum DemoProperty {
    static let info = PropertyInfo(
        name: "Кварц",
        address: "Челябинская область, Карабаш, озеро Увильды",
        about: "Семейная база отдыха на берегу озера Увильды в спокойном скандинавском стиле.",
        phones: ["+79085870030", "+73512150030"],
        email: "qvarc74@yandex.ru",
        bookingUrl: "https://qvarc-uvildy.ru/?tl-booking-open=true",
        checkInTime: "17:00",
        checkOutTime: "14:00",
        facilities: ["Ресторан с кухней и баром", "Живой лес", "Зона костра", "Понтон на воде", "Новая детская площадка", "Прокат сапов и катамаранов", "Прокат велосипедов"],
        faq: [
            FAQItem(q: "Что входит в стоимость?", a: "Ежедневный континентальный завтрак с 09:00 до 11:00 для каждого гостя по брони и регулярная уборка."),
            FAQItem(q: "Когда заезд и выезд?", a: "Заезд после 17:00, выезд до 14:00. До заезда и после выезда можно бесплатно находиться на территории."),
            FAQItem(q: "Какие документы нужны?", a: "Документ с фото на каждого гостя, включая детей. Детям, вписанным в паспорт родителя, отдельный документ не нужен."),
            FAQItem(q: "Можно с животными?", a: "Нет, с животными нельзя."),
            FAQItem(q: "Можно свой мангал?", a: "Нет. Свои мангалы запрещены, мангальных зон на территории нет."),
            FAQItem(q: "Где можно курить?", a: "Только в отведённых местах. Кальян — только в зоне костра."),
            FAQItem(q: "Что ещё запрещено?", a: "Свои электроприборы, открытый огонь и фейерверки."),
            FAQItem(q: "Сколько стоит проживание детей?", a: "Дети до 7 лет без отдельного места и завтрака — бесплатно. Если ребёнок на основном месте, завтрак бесплатный. Завтрак для ребёнка без основного места — за доплату."),
            FAQItem(q: "Как отменить бронь?", a: "Больше чем за 24 часа до заезда — полный возврат, можно перенести даты. Меньше чем за 24 часа — удерживается стоимость первой ночи."),
            FAQItem(q: "Есть парковка?", a: "Да, бесплатная, две площадки, места по наличию при заезде."),
            FAQItem(q: "Можно купаться?", a: "Понтон оборудован как пляж, но официально купание запрещено. Спасателей нет: соблюдайте правила на воде и следите за детьми."),
        ],
        unitTypes: types
    )

    private static let types: [UnitType] = [
        UnitType(
            id: "demo-type-standart", code: "standart", name: "Стандарт", summary: "Уютный комфортный номер для двоих. В номере спальня с удобной кроватью, ванная комната с душем и туалетом, а также отдельная панорамная входная группа с видом на территорию и лес.",
            capacity: 2, bedrooms: 1,
            amenities: ["Спальня с удобной кроватью", "Ванная комната с душем и туалетом", "Отдельная панорамная входная группа с видом на территорию и лес"],
            photos: [
                UnitPhoto(file: "standart-01.webp", caption: "Стандарт — фото 1", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114759.webp"),
                UnitPhoto(file: "standart-02.webp", caption: "Стандарт — фото 2", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114802.webp"),
                UnitPhoto(file: "standart-03.webp", caption: "Стандарт — фото 3", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114803.webp"),
                UnitPhoto(file: "standart-04.webp", caption: "Стандарт — фото 4", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114801.webp"),
            ],
            externalId: "351030"
        ),
        UnitType(
            id: "demo-type-komfort", code: "komfort", name: "Комфорт", summary: "Уютный комфортный номер для двоих с террасой. В номере спальня с удобной кроватью, ванная комната с душем и туалетом, а также отдельная панорамная входная группа с террасой и видом на территорию и лес.",
            capacity: 2, bedrooms: 1,
            amenities: ["Своя терраса", "Спальня с удобной кроватью", "Ванная комната с душем и туалетом", "Отдельная панорамная входная группа с террасой и видом на территорию и лес"],
            photos: [
                UnitPhoto(file: "komfort-01.webp", caption: "Комфорт — фото 1", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_115134.webp"),
                UnitPhoto(file: "komfort-02.webp", caption: "Комфорт — фото 2", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_115135.webp"),
                UnitPhoto(file: "komfort-03.webp", caption: "Комфорт — фото 3", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_115136.webp"),
                UnitPhoto(file: "komfort-04.webp", caption: "Комфорт — фото 4", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_115137.webp"),
            ],
            externalId: "351031"
        ),
        UnitType(
            id: "demo-type-apartamenty", code: "apartamenty", name: "Апартаменты", summary: "Просторные и уютные двухэтажные апартаменты для 4 гостей. Оснащены всем необходимым для комфортного проживания: кухней, двумя спальнями, ванной комнатой, гостиной и панорамным остеклением с видом на территорию и лес.",
            capacity: 4, bedrooms: 2,
            amenities: ["Два этажа", "Кухня", "Две спальни", "Гостиная", "Ванная комната", "Панорамное остекление с видом на территорию и лес"],
            photos: [
                UnitPhoto(file: "apartamenty-01.webp", caption: "Апартаменты — фото 1", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114700.webp"),
                UnitPhoto(file: "apartamenty-02.webp", caption: "Апартаменты — фото 2", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114701.webp"),
                UnitPhoto(file: "apartamenty-03.webp", caption: "Апартаменты — фото 3", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114702.webp"),
                UnitPhoto(file: "apartamenty-04.webp", caption: "Апартаменты — фото 4", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114703.webp"),
            ],
            externalId: "351039"
        ),
        UnitType(
            id: "demo-type-semeynyy-kottedzh", code: "semeynyy-kottedzh", name: "Семейный коттедж", summary: "Уютный загородный дом, идеально подходящий для семейного отдыха. Есть всё необходимое для комфортного проживания: кухня, 2 спальни, ванная комната с душем, гостиная.",
            capacity: nil, bedrooms: 2,
            amenities: ["Отдельный дом", "Кухня", "Две спальни", "Гостиная", "Ванная комната с душем"],
            photos: [
                UnitPhoto(file: "semeynyy-kottedzh-01.png", caption: "Семейный коттедж — фото 1", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114515.png"),
                UnitPhoto(file: "semeynyy-kottedzh-02.webp", caption: "Семейный коттедж — фото 2", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114519.webp"),
                UnitPhoto(file: "semeynyy-kottedzh-03.webp", caption: "Семейный коттедж — фото 3", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114521.webp"),
                UnitPhoto(file: "semeynyy-kottedzh-04.webp", caption: "Семейный коттедж — фото 4", url: "https://qvarc-uvildy.ru/wp-content/uploads/2026/06/IMG_20260610_114555.webp"),
            ],
            externalId: "351040"
        ),
    ]
}
