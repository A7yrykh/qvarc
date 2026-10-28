import Foundation

/// Тексты нового каркаса: «Mi expediente», дни, отсутствия, полная версия. Старые экраны — в UIText.swift (S).
enum W {
    static let appName = LText("Residente")
    static let home = LText(es: "Mi expediente", en: "My file", ru: "Моё досье", uk: "Моє досьє")
    static let settings = LText(es: "Ajustes", en: "Settings", ru: "Настройки", uk: "Налаштування")

    // Карточки главного экрана
    static let residence = LText(es: "Tu residencia", en: "Your residence", ru: "Ваш ВНЖ", uk: "Ваша посвідка")
    static let validUntil = LText(es: "Válida hasta el %@", en: "Valid until %@", ru: "Действует до %@", uk: "Дійсна до %@")
    static let noResidenceDoc = LText(es: "Guarda tu TIE o certificado UE y vigilaremos la renovación.",
                                      en: "Save your TIE or EU certificate and we'll watch the renewal for you.",
                                      ru: "Сохраните TIE или сертификат ЕС — мы будем следить за продлением.",
                                      uk: "Збережіть TIE або сертифікат ЄС — ми стежитимемо за продовженням.")
    static let addResidenceDoc = LText(es: "Añadir mi TIE", en: "Add my TIE", ru: "Добавить TIE", uk: "Додати TIE")
    static let daysInSpainYear = LText(es: "Días en España en %d", en: "Days in Spain in %d", ru: "Дней в Испании в %d", uk: "Днів в Іспанії в %d")
    static let of183 = LText(es: "de 183 para la residencia fiscal", en: "of 183 for tax residency",
                             ru: "из 183 для налогового резидентства", uk: "із 183 для податкового резидентства")
    static let taxResident = LText(es: "Este año eres residente fiscal en España.", en: "You are a Spanish tax resident this year.",
                                   ru: "В этом году вы налоговый резидент Испании.", uk: "Цього року ви податковий резидент Іспанії.")
    static let schengenAbroad = LText(es: "Schengen fuera de España", en: "Schengen outside Spain", ru: "Шенген за пределами Испании", uk: "Шенген поза Іспанією")
    static let schengenVisitor = LText(es: "Schengen 90/180", en: "Schengen 90/180", ru: "Шенген 90/180", uk: "Шенген 90/180")
    static let daysLeftOf90 = LText(es: "%d días libres de 90", en: "%d of 90 days left", ru: "Свободно %d из 90 дней", uk: "Вільно %d із 90 днів")
    static let nextSteps = LText(es: "Lo siguiente", en: "Coming up", ru: "Дальше по плану", uk: "Далі за планом")
    static let nothingNext = LText(es: "Nada urgente. Te avisaremos cuando toque algo.", en: "Nothing urgent. We'll tell you when something is due.",
                                   ru: "Ничего срочного. Мы напомним, когда что-то подойдёт.", uk: "Нічого термінового. Ми нагадаємо, коли щось наблизиться.")
    static let papers = LText(es: "Papeles", en: "Paperwork", ru: "Бумаги", uk: "Папери")
    static let papersHint = LText(es: "NIE, TIE, padrón, renovación, certificado digital", en: "NIE, TIE, padrón, renewal, digital certificate",
                                  ru: "NIE, TIE, padrón, продление, цифровая подпись", uk: "NIE, TIE, padrón, продовження, цифровий підпис")
    static let vault = LText(es: "Bóveda", en: "Vault", ru: "Сейф", uk: "Сейф")
    static let vaultHint = LText(es: "Documentos escaneados, cifrados en el iPhone", en: "Scanned documents, encrypted on your iPhone",
                                 ru: "Сканы документов, зашифрованы на iPhone", uk: "Скани документів, зашифровані на iPhone")
    static let days = LText(es: "Días", en: "Days", ru: "Дни", uk: "Дні")
    static let daysHint = LText(es: "Viajes, 183 días, Schengen y ausencias", en: "Trips, 183 days, Schengen and absences",
                                ru: "Поездки, 183 дня, Шенген и отсутствия", uk: "Поїздки, 183 дні, Шенген і відсутності")
    static let canITravel = LText(es: "¿Puedo viajar?", en: "Can I travel?", ru: "Можно ли поехать?", uk: "Чи можна поїхати?")

