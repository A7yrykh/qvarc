/**
 * Соседи на Увильдах, которых владелец назвал для сравнения цен.
 * Открытые страницы соседей, проверено 14.10.2026: gosti.rest/rooms (цены «от … за ночь», бронирование TravelLine), verthotel.ru (цен нет, бронирование по заявке; цены видны на Островке и Яндекс Путешествиях, их правила запрещают автоматический сбор).
 * typeCode — код нашей категории (data/kvarc-rooms.json); без него категория соседа не сравнивается, пока её не сопоставят в админке.
 */
export interface CompetitorPreset {
  name: string;
  siteUrl: string;
  sourceKind: 'manual' | 'page';
  sourceRef?: string;
  note: string;
  categories: { externalRef: string; name: string; typeCode?: string; factor?: number }[];
}

export const UVILDY_COMPETITORS: CompetitorPreset[] = [
  {
    "name": "Гости",
    "siteUrl": "https://gosti.rest/",
    "sourceKind": "page",
    "sourceRef": "https://gosti.rest/rooms",
    "note": "Загородный комплекс «Гости», Увильды, Курортная 7. На сайте цены «от … за ночь» без дат, питание не включено. Бронирование через TravelLine.",
    "categories": [
      {
        "externalRef": "Standart",
        "name": "Standart",
        "typeCode": "standard"
      },
      {
        "externalRef": "Standart comfort",
        "name": "Standart comfort",
        "typeCode": "comfort"
      },
      {
        "externalRef": "Junior",
        "name": "Junior"
      },
      {
        "externalRef": "Junior семейный",
        "name": "Junior семейный"
      },
      {
        "externalRef": "De Lux",
        "name": "De Lux"
      },
      {
        "externalRef": "Apartment Kitchen",
        "name": "Apartment Kitchen"
      },
      {
        "externalRef": "Lux",
        "name": "Lux",
        "typeCode": "apartments"
      }
    ]
  },
  {
    "name": "Верт",
    "siteUrl": "https://verthotel.ru/",
    "sourceKind": "manual",
    "note": "Vert Landscape Hotel 4*, Красный Камень. На своём сайте цен нет. Цены на даты смотреть на Островке или в Яндекс Путешествиях и вносить вручную. В цену входят завтрак и СПА. Когда на verthotel.ru/booking появится модуль бронирования, можно подключить сбор.",
    "categories": [
      {
        "externalRef": "Standard",
        "name": "Standard",
        "typeCode": "standard"
      },
      {
        "externalRef": "Comfort",
        "name": "Comfort",
        "typeCode": "comfort"
      },
      {
        "externalRef": "Comfort 2-комнатный",
        "name": "Comfort 2-комнатный с балконом",
        "typeCode": "apartments"
      },
      {
        "externalRef": "Deluxe",
        "name": "Deluxe с балконом"
      },
      {
        "externalRef": "Бунгало",
        "name": "Бунгало"
      },
      {
        "externalRef": "Вилла",
        "name": "Вилла с видом на озеро",
        "typeCode": "cottage",
        "factor": 0.8
      }
    ]
  }
];
