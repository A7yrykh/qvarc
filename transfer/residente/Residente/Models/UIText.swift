import SwiftUI

// MARK: - Язык в окружении SwiftUI

private struct LangKey: EnvironmentKey {
    static let defaultValue: Lang = .en
}

extension EnvironmentValues {
    var lang: Lang {
        get { self[LangKey.self] }
        set { self[LangKey.self] = newValue }
    }
}

/// Текст интерфейса. Контент гайдов — в TramitesKit/Catalog.swift.
enum S {
    // Вкладки
    static let tabPlan = LText(es: "Mi plan", en: "My plan", ru: "Мой план", uk: "Мій план")
    static let tabTramites = LText(es: "Trámites", en: "Procedures", ru: "Трамиты", uk: "Процедури")
    static let tabDocuments = LText(es: "Documentos", en: "Documents", ru: "Документы", uk: "Документи")
    static let tabSettings = LText(es: "Ajustes", en: "Settings", ru: "Настройки", uk: "Налаштування")

    // Онбординг
    static let welcomeTitle = LText("Residente")
    static let welcomeSubtitle = LText(es: "Paso a paso, del NIE a la TIE, con todos tus plazos en un sitio.",
                                       en: "Step by step from NIE to TIE, with all your deadlines in one place.",
                                       ru: "Шаг за шагом от NIE до TIE, со всеми сроками в одном месте.", uk: "Крок за кроком від NIE до TIE, з усіма строками в одному місці.")
    static let chooseLanguage = LText(es: "Idioma", en: "Language", ru: "Язык", uk: "Мова")
    static let disclaimerTitle = LText(es: "Antes de empezar", en: "Before you start", ru: "Прежде чем начать", uk: "Перш ніж почати")
    static let disclaimer = LText(
        es: "Esta app no es de la Administración y no ofrece asesoramiento jurídico. Resumimos información oficial y enlazamos siempre a la fuente. Comprueba los requisitos de tu oficina antes de presentar nada.",
        en: "This app is not affiliated with the Spanish government and is not legal advice. We summarise official information and always link to the source. Check your office's requirements before submitting anything.",
        ru: "Приложение не связано с государственными органами Испании и не является юридической консультацией. Мы пересказываем официальную информацию и всегда даём ссылку на источник. Перед подачей проверьте требования вашего офиса.", uk: "Застосунок не пов'язаний з державними органами Іспанії й не є юридичною консультацією. Ми переказуємо офіційну інформацію й завжди даємо посилання на джерело. Перед поданням перевірте вимоги вашого офісу.")
    static let understood = LText(es: "Entendido", en: "Got it", ru: "Понятно", uk: "Зрозуміло")
    static let citizenshipQuestion = LText(es: "¿Eres ciudadano de la UE, EEE o Suiza?", en: "Are you an EU, EEA or Swiss citizen?", ru: "Вы гражданин ЕС, ЕЭЗ или Швейцарии?", uk: "Ви громадянин ЄС, ЄЕЗ або Швейцарії?")
    static let yes = LText(es: "Sí", en: "Yes", ru: "Да", uk: "Так")
    static let no = LText(es: "No", en: "No", ru: "Нет", uk: "Ні")
    static let stageQuestion = LText(es: "¿En qué punto estás?", en: "Where are you now?", ru: "На каком вы этапе?", uk: "На якому ви етапі?")
    static let provinceQuestion = LText(es: "¿En qué provincia vives o vivirás?", en: "Which province do you (or will you) live in?", ru: "В какой провинции вы живёте или будете жить?", uk: "У якій провінції ви живете або житимете?")
    static let province = LText(es: "Provincia", en: "Province", ru: "Провинция", uk: "Провінція")
    static let continueButton = LText(es: "Continuar", en: "Continue", ru: "Продолжить", uk: "Продовжити")
    static let makePlan = LText(es: "Crear mi plan", en: "Create my plan", ru: "Составить мой план", uk: "Скласти мій план")