    // Дни
    static let myTrips = LText(es: "Mis viajes", en: "My trips", ru: "Мои поездки", uk: "Мої поїздки")
    static let noTrips = LText(es: "Apunta los viajes fuera de España: salida y vuelta. El resto de días cuentan como días en España.",
                               en: "Log your trips outside Spain: departure and return. All other days count as days in Spain.",
                               ru: "Записывайте поездки за пределы Испании: выезд и возвращение. Остальные дни считаются днями в Испании.",
                               uk: "Записуйте поїздки за межі Іспанії: виїзд і повернення. Решта днів вважаються днями в Іспанії.")
    static let noStaysVisitor = LText(es: "Apunta cada estancia, también en España: entrada y salida.",
                                      en: "Log every stay, including in Spain: entry and exit.",
                                      ru: "Записывайте каждое пребывание, в том числе в Испании: въезд и выезд.",
                                      uk: "Записуйте кожне перебування, зокрема в Іспанії: в'їзд і виїзд.")
    static let addTrip = LText(es: "Añadir viaje", en: "Add trip", ru: "Добавить поездку", uk: "Додати поїздку")
    static let country = LText(es: "País", en: "Country", ru: "Страна", uk: "Країна")
    static let departure = LText(es: "Salida", en: "Departure", ru: "Выезд", uk: "Виїзд")
    static let comeback = LText(es: "Vuelta", en: "Return", ru: "Возвращение", uk: "Повернення")
    static let stillThere = LText(es: "Sigo allí", en: "Still there", ru: "Я ещё там", uk: "Я ще там")
    static let note = LText(es: "Nota", en: "Note", ru: "Заметка", uk: "Нотатка")
    static let daysCount = LText(es: "%d días", en: "%d days", ru: "%d дн.", uk: "%d дн.")
    static let auto = LText(es: "Automático", en: "Automatic", ru: "Автоматически", uk: "Автоматично")
    static let iLiveHere = LText(es: "Vivo en España con residencia", en: "I live in Spain with a residence permit",
                                 ru: "Живу в Испании с ВНЖ", uk: "Живу в Іспанії з посвідкою")
    static let iLiveHereHint = LText(es: "Si no, contamos cada estancia como visitante (90/180 también en España).",
                                     en: "If not, we count every stay as a visitor (90/180 applies in Spain too).",
                                     ru: "Если нет, считаем каждое пребывание как у туриста (90/180 действует и в Испании).",
                                     uk: "Якщо ні, рахуємо кожне перебування як у туриста (90/180 діє й в Іспанії).")
    static let residenceSince = LText(es: "Residencia legal desde", en: "Legal residence since", ru: "Законно проживаю с", uk: "Законно проживаю з")
    static let tripCheck = LText(es: "Comprobar un viaje", en: "Check a trip", ru: "Проверить поездку", uk: "Перевірити поїздку")
    static let tripOK = LText(es: "Puedes hacer este viaje.", en: "You can make this trip.", ru: "Эта поездка возможна.", uk: "Ця поїздка можлива.")
    static let tripBreaksSchengen = LText(es: "Superarías los 90 días de Schengen el %@.", en: "You would exceed 90 Schengen days on %@.",
                                          ru: "Вы превысите 90 дней Шенгена %@.", uk: "Ви перевищите 90 днів Шенгену %@.")
    static let tripBreaksAbsence = LText(es: "Con este viaje superarías el límite de ausencias para %@.",
                                         en: "This trip would break the absence limit for %@.",
                                         ru: "Эта поездка нарушит лимит отсутствий для: %@.",
                                         uk: "Ця поїздка порушить ліміт відсутностей для: %@.")
    static let latestReturn = LText(es: "Vuelve como muy tarde el %@.", en: "Come back by %@ at the latest.",
                                    ru: "Вернитесь не позже %@.", uk: "Поверніться не пізніше %@.")
    static let autoTracking = LText(es: "Registro automático por ubicación", en: "Automatic logging by location",
                                    ru: "Автоучёт по геопозиции", uk: "Автооблік за геопозицією")
    static let autoTrackingHint = LText(
        es: "El iPhone solo detecta el país al cambiar de zona (antenas, no GPS). No guardamos coordenadas ni salen del teléfono.",
        en: "Your iPhone only detects the country when you move between areas (cell towers, not GPS). Coordinates are never stored or sent.",
        ru: "iPhone определяет только страну при смене зоны (вышки связи, не GPS). Координаты не сохраняются и не покидают телефон.",
        uk: "iPhone визначає лише країну під час зміни зони (вежі зв'язку, не GPS). Координати не зберігаються й не залишають телефон.")
    static let exportPDF = LText(es: "Informe PDF", en: "PDF report", ru: "Отчёт PDF", uk: "Звіт PDF")
    static let exportCSV = LText(es: "Tabla CSV", en: "CSV table", ru: "Таблица CSV", uk: "Таблиця CSV")
    static let counters = LText(es: "Recuento", en: "Totals", ru: "Подсчёт", uk: "Підрахунок")

    // Отсутствия
    static let absences = LText(es: "Ausencias de España", en: "Time away from Spain", ru: "Отсутствие в Испании", uk: "Відсутність в Іспанії")
    static let absenceRule = LText(es: "Comprobar para", en: "Check for", ru: "Проверять для", uk: "Перевіряти для")
    static let longestAbsence = LText(es: "Ausencia más larga", en: "Longest absence", ru: "Самое долгое отсутствие", uk: "Найдовша відсутність")
    static let totalAbsence = LText(es: "Total de ausencias", en: "Total time away", ru: "Всего отсутствий", uk: "Усього відсутностей")
    static let absenceInYear = LText(es: "Ausencias, año %d", en: "Time away, year %d", ru: "Отсутствия, год %d", uk: "Відсутності, рік %d")
    static let daysInSpainPermitYear = LText(es: "Días en España, año %d", en: "Days in Spain, year %d", ru: "Дней в Испании, год %d", uk: "Днів в Іспанії, рік %d")
    static let valueOfLimit = LText(es: "%d de %d días", en: "%d of %d days", ru: "%d из %d дн.", uk: "%d із %d дн.")
    static let statusOK = LText(es: "En regla", en: "On track", ru: "В порядке", uk: "Усе гаразд")
    static let statusClose = LText(es: "Cerca del límite", en: "Close to the limit", ru: "Близко к лимиту", uk: "Близько до ліміту")
    static let statusBroken = LText(es: "Límite superado", en: "Limit exceeded", ru: "Лимит превышен", uk: "Ліміт перевищено")
    static let setResidenceStart = LText(es: "Indica desde cuándo resides legalmente para comprobar tus ausencias.",
                                         en: "Set the date your legal residence started to check your time away.",
                                         ru: "Укажите, с какой даты вы законно проживаете, чтобы проверить отсутствия.",
                                         uk: "Укажіть, з якої дати ви законно проживаєте, щоб перевірити відсутності.")
    static let absenceDisclaimer = LText(
        es: "Orientativo. Contamos los meses como 30 días para avisar antes. Los días de salida y de vuelta cuentan como días en España. Confirma tu caso en la oficina de extranjería.",
        en: "For guidance only. We count a month as 30 days to warn you early. Departure and return days count as days in Spain. Confirm your case with the immigration office.",
        ru: "Ориентировочно. Месяц считаем за 30 дней, чтобы предупредить заранее. Дни выезда и возвращения считаются днями в Испании. Уточните свой случай в extranjería.",
        uk: "Орієнтовно. Місяць рахуємо як 30 днів, щоб попередити заздалегідь. Дні виїзду й повернення вважаються днями в Іспанії. Уточніть свій випадок в extranjería.")

    static func title(_ rule: AbsenceRule) -> LText {
        switch rule {
        case .longTerm: return LText(es: "Residencia de larga duración", en: "Long-term residence", ru: "Долгосрочный ВНЖ (larga duración)", uk: "Довгострокова посвідка (larga duración)")
        case .nonLucrativeRenewal: return LText(es: "Renovar la no lucrativa", en: "Renew non-lucrative residence", ru: "Продление no lucrativa", uk: "Продовження no lucrativa")
        case .euPermanent: return LText(es: "Residencia permanente UE", en: "EU permanent residence", ru: "Постоянное проживание (ЕС)", uk: "Постійне проживання (ЄС)")
        }
    }