    // План
    static let nextDeadlines = LText(es: "Próximos plazos", en: "Upcoming deadlines", ru: "Ближайшие сроки", uk: "Найближчі строки")
    static let noDeadlines = LText(es: "Añade tus documentos con fecha de caducidad y te avisaremos a tiempo.",
                                   en: "Add your documents with their expiry date and we will remind you in time.",
                                   ru: "Добавьте документы с датой окончания, и мы вовремя напомним.", uk: "Додайте документи з датою закінчення, і ми вчасно нагадаємо.")
    static let inProgress = LText(es: "En curso", en: "In progress", ru: "В работе", uk: "У роботі")
    static let recommended = LText(es: "Recomendado para ti", en: "Recommended for you", ru: "Рекомендуем вам", uk: "Радимо вам")
    static let finished = LText(es: "Terminados", en: "Done", ru: "Завершены", uk: "Завершені")
    static let citaOn = LText(es: "Cita", en: "Appointment", ru: "Приём", uk: "Прийом")
    static let inDays = LText(es: "en %d días", en: "in %d days", ru: "через %d дн.", uk: "через %d дн.")
    static let today = LText(es: "hoy", en: "today", ru: "сегодня", uk: "сьогодні")
    static let daysAgo = LText(es: "hace %d días", en: "%d days ago", ru: "%d дн. назад", uk: "%d дн. тому")

    // Трамит
    static let who = LText(es: "Quién", en: "Who", ru: "Кому", uk: "Кому")
    static let whereLabel = LText(es: "Dónde", en: "Where", ru: "Где", uk: "Де")
    static let cost = LText(es: "Coste", en: "Cost", ru: "Стоимость", uk: "Вартість")
    static let duration = LText(es: "Plazo de respuesta", en: "Processing time", ru: "Сроки", uk: "Строки")
    static let deadline = LText(es: "Plazo", en: "Deadline", ru: "Срок подачи", uk: "Строк подання")
    static let forms = LText(es: "Formularios y tasas", en: "Forms and fees", ru: "Формы и тасы", uk: "Форми й таси")
    static let documentsNeeded = LText(es: "Documentos que necesitas", en: "Documents you need", ru: "Нужные документы", uk: "Потрібні документи")
    static let steps = LText(es: "Pasos", en: "Steps", ru: "Шаги", uk: "Кроки")
    static let tips = LText(es: "Consejos", en: "Tips", ru: "Советы", uk: "Поради")
    static let sources = LText(es: "Fuentes oficiales", en: "Official sources", ru: "Официальные источники", uk: "Офіційні джерела")
    static let verifiedOn = LText(es: "Revisado el %@", en: "Checked on %@", ru: "Проверено %@", uk: "Перевірено %@")
    static let startTramite = LText(es: "Empezar este trámite", en: "Start this procedure", ru: "Начать этот трамит", uk: "Почати цю процедуру")
    static let myFile = LText(es: "Mi expediente", en: "My file", ru: "Моё дело", uk: "Моя справа")
    static let submittedOn = LText(es: "Presentado el", en: "Submitted on", ru: "Подано", uk: "Подано")
    static let expedienteNumber = LText(es: "Nº de expediente o justificante", en: "File or receipt number", ru: "Номер expediente или квитанции", uk: "Номер expediente або квитанції")
    static let notes = LText(es: "Notas", en: "Notes", ru: "Заметки", uk: "Нотатки")
    static let markFinished = LText(es: "Marcar como terminado", en: "Mark as done", ru: "Отметить как завершённый", uk: "Позначити як завершений")
    static let reopen = LText(es: "Reabrir", en: "Reopen", ru: "Открыть снова", uk: "Відкрити знову")
    static let removeTramite = LText(es: "Quitar de mi plan", en: "Remove from my plan", ru: "Убрать из плана", uk: "Прибрати з плану")
    static let openLink = LText(es: "Abrir", en: "Open", ru: "Открыть", uk: "Відкрити")
    static let fillHelper = LText(es: "Ayuda para rellenar", en: "Filling help", ru: "Помощь с заполнением", uk: "Допомога із заповненням")
    static let mark = LText(es: "Marca", en: "Tick", ru: "Отметить", uk: "Позначити")
    static let amount = LText(es: "Importe", en: "Amount", ru: "Сумма", uk: "Сума")
    static let saveResult = LText(es: "Guardar el documento obtenido", en: "Save the document you got", ru: "Сохранить полученный документ", uk: "Зберегти отриманий документ")

    // Cita
    static let citaHelper = LText(es: "Ayuda con la cita", en: "Appointment help", ru: "Помощь с записью", uk: "Допомога із записом")
    static let serviceToChoose = LText(es: "Trámite que debes elegir en el portal", en: "Service to choose on the portal", ru: "Услуга, которую выбрать на портале", uk: "Послуга, яку обрати на порталі")
    static let copy = LText(es: "Copiar", en: "Copy", ru: "Скопировать", uk: "Скопіювати")
    static let copied = LText(es: "Copiado", en: "Copied", ru: "Скопировано", uk: "Скопійовано")
    static let openPortal = LText(es: "Abrir el portal de cita previa", en: "Open the appointment portal", ru: "Открыть портал записи", uk: "Відкрити портал запису")
    static let openSite = LText(es: "Abrir la web", en: "Open the website", ru: "Открыть сайт", uk: "Відкрити сайт")
    static let searchTownHall = LText(es: "Buscar la web de mi ayuntamiento", en: "Find my town hall's website", ru: "Найти сайт моего ayuntamiento", uk: "Знайти сайт мого ayuntamiento")
    static let chooseProvinceFirst = LText(es: "En el primer paso elige la provincia: %@.", en: "In the first step choose the province: %@.", ru: "На первом шаге выберите провинцию: %@.", uk: "На першому кроці оберіть провінцію: %@.")
    static let citaGeneralTips = [
        LText(es: "Los huecos aparecen de forma irregular: prueba a distintas horas del día y varios días seguidos.",
              en: "Slots appear irregularly: try at different times of day and on several days in a row.",
              ru: "Слоты появляются неравномерно: пробуйте в разное время дня и несколько дней подряд.", uk: "Слоти з'являються нерівномірно: пробуйте в різний час доби й кілька днів поспіль."),
        LText(es: "Si tu provincia no tiene huecos, revisa si el trámite puede presentarse por registro electrónico.",
              en: "If your province has no slots, check whether the procedure can be filed electronically.",
              ru: "Если в провинции нет слотов, проверьте, можно ли подать документы через электронный реестр.", uk: "Якщо в провінції немає слотів, перевірте, чи можна подати документи через електронний реєстр."),
        LText(es: "Ten a mano tu NIE o pasaporte, nombre completo, nacionalidad, teléfono y email: el formulario caduca rápido.",
              en: "Keep your NIE or passport, full name, nationality, phone and email ready: the form times out quickly.",
              ru: "Держите под рукой NIE или паспорт, полное имя, гражданство, телефон и e-mail: форма быстро закрывается по времени.", uk: "Тримайте під рукою NIE або паспорт, повне ім'я, громадянство, телефон і e-mail: форма швидко закривається за часом."),
    ]
    static let resellWarning = LText(
        es: "Las citas son gratuitas. No pagues a nadie por «conseguirte» una: la reventa de citas es un fraude habitual.",
        en: "Appointments are free. Do not pay anyone to «get» you one: reselling appointments is a common scam.",
        ru: "Запись бесплатная. Не платите никому за «добычу» слота: перепродажа записей — частое мошенничество.", uk: "Запис безкоштовний. Не платіть нікому за «здобуття» слота: перепродаж записів — часте шахрайство.")
    static let attemptsLog = LText(es: "Mis intentos", en: "My attempts", ru: "Мои попытки", uk: "Мої спроби")
    static let logAttempt = LText(es: "Apuntar un intento", en: "Log an attempt", ru: "Записать попытку", uk: "Записати спробу")
    static let attemptsCount = LText(es: "%d intentos", en: "%d attempts", ru: "Попыток: %d", uk: "Спроб: %d")
    static let gotCita = LText(es: "Tengo cita", en: "I have an appointment", ru: "Запись есть", uk: "Запис є")
    static let citaDate = LText(es: "Fecha y hora", en: "Date and time", ru: "Дата и время", uk: "Дата й час")
    static let citaPlace = LText(es: "Lugar (oficina, dirección)", en: "Place (office, address)", ru: "Место (офис, адрес)", uk: "Місце (офіс, адреса)")
    static let removeCita = LText(es: "Quitar la cita", en: "Remove appointment", ru: "Убрать запись", uk: "Прибрати запис")
    static let bringList = LText(es: "Qué llevar", en: "What to bring", ru: "Что взять с собой", uk: "Що взяти з собою")