    static func rule(_ rule: AbsenceRule) -> LText {
        switch rule {
        case .longTerm: return LText(
            es: "5 años seguidos: ninguna ausencia de más de 6 meses y no más de 10 meses en total.",
            en: "5 years in a row: no absence over 6 months and no more than 10 months in total.",
            ru: "5 лет подряд: ни одного отсутствия дольше 6 месяцев и не больше 10 месяцев всего.",
            uk: "5 років поспіль: жодної відсутності понад 6 місяців і не більше 10 місяців загалом.")
        case .nonLucrativeRenewal: return LText(
            es: "Al menos 183 días en España en cada año de la autorización (RD 1155/2024).",
            en: "At least 183 days in Spain in each year of the permit (RD 1155/2024).",
            ru: "Не меньше 183 дней в Испании за каждый год разрешения (RD 1155/2024).",
            uk: "Не менше 183 днів в Іспанії за кожен рік дозволу (RD 1155/2024).")
        case .euPermanent: return LText(
            es: "5 años seguidos sin ausencias de más de 6 meses al año (RD 240/2007, art. 10).",
            en: "5 years in a row without more than 6 months away per year (RD 240/2007, art. 10).",
            ru: "5 лет подряд без отсутствий больше 6 месяцев в году (RD 240/2007, ст. 10).",
            uk: "5 років поспіль без відсутностей понад 6 місяців на рік (RD 240/2007, ст. 10).")
        }
    }

    static func status(_ s: AbsenceCheck.Status) -> LText {
        switch s {
        case .ok: return statusOK
        case .close: return statusClose
        case .broken: return statusBroken
        }
    }

    // Полная версия
    static let full = LText(es: "Residente completo", en: "Residente complete", ru: "Residente полностью", uk: "Residente повністю")
    static let fullSubtitle = LText(es: "Un pago y es tuyo. Sin suscripción.", en: "Pay once, keep it. No subscription.",
                                    ru: "Один платёж — и навсегда. Без подписки.", uk: "Один платіж — і назавжди. Без підписки.")
    static let fullFeatures = [
        (symbol: "square.stack.3d.up", text: LText(es: "Todos los trámites a la vez", en: "All procedures at once", ru: "Все трамиты одновременно", uk: "Усі процедури одночасно")),
        (symbol: "lock.doc", text: LText(es: "Bóveda sin límite de documentos", en: "Unlimited documents in the vault", ru: "Сейф без лимита документов", uk: "Сейф без ліміту документів")),
        (symbol: "location.circle", text: LText(es: "Registro automático de países", en: "Automatic country logging", ru: "Автоучёт стран", uk: "Автооблік країн")),
        (symbol: "calendar.badge.exclamationmark", text: LText(es: "Control de ausencias para renovar y larga duración", en: "Absence checks for renewal and long-term residence", ru: "Контроль отсутствий для продления и larga duración", uk: "Контроль відсутностей для продовження й larga duración")),
        (symbol: "doc.richtext", text: LText(es: "Informes PDF y CSV de tus días", en: "PDF and CSV reports of your days", ru: "Отчёты PDF и CSV по дням", uk: "Звіти PDF і CSV за днями")),
    ]
    static let limitFull = LText(es: "Esta función forma parte de Residente completo.", en: "This feature is part of Residente complete.",
                                 ru: "Эта функция входит в полную версию Residente.", uk: "Ця функція входить до повної версії Residente.")
    static let fullActive = LText(es: "Tienes Residente completo. ¡Gracias!", en: "You have Residente complete. Thank you!",
                                  ru: "У вас полная версия Residente. Спасибо!", uk: "У вас повна версія Residente. Дякуємо!")
    static let seeWhatsIncluded = LText(es: "Ver qué incluye", en: "See what's included", ru: "Что входит", uk: "Що входить")

    // Первый запуск
    static let setupTitle = LText(es: "Tu punto de partida", en: "Where you're starting from", ru: "С чего начинаем", uk: "З чого починаємо")
    static let setupHint = LText(es: "Con esto preparamos tu expediente. Puedes cambiarlo luego en Ajustes.",
                                 en: "We'll set up your file from this. You can change it later in Settings.",
                                 ru: "По этим ответам соберём ваше досье. Потом можно изменить в настройках.",
                                 uk: "За цими відповідями зберемо ваше досьє. Потім можна змінити в налаштуваннях.")
    static let residenceStartQuestion = LText(es: "¿Desde cuándo resides legalmente en España?", en: "Since when have you lived legally in Spain?",
                                              ru: "С какой даты вы законно живёте в Испании?", uk: "З якої дати ви законно живете в Іспанії?")
    static let notYet = LText(es: "Aún no tengo residencia", en: "I don't have residence yet", ru: "ВНЖ ещё нет", uk: "Посвідки ще немає")
    static let start = LText(es: "Abrir mi expediente", en: "Open my file", ru: "Открыть досье", uk: "Відкрити досьє")
}