    // Формы
    static let personalData = LText(es: "Mis datos", en: "My details", ru: "Мои данные", uk: "Мої дані")
    static let personalDataHint = LText(es: "Se guardan solo en este iPhone. Sirven para rellenar los formularios.",
                                        en: "Stored only on this iPhone. Used to help you fill in the forms.",
                                        ru: "Хранятся только на этом iPhone. Нужны, чтобы помочь заполнить формы.", uk: "Зберігаються лише на цьому iPhone. Потрібні, щоб допомогти заповнити форми.")
    static let editData = LText(es: "Editar mis datos", en: "Edit my details", ru: "Изменить мои данные", uk: "Змінити мої дані")
    static let formIntro = LText(es: "Copia cada dato en la casilla con el mismo nombre del formulario oficial.",
                                 en: "Copy each value into the box with the same name on the official form.",
                                 ru: "Скопируйте каждое значение в графу с таким же названием в официальной форме.", uk: "Скопіюйте кожне значення в графу з такою ж назвою в офіційній формі.")
    static let emptyValue = LText(es: "Sin rellenar", en: "Not filled", ru: "Не заполнено", uk: "Не заповнено")
    static let downloadForm = LText(es: "Descargar el formulario oficial", en: "Download the official form", ru: "Скачать официальную форму", uk: "Завантажити офіційну форму")
    static let payTasa = LText(es: "Rellenar la tasa en la web de la Policía", en: "Fill in the fee on the Police website", ru: "Заполнить тасу на сайте полиции", uk: "Заповнити тасу на сайті поліції")
    static let tasaSteps = LText(
        es: "1. Abre el impreso online y marca el trámite indicado arriba.\n2. Copia tus datos de identificación.\n3. Elige pago en efectivo (imprime y paga en un banco) o pago electrónico.\n4. Guarda el justificante y llévalo a la cita.",
        en: "1. Open the online form and tick the item shown above.\n2. Copy your identification details.\n3. Choose cash payment (print and pay at a bank) or electronic payment.\n4. Keep the receipt and bring it to the appointment.",
        ru: "1. Откройте онлайн-бланк и отметьте пункт, указанный выше.\n2. Скопируйте свои данные.\n3. Выберите оплату наличными (распечатать и оплатить в банке) или электронную оплату.\n4. Сохраните квитанцию и возьмите на приём.", uk: "1. Відкрийте онлайн-бланк і позначте пункт, указаний вище.\n2. Скопіюйте свої дані.\n3. Оберіть оплату готівкою (роздрукувати й сплатити в банку) або електронну оплату.\n4. Збережіть квитанцію й візьміть на прийом.")
    static let givenName = LText(es: "Nombre", en: "First name", ru: "Имя", uk: "Ім'я")
    static let surname1 = LText(es: "Primer apellido", en: "Surname", ru: "Фамилия", uk: "Прізвище")
    static let surname2 = LText(es: "Segundo apellido", en: "Second surname", ru: "Вторая фамилия", uk: "Друге прізвище")
    static let passport = LText(es: "Pasaporte", en: "Passport", ru: "Паспорт", uk: "Паспорт")
    static let sex = LText(es: "Sexo", en: "Sex", ru: "Пол", uk: "Стать")
    static let birthDate = LText(es: "Fecha de nacimiento", en: "Date of birth", ru: "Дата рождения", uk: "Дата народження")
    static let birthPlace = LText(es: "Lugar de nacimiento", en: "Place of birth", ru: "Место рождения", uk: "Місце народження")
    static let birthCountry = LText(es: "País de nacimiento", en: "Country of birth", ru: "Страна рождения", uk: "Країна народження")
    static let nationality = LText(es: "Nacionalidad", en: "Nationality", ru: "Гражданство", uk: "Громадянство")
    static let maritalStatus = LText(es: "Estado civil", en: "Marital status", ru: "Семейное положение", uk: "Сімейний стан")
    static let father = LText(es: "Nombre del padre", en: "Father's name", ru: "Имя отца", uk: "Ім'я батька")
    static let mother = LText(es: "Nombre de la madre", en: "Mother's name", ru: "Имя матери", uk: "Ім'я матері")
    static let addressInSpain = LText(es: "Domicilio en España", en: "Address in Spain", ru: "Адрес в Испании", uk: "Адреса в Іспанії")
    static let street = LText(es: "Calle", en: "Street", ru: "Улица", uk: "Вулиця")
    static let number = LText(es: "Número", en: "Number", ru: "Дом", uk: "Будинок")
    static let floor = LText(es: "Piso / puerta", en: "Floor / door", ru: "Этаж / квартира", uk: "Поверх / квартира")
    static let city = LText(es: "Localidad", en: "Town", ru: "Населённый пункт", uk: "Населений пункт")
    static let postalCode = LText(es: "Código postal", en: "Postcode", ru: "Индекс", uk: "Індекс")
    static let contact = LText(es: "Contacto", en: "Contact", ru: "Контакты", uk: "Контакти")
    static let phone = LText(es: "Teléfono", en: "Phone", ru: "Телефон", uk: "Телефон")
    static let identity = LText(es: "Identidad", en: "Identity", ru: "Личность", uk: "Особа")
    static let notSet = LText(es: "Sin indicar", en: "Not set", ru: "Не указано", uk: "Не вказано")
    static let invalidNIE = LText(es: "La letra de control no coincide.", en: "The check letter does not match.", ru: "Контрольная буква не совпадает.", uk: "Контрольна літера не збігається.")

    // Документы
    static let emptyDocuments = LText(es: "Escanea tu pasaporte, TIE o NIE. Leeremos la fecha de caducidad y te avisaremos antes.",
                                      en: "Scan your passport, TIE or NIE. We read the expiry date and remind you in advance.",
                                      ru: "Отсканируйте паспорт, TIE или NIE. Мы распознаем дату окончания и заранее напомним.", uk: "Відскануйте паспорт, TIE або NIE. Ми розпізнаємо дату закінчення й заздалегідь нагадаємо.")
    static let scan = LText(es: "Escanear", en: "Scan", ru: "Сканировать", uk: "Сканувати")
    static let fromPhotos = LText(es: "Desde Fotos", en: "From Photos", ru: "Из фото", uk: "З фото")
    static let addDocument = LText(es: "Añadir documento", en: "Add document", ru: "Добавить документ", uk: "Додати документ")
    static let documentType = LText(es: "Tipo", en: "Type", ru: "Тип", uk: "Тип")
    static let documentTitle = LText(es: "Nombre", en: "Name", ru: "Название", uk: "Назва")
    static let expiry = LText(es: "Caduca", en: "Expires", ru: "Действует до", uk: "Дійсний до")
    static let issued = LText(es: "Expedido", en: "Issued", ru: "Выдан", uk: "Виданий")
    static let hasExpiry = LText(es: "Tiene fecha de caducidad", en: "Has an expiry date", ru: "Есть дата окончания", uk: "Є дата закінчення")
    static let hasIssue = LText(es: "Indicar fecha de expedición", en: "Set the issue date", ru: "Указать дату выдачи", uk: "Указати дату видачі")
    static let documentNumber = LText(es: "Número del documento", en: "Document number", ru: "Номер документа", uk: "Номер документа")
    static let reminders = LText(es: "Avisos de plazos", en: "Deadline reminders", ru: "Напоминания о сроках", uk: "Нагадування про строки")
    static let pages = LText(es: "Páginas", en: "Pages", ru: "Страницы", uk: "Сторінки")
    static let share = LText(es: "Compartir", en: "Share", ru: "Поделиться", uk: "Поділитися")
    static let delete = LText(es: "Eliminar", en: "Delete", ru: "Удалить", uk: "Видалити")
    static let deleteDocumentConfirm = LText(es: "¿Eliminar el documento y sus imágenes?", en: "Delete the document and its images?", ru: "Удалить документ и его изображения?", uk: "Видалити документ і його зображення?")
    static let cancel = LText(es: "Cancelar", en: "Cancel", ru: "Отмена", uk: "Скасувати")
    static let save = LText(es: "Guardar", en: "Save", ru: "Сохранить", uk: "Зберегти")
    static let done = LText(es: "Listo", en: "Done", ru: "Готово", uk: "Готово")
    static let recognizing = LText(es: "Leyendo el documento…", en: "Reading the document…", ru: "Читаем документ…", uk: "Читаємо документ…")
    static let suggestedFromScan = LText(es: "Detectado en el escaneo: revisa que sea correcto.", en: "Detected in the scan: check it is correct.", ru: "Найдено при сканировании: проверьте, всё ли верно.", uk: "Знайдено під час сканування: перевірте, чи все правильно.")
    static let expired = LText(es: "Caducado", en: "Expired", ru: "Истёк", uk: "Сплив")
    static let renewalWindowOpen = LText(es: "Plazo de renovación abierto", en: "Renewal window open", ru: "Окно продления открыто", uk: "Вікно продовження відкрите")
    static let recognizedText = LText(es: "Texto reconocido", en: "Recognized text", ru: "Распознанный текст", uk: "Розпізнаний текст")
    static let scannerUnavailable = LText(es: "El escáner no está disponible en este dispositivo.", en: "The scanner is not available on this device.", ru: "Сканер недоступен на этом устройстве.", uk: "Сканер недоступний на цьому пристрої.")

    // Настройки
    static let mySituation = LText(es: "Mi situación", en: "My situation", ru: "Моя ситуация", uk: "Моя ситуація")
    static let euCitizen = LText(es: "Ciudadano UE/EEE/Suiza", en: "EU/EEA/Swiss citizen", ru: "Гражданин ЕС/ЕЭЗ/Швейцарии", uk: "Громадянин ЄС/ЄЕЗ/Швейцарії")
    static let stage = LText(es: "Etapa", en: "Stage", ru: "Этап", uk: "Етап")
    static let privacy = LText(es: "Privacidad", en: "Privacy", ru: "Конфиденциальность", uk: "Конфіденційність")
    static let faceIDLock = LText(es: "Bloquear con Face ID", en: "Lock with Face ID", ru: "Блокировка Face ID", uk: "Блокування Face ID")
    static let privacyNote = LText(es: "No hay cuentas ni servidores: todos tus datos y documentos se quedan cifrados en este iPhone.",
                                   en: "No accounts, no servers: all your data and documents stay encrypted on this iPhone.",
                                   ru: "Ни аккаунтов, ни серверов: все данные и документы хранятся в зашифрованном виде на этом iPhone.", uk: "Ані акаунтів, ані серверів: усі дані й документи зберігаються в зашифрованому вигляді на цьому iPhone.")
    static let about = LText(es: "Acerca de", en: "About", ru: "О приложении", uk: "Про застосунок")
    static let version = LText(es: "Versión", en: "Version", ru: "Версия", uk: "Версія")
    static let developer = LText(es: "Desarrollador", en: "Developer", ru: "Разработчик", uk: "Розробник")
    static let unlock = LText(es: "Desbloquear", en: "Unlock", ru: "Разблокировать", uk: "Розблокувати")
    static let locked = LText(es: "Residente está bloqueada", en: "Residente is locked", ru: "Residente заблокировано", uk: "Residente заблоковано")

    static let restore = LText(es: "Restaurar compra", en: "Restore purchase", ru: "Восстановить покупку", uk: "Відновити покупку")
    static let buy = LText(es: "Desbloquear por %@", en: "Unlock for %@", ru: "Открыть за %@", uk: "Відкрити за %@")
    static let limitTramites = LText(es: "La versión gratuita permite llevar 1 trámite a la vez.", en: "The free version lets you track 1 procedure at a time.", ru: "В бесплатной версии можно вести 1 трамит одновременно.", uk: "У безкоштовній версії можна вести 1 процедуру одночасно.")
    static let limitDocuments = LText(es: "La versión gratuita guarda hasta 3 documentos.", en: "The free version stores up to 3 documents.", ru: "Бесплатная версия хранит до 3 документов.", uk: "Безкоштовна версія зберігає до 3 документів.")
    static let loading = LText(es: "Cargando…", en: "Loading…", ru: "Загрузка…", uk: "Завантаження…")
    static let storeUnavailable = LText(es: "La tienda no está disponible ahora.", en: "The store is not available right now.", ru: "Магазин сейчас недоступен.", uk: "Магазин зараз недоступний.")
}

extension LText {
    /// Подстановка в шаблон с %d / %@.
    func format(_ lang: Lang, _ args: CVarArg...) -> String {
        String(format: self[lang], locale: lang.locale, arguments: args)
    }
}
