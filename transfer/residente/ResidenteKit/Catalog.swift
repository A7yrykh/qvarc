import Foundation

// Контент гайдов. Перед каждым релизом сверять с официальными источниками и обновлять verifiedOn.
// Суммы тас: Orden PJC/617/2025, проверено 25.10.2026 по taxdown.es и sede.policia.gob.es.

private func u(_ s: String) -> URL { URL(string: s)! }

public enum Links {
    public static let formsEX = u("https://www.inclusion.gob.es/web/migraciones/modelos-generales")
    public static let tasa790012 = u("https://sede.policia.gob.es/Tasa790_012/ImpresoRellenar")
    public static let sedeExtranjeria = u("https://sede.administracionespublicas.gob.es/")
    public static let expedientes = u("https://sede.administracionespublicas.gob.es/infoext2/")
    public static let fnmtPersonaFisica = u("https://www.sede.fnmt.gob.es/certificados/persona-fisica/obtener-certificado-software")
    public static let fnmtSolicitar = u("https://www.sede.fnmt.gob.es/certificados/persona-fisica/obtener-certificado-software/solicitar-certificado")
    public static let fnmtAcreditar = u("https://www.sede.fnmt.gob.es/certificados/persona-fisica/obtener-certificado-software/acreditar-identidad")
    public static let fnmtDescargar = u("https://www.sede.fnmt.gob.es/certificados/persona-fisica/obtener-certificado-software/descargar-certificado")
    public static let fnmtMovil = u("https://www.sede.fnmt.gob.es/certificados/persona-fisica/certificado-con-dispositivo-movil")
    public static let fnmtOficinas = u("http://mapaoficinascert.appspot.com")
    public static let clave = u("https://administracion.gob.es/pag_Home/en/Tramites/ServiciosElectronicosFrecuentes/Necesito-Registrarme-en-clave.html")
    public static let leyBasesRegimenLocal = u("https://www.boe.es/buscar/act.php?id=BOE-A-1985-5392")
    public static let rd240 = u("https://www.boe.es/buscar/act.php?id=BOE-A-2007-4184")
}

public enum Catalog {
    public static let verified = "2026-10-25"

    public static let all: [Tramite] = [padron, nie, euRegistration, tieFirst, renewal, digitalCertificate, clave]

    public static func tramite(id: String) -> Tramite? {
        all.first { $0.id == id }
    }

    // MARK: - Empadronamiento

    public static let padron = Tramite(
        id: "padron",
        symbol: "house",
        audience: .everyone,
        title: LText(es: "Empadronamiento", en: "Padrón registration", ru: "Прописка (padrón)", uk: "Прописка (padrón)"),
        summary: LText(
            es: "Inscribirte en el padrón municipal de la ciudad donde vives. Lo piden para casi todo: TIE, sanidad, colegio, renovaciones.",
            en: "Register in the municipal register of the town where you live. It is asked for almost everything: TIE, healthcare, school, renewals.",
            ru: "Регистрация по месту жительства в муниципалитете. Её спрашивают почти везде: для TIE, медицины, школы, продлений.", uk: "Реєстрація за місцем проживання в муніципалітеті. Її вимагають майже всюди: для TIE, медицини, школи, продовжень."),
        who: LText(
            es: "Toda persona que vive en España, con o sin papeles. Es obligatorio.",
            en: "Everyone who lives in Spain, with or without residence papers. It is mandatory.",
            ru: "Все, кто живёт в Испании, с документами или без. Это обязательно.", uk: "Усі, хто живе в Іспанії, з документами чи без. Це обов'язково."),
        whereToApply: LText(
            es: "Ayuntamiento de tu municipio (oficina de atención o sede electrónica).",
            en: "Your town hall (citizen office or its online portal).",
            ru: "Ayuntamiento вашего муниципалитета (офис приёма или электронный портал).", uk: "Ayuntamiento вашого муніципалітету (офіс прийому або електронний портал)."),
        cost: LText(es: "Gratis en la mayoría de municipios.", en: "Free in most towns.", ru: "Бесплатно в большинстве муниципалитетов.", uk: "Безкоштовно в більшості муніципалітетів."),
        duration: LText(es: "Normalmente el mismo día; en algunas ciudades, unos días.",
                        en: "Usually the same day; a few days in some cities.",
                        ru: "Обычно в тот же день, в некоторых городах — несколько дней.", uk: "Зазвичай того ж дня, у деяких містах — кілька днів."),
        documents: [
            Requirement("id", LText(es: "Pasaporte, TIE, certificado UE o documento de identidad (original)",
                                    en: "Passport, TIE, EU certificate or national ID (original)",
                                    ru: "Паспорт, TIE, сертификат ЕС или национальное удостоверение (оригинал)", uk: "Паспорт, TIE, сертифікат ЄС або національне посвідчення (оригінал)")),
            Requirement("home", LText(es: "Contrato de alquiler o escritura de la vivienda",
                                      en: "Rental contract or property deed",
                                      ru: "Договор аренды или документ о собственности", uk: "Договір оренди або документ про власність"),
                        note: LText(es: "Algunos ayuntamientos piden también el último recibo de alquiler o de un suministro.",
                                    en: "Some town halls also ask for the latest rent or utility receipt.",
                                    ru: "Некоторые ayuntamientos просят ещё последний чек за аренду или коммунальные услуги.", uk: "Деякі ayuntamientos просять ще останній чек за оренду чи комунальні послуги.")),
            Requirement("authorization", LText(es: "Si no eres titular: autorización firmada del propietario o inquilino y copia de su DNI/NIE",
                                               en: "If you are not the tenant/owner: signed authorization from them and a copy of their ID",
                                               ru: "Если вы не арендатор и не владелец: разрешение от них с подписью и копия их DNI/NIE", uk: "Якщо ви не орендар і не власник: дозвіл від них із підписом і копія їхнього DNI/NIE")),
            Requirement("form", LText(es: "Hoja padronal (formulario de inscripción del ayuntamiento)",
                                      en: "Hoja padronal (the town hall's registration form)",
                                      ru: "Hoja padronal (бланк регистрации ayuntamiento)", uk: "Hoja padronal (бланк реєстрації ayuntamiento)")),
            Requirement("minors", LText(es: "Para menores: libro de familia o certificado de nacimiento",
                                        en: "For children: family book or birth certificate",
                                        ru: "Для детей: свидетельство о рождении или libro de familia", uk: "Для дітей: свідоцтво про народження або libro de familia")),
        ],
        steps: [
            Step("check", LText(es: "Consulta los requisitos de tu ayuntamiento", en: "Check your town hall's requirements", ru: "Проверьте требования вашего ayuntamiento", uk: "Перевірте вимоги вашого ayuntamiento"),
                 LText(es: "Cada municipio publica su lista de documentos y si hace falta cita. Busca «empadronamiento» en la web del ayuntamiento.",
                       en: "Each town publishes its own document list and whether you need an appointment. Search for «empadronamiento» on the town hall website.",
                       ru: "Каждый муниципалитет публикует свой список документов и нужна ли запись. Ищите «empadronamiento» на сайте ayuntamiento.", uk: "Кожен муніципалітет публікує свій список документів і чи потрібен запис. Шукайте «empadronamiento» на сайті ayuntamiento.")),
            Step("cita", LText(es: "Pide cita", en: "Book an appointment", ru: "Запишитесь на приём", uk: "Запишіться на прийом"),
                 LText(es: "En la mayoría de ciudades grandes la cita es obligatoria. Algunas permiten el trámite online con certificado digital.",
                       en: "Most big cities require an appointment. Some allow doing it online with a digital certificate.",
                       ru: "В большинстве крупных городов запись обязательна. Некоторые позволяют оформить онлайн с цифровым сертификатом.", uk: "У більшості великих міст запис обов'язковий. Деякі дозволяють оформити онлайн із цифровим сертифікатом."),
                 isCita: true),
            Step("fill", LText(es: "Rellena la hoja padronal", en: "Fill in the hoja padronal", ru: "Заполните hoja padronal", uk: "Заповніть hoja padronal"),
                 LText(es: "Datos de todas las personas que viven en la vivienda. Firma cada persona mayor de edad.",
                       en: "Details of everyone living at the address. Each adult signs.",
                       ru: "Данные всех, кто живёт по адресу. Каждый взрослый подписывает.", uk: "Дані всіх, хто живе за адресою. Кожен дорослий підписує.")),
            Step("visit", LText(es: "Ve a la cita con los originales", en: "Attend with the originals", ru: "Придите на приём с оригиналами", uk: "Прийдіть на прийом з оригіналами"),
                 LText(es: "Lleva originales y copias. Te inscriben en el momento o te avisan cuando esté hecho.",
                       en: "Bring originals and copies. They register you on the spot or notify you when done.",
                       ru: "Возьмите оригиналы и копии. Регистрируют сразу или сообщают, когда готово.", uk: "Візьміть оригінали та копії. Реєструють одразу або повідомляють, коли готово.")),
            Step("certificate", LText(es: "Pide el volante o certificado", en: "Get the volante or certificate", ru: "Получите volante или certificado", uk: "Отримайте volante або certificado"),
                 LText(es: "El volante es informativo; el certificado tiene valor oficial. Para extranjería suelen pedir uno reciente (de menos de 3 meses).",
                       en: "The volante is informative; the certificate is official. Immigration offices usually want a recent one (under 3 months).",
                       ru: "Volante — справка для информации, certificado — официальный документ. Для extranjería обычно нужна свежая справка (не старше 3 месяцев).", uk: "Volante — довідка для інформації, certificado — офіційний документ. Для extranjería зазвичай потрібна свіжа довідка (не старша за 3 місяці).")),
        ],
        cita: CitaInfo(portal: .other(nil), serviceName: nil,
                       whereText: LText(es: "Sede electrónica o teléfono de tu ayuntamiento.",
                                        en: "Your town hall's online portal or phone line.",
                                        ru: "Электронный портал или телефон вашего ayuntamiento.", uk: "Електронний портал або телефон вашого ayuntamiento.")),
        tips: [
            LText(es: "Si no tienes autorización de residencia de larga duración, debes renovar la inscripción padronal cada 2 años.",
                  en: "Non-EU residents without long-term residence must renew their padrón registration every 2 years.",
                  ru: "Граждане не из ЕС без долгосрочного ВНЖ должны обновлять padrón каждые 2 года.", uk: "Громадяни не з ЄС без довгострокової посвідки мають оновлювати padrón кожні 2 роки."),
            LText(es: "Cuando cambies de domicilio, empadrónate en el nuevo: la baja en el anterior es automática.",
                  en: "When you move, register at the new address: the old one is cancelled automatically.",
                  ru: "При переезде зарегистрируйтесь по новому адресу: старая регистрация снимается автоматически.", uk: "Після переїзду зареєструйтеся за новою адресою: стара реєстрація знімається автоматично."),
        ],
        sources: [
            Source(LText(es: "Ley 7/1985 de Bases del Régimen Local (art. 15–17)", en: "Law 7/1985 on Local Government (art. 15–17)", ru: "Закон 7/1985 о местном самоуправлении (ст. 15–17)", uk: "Закон 7/1985 про місцеве самоврядування (ст. 15–17)"),
                   Links.leyBasesRegimenLocal),
        ],
        verifiedOn: verified,
        resultDocument: .padron
    )

    // MARK: - NIE

    public static let nie = Tramite(
        id: "nie",
        symbol: "number",
        audience: .everyone,
        title: LText(es: "NIE (número de identidad de extranjero)", en: "NIE (foreigner ID number)", ru: "NIE (номер иностранца)", uk: "NIE (номер іноземця)"),
        summary: LText(
            es: "El número que necesitas para comprar una vivienda, trabajar, abrir ciertas cuentas o pagar impuestos. Es un certificado en papel, no una tarjeta.",
            en: "The number you need to buy property, work, open some accounts or pay taxes. It is a paper certificate, not a card.",
            ru: "Номер, без которого не купить жильё, не работать, не открыть часть счетов и не платить налоги. Это бумажный сертификат, а не карта.", uk: "Номер, без якого не купити житло, не працювати, не відкрити частину рахунків і не сплачувати податки. Це паперовий сертифікат, а не картка."),
        who: LText(
            es: "Extranjeros con intereses económicos, profesionales o sociales en España. Si eres ciudadano UE y te quedas más de 3 meses, pide el certificado de registro UE (incluye el NIE).",
            en: "Foreigners with economic, professional or social interests in Spain. EU citizens staying over 3 months should get the EU registration certificate instead (it includes the NIE).",
            ru: "Иностранцы с экономическими, профессиональными или социальными интересами в Испании. Гражданам ЕС, которые остаются больше 3 месяцев, нужен сертификат резидента ЕС (в нём уже есть NIE).", uk: "Іноземці з економічними, професійними чи соціальними інтересами в Іспанії. Громадянам ЄС, які залишаються понад 3 місяці, потрібен сертифікат резидента ЄС (у ньому вже є NIE)."),
        whereToApply: LText(
            es: "En España: Comisaría de Policía u Oficina de Extranjería de tu provincia, con cita. Desde el extranjero: consulado de España.",
            en: "In Spain: police station or immigration office in your province, by appointment. From abroad: a Spanish consulate.",
            ru: "В Испании: полиция или офис extranjería вашей провинции, по записи. Из-за рубежа: консульство Испании.", uk: "В Іспанії: поліція або офіс extranjería вашої провінції, за записом. З-за кордону: консульство Іспанії."),
        cost: LText(es: "Tasa 790-012: 9,84 €", en: "Fee 790-012: €9.84", ru: "Таса 790-012: 9,84 €", uk: "Таса 790-012: 9,84 €"),
        duration: LText(es: "A menudo el mismo día de la cita.", en: "Often on the day of the appointment.", ru: "Часто в день приёма.", uk: "Часто в день прийому."),
        forms: [
            FormRef(kind: .ex15, title: LText(es: "EX-15 · Solicitud de NIE y certificados", en: "EX-15 · NIE and certificates application", ru: "EX-15 · Заявление на NIE и сертификаты", uk: "EX-15 · Заява на NIE та сертифікати"),
                    url: Links.formsEX,
                    mark: LText(es: "Apartado 4: «Número de Identidad de Extranjero (NIE)»", en: "Section 4: «Número de Identidad de Extranjero (NIE)»", ru: "Раздел 4: «Número de Identidad de Extranjero (NIE)»", uk: "Розділ 4: «Número de Identidad de Extranjero (NIE)»")),
            FormRef(kind: .tasa790012, title: LText(es: "Tasa 790 código 012", en: "Fee form 790 code 012", ru: "Таса 790 код 012", uk: "Таса 790 код 012"),
                    url: Links.tasa790012,
                    mark: LText(es: "«Asignación de Número de Identidad de Extranjero (NIE) a instancia del interesado»",
                                en: "«Asignación de Número de Identidad de Extranjero (NIE) a instancia del interesado»",
                                ru: "«Asignación de Número de Identidad de Extranjero (NIE) a instancia del interesado»", uk: "«Asignación de Número de Identidad de Extranjero (NIE) a instancia del interesado»"),
                    amount: Decimal(string: "9.84")),
        ],
        documents: [
            Requirement("ex15", LText(es: "Formulario EX-15 rellenado y firmado (original y copia)", en: "EX-15 form filled in and signed (original and copy)", ru: "Форма EX-15, заполненная и подписанная (оригинал и копия)", uk: "Форма EX-15, заповнена й підписана (оригінал і копія)")),
            Requirement("passport", LText(es: "Pasaporte en vigor (original y copia de la página de datos)", en: "Valid passport (original and copy of the data page)", ru: "Действующий паспорт (оригинал и копия страницы с данными)", uk: "Чинний паспорт (оригінал і копія сторінки з даними)")),
            Requirement("tasa", LText(es: "Justificante de pago de la tasa 790-012", en: "Proof of payment of fee 790-012", ru: "Квитанция об оплате тасы 790-012", uk: "Квитанція про сплату таси 790-012")),
            Requirement("reason", LText(es: "Documento que justifique el motivo (compra de vivienda, oferta de trabajo, herencia, estudios…)",
                                        en: "Document proving the reason (property purchase, job offer, inheritance, studies…)",
                                        ru: "Документ, подтверждающий причину (покупка жилья, предложение работы, наследство, учёба…)", uk: "Документ, що підтверджує причину (купівля житла, пропозиція роботи, спадщина, навчання…)")),
            Requirement("cita", LText(es: "Justificante de la cita", en: "Appointment confirmation", ru: "Подтверждение записи", uk: "Підтвердження запису")),
        ],
        steps: [
            Step("reason", LText(es: "Prepara el documento del motivo", en: "Prepare the proof of reason", ru: "Подготовьте документ о причине", uk: "Підготуйте документ про причину"),
                 LText(es: "Sin un motivo justificado la solicitud puede ser rechazada.", en: "Without a justified reason the application may be refused.", ru: "Без обоснованной причины могут отказать.", uk: "Без обґрунтованої причини можуть відмовити.")),
            Step("form", LText(es: "Rellena el EX-15", en: "Fill in EX-15", ru: "Заполните EX-15", uk: "Заповніть EX-15"),
                 LText(es: "Descárgalo de la web oficial. El asistente de formularios te dice qué poner en cada casilla.",
                       en: "Download it from the official site. The form helper shows what goes in each box.",
                       ru: "Скачайте с официального сайта. Помощник по формам подскажет, что писать в каждой графе.", uk: "Завантажте з офіційного сайту. Помічник із форм підкаже, що писати в кожній графі."),
                 link: Links.formsEX),
            Step("cita", LText(es: "Consigue cita", en: "Get an appointment", ru: "Запишитесь на приём", uk: "Запишіться на прийом"),
                 LText(es: "En el portal de cita previa elige tu provincia y el trámite de NIE.", en: "On the appointment portal choose your province and the NIE service.", ru: "На портале cita previa выберите провинцию и услугу NIE.", uk: "На порталі cita previa оберіть провінцію та послугу NIE."),
                 link: CitaInfo.icpURL, isCita: true),
            Step("pay", LText(es: "Paga la tasa 790-012", en: "Pay fee 790-012", ru: "Оплатите тасу 790-012", uk: "Сплатіть тасу 790-012"),
                 LText(es: "Rellena el impreso online, imprímelo y paga en un banco colaborador o por internet. Guarda el justificante.",
                       en: "Fill in the form online, print it and pay at a partner bank or online. Keep the receipt.",
                       ru: "Заполните бланк онлайн, распечатайте и оплатите в банке или онлайн. Сохраните квитанцию.", uk: "Заповніть бланк онлайн, роздрукуйте й сплатіть у банку або онлайн. Збережіть квитанцію."),
                 link: Links.tasa790012),
            Step("visit", LText(es: "Acude a la cita", en: "Attend the appointment", ru: "Придите на приём", uk: "Прийдіть на прийом"),
                 LText(es: "Con todos los originales y copias. Llega con antelación.", en: "With all originals and copies. Arrive early.", ru: "Со всеми оригиналами и копиями. Приходите заранее.", uk: "З усіма оригіналами та копіями. Приходьте заздалегідь.")),
            Step("collect", LText(es: "Recoge el certificado NIE", en: "Collect the NIE certificate", ru: "Получите сертификат NIE", uk: "Отримайте сертифікат NIE"),
                 LText(es: "Comprueba que tus datos están bien escritos antes de irte. Guárdalo en Documentos.",
                       en: "Check your details are correct before leaving. Save it in Documents.",
                       ru: "Проверьте данные, прежде чем уйти. Сохраните его в «Документах».", uk: "Перевірте дані, перш ніж піти. Збережіть його в «Документах».")),
        ],
        cita: CitaInfo(portal: .icp, serviceName: "POLICIA-CERTIFICADOS Y ASIGNACION NIE",
                       whereText: LText(es: "Comisaría u Oficina de Extranjería de tu provincia.", en: "Police station or immigration office in your province.", ru: "Полиция или офис extranjería вашей провинции.", uk: "Поліція або офіс extranjería вашої провінції.")),
        sources: [
            Source(LText(es: "Modelos de solicitud (Ministerio de Inclusión)", en: "Application forms (Ministry of Inclusion)", ru: "Формы заявлений (Министерство инклюзии)", uk: "Форми заяв (Міністерство інклюзії)"), Links.formsEX),
            Source(LText(es: "Tasa 790-012 (Policía Nacional)", en: "Fee 790-012 (National Police)", ru: "Таса 790-012 (Национальная полиция)", uk: "Таса 790-012 (Національна поліція)"), Links.tasa790012),
        ],
        verifiedOn: verified,
        resultDocument: .nie
    )

    // MARK: - Certificado de registro UE

    public static let euRegistration = Tramite(
        id: "eu-registration",
        symbol: "eurosign.circle",
        audience: .euCitizens,
        title: LText(es: "Certificado de registro de ciudadano UE", en: "EU citizen registration certificate", ru: "Сертификат резидента ЕС", uk: "Сертифікат резидента ЄС"),
        summary: LText(
            es: "El «certificado verde» para ciudadanos de la UE, EEE y Suiza que viven en España. Incluye tu NIE.",
            en: "The «green certificate» for EU, EEA and Swiss citizens living in Spain. It includes your NIE.",
            ru: "«Зелёный сертификат» для граждан ЕС, ЕЭЗ и Швейцарии, живущих в Испании. В нём указан ваш NIE.", uk: "«Зелений сертифікат» для громадян ЄС, ЄЕЗ і Швейцарії, які живуть в Іспанії. У ньому зазначено ваш NIE."),
        who: LText(
            es: "Ciudadanos UE, EEE y Suiza que se quedan más de 3 meses.",
            en: "EU, EEA and Swiss citizens staying more than 3 months.",
            ru: "Граждане ЕС, ЕЭЗ и Швейцарии, которые остаются больше 3 месяцев.", uk: "Громадяни ЄС, ЄЕЗ і Швейцарії, які залишаються понад 3 місяці."),
        whereToApply: LText(
            es: "Oficina de Extranjería o Comisaría de Policía de tu provincia, con cita.",
            en: "Immigration office or police station in your province, by appointment.",
            ru: "Офис extranjería или полиция вашей провинции, по записи.", uk: "Офіс extranjería або поліція вашої провінції, за записом."),
        cost: LText(es: "Tasa 790-012: 12,00 €", en: "Fee 790-012: €12.00", ru: "Таса 790-012: 12,00 €", uk: "Таса 790-012: 12,00 €"),
        duration: LText(es: "Normalmente se entrega el mismo día.", en: "Usually issued on the same day.", ru: "Обычно выдают в тот же день.", uk: "Зазвичай видають того ж дня."),
        deadline: LText(es: "Dentro de los 3 meses desde tu entrada en España.", en: "Within 3 months of entering Spain.", ru: "В течение 3 месяцев после въезда в Испанию.", uk: "Протягом 3 місяців після в'їзду в Іспанію."),
        forms: [
            FormRef(kind: .ex18, title: LText(es: "EX-18 · Certificado de registro UE", en: "EX-18 · EU registration certificate", ru: "EX-18 · Сертификат резидента ЕС", uk: "EX-18 · Сертифікат резидента ЄС"), url: Links.formsEX),
            FormRef(kind: .tasa790012, title: LText(es: "Tasa 790 código 012", en: "Fee form 790 code 012", ru: "Таса 790 код 012", uk: "Таса 790 код 012"), url: Links.tasa790012,
                    mark: LText(es: "«Certificado de registro de residente comunitario»", en: "«Certificado de registro de residente comunitario»", ru: "«Certificado de registro de residente comunitario»", uk: "«Certificado de registro de residente comunitario»"),
                    amount: Decimal(string: "12.00")),
        ],
        documents: [
            Requirement("ex18", LText(es: "Formulario EX-18 rellenado y firmado", en: "EX-18 form filled in and signed", ru: "Форма EX-18, заполненная и подписанная", uk: "Форма EX-18, заповнена й підписана")),
            Requirement("id", LText(es: "Pasaporte o documento nacional de identidad en vigor (original y copia)", en: "Valid passport or national ID card (original and copy)", ru: "Действующий паспорт или ID-карта (оригинал и копия)", uk: "Чинний паспорт або ID-картка (оригінал і копія)")),
            Requirement("tasa", LText(es: "Justificante de pago de la tasa 790-012", en: "Proof of payment of fee 790-012", ru: "Квитанция об оплате тасы 790-012", uk: "Квитанція про сплату таси 790-012")),
            Requirement("means", LText(es: "Uno de estos: contrato de trabajo o alta en Seguridad Social; alta como autónomo; o medios económicos suficientes y seguro médico; o matrícula de estudios con seguro y medios",
                                       en: "One of: employment contract or Social Security registration; self-employment registration; or sufficient funds and health insurance; or study enrolment with insurance and funds",
                                       ru: "Одно из: трудовой договор или регистрация в Seguridad Social; регистрация автономо; или достаточные средства и медицинская страховка; или зачисление на учёбу со страховкой и средствами", uk: "Одне з: трудовий договір або реєстрація в Seguridad Social; реєстрація автономо; або достатні кошти й медичне страхування; або зарахування на навчання зі страховкою та коштами")),
            Requirement("cita", LText(es: "Justificante de la cita", en: "Appointment confirmation", ru: "Подтверждение записи", uk: "Підтвердження запису")),
        ],
        steps: [
            Step("means", LText(es: "Reúne la prueba de tu situación", en: "Gather proof of your situation", ru: "Соберите подтверждение вашей ситуации", uk: "Зберіть підтвердження вашої ситуації"),
                 LText(es: "Trabajo, autónomo, medios + seguro o estudios. El seguro privado debe tener cobertura completa y sin copagos.",
                       en: "Work, self-employment, funds + insurance, or studies. Private insurance must give full cover without co-payments.",
                       ru: "Работа, автономо, средства + страховка или учёба. Частная страховка должна быть с полным покрытием и без доплат.", uk: "Робота, автономо, кошти + страховка або навчання. Приватна страховка має бути з повним покриттям і без доплат.")),
            Step("form", LText(es: "Rellena el EX-18", en: "Fill in EX-18", ru: "Заполните EX-18", uk: "Заповніть EX-18"),
                 LText(es: "Descárgalo de la web oficial.", en: "Download it from the official site.", ru: "Скачайте с официального сайта.", uk: "Завантажте з офіційного сайту."), link: Links.formsEX),
            Step("cita", LText(es: "Consigue cita", en: "Get an appointment", ru: "Запишитесь на приём", uk: "Запишіться на прийом"),
                 LText(es: "En el portal de cita previa elige tu provincia y el certificado UE.", en: "On the appointment portal choose your province and the EU certificate.", ru: "На портале cita previa выберите провинцию и сертификат ЕС.", uk: "На порталі cita previa оберіть провінцію та сертифікат ЄС."),
                 link: CitaInfo.icpURL, isCita: true),
            Step("pay", LText(es: "Paga la tasa 790-012", en: "Pay fee 790-012", ru: "Оплатите тасу 790-012", uk: "Сплатіть тасу 790-012"),
                 LText(es: "12,00 €. Guarda el justificante sellado.", en: "€12.00. Keep the stamped receipt.", ru: "12,00 €. Сохраните квитанцию с отметкой банка.", uk: "12,00 €. Збережіть квитанцію з відміткою банку."), link: Links.tasa790012),
            Step("visit", LText(es: "Acude a la cita y recoge el certificado", en: "Attend and collect the certificate", ru: "Придите на приём и получите сертификат", uk: "Прийдіть на прийом і отримайте сертифікат"),
                 LText(es: "Comprueba tus datos y guárdalo en Documentos. Tras 5 años puedes pedir el certificado de residencia permanente.",
                       en: "Check your details and save it in Documents. After 5 years you can apply for permanent residence.",
                       ru: "Проверьте данные и сохраните в «Документах». Через 5 лет можно получить постоянное резидентство.", uk: "Перевірте дані й збережіть у «Документах». Через 5 років можна отримати постійне резидентство.")),
        ],
        cita: CitaInfo(portal: .icp, serviceName: "POLICIA-CERTIFICADO DE REGISTRO DE CIUDADANO DE LA U.E.",
                       whereText: LText(es: "Oficina de Extranjería o Comisaría de tu provincia.", en: "Immigration office or police station in your province.", ru: "Офис extranjería или полиция вашей провинции.", uk: "Офіс extranjería або поліція вашої провінції.")),
        sources: [
            Source(LText(es: "Real Decreto 240/2007 (ciudadanos UE)", en: "Royal Decree 240/2007 (EU citizens)", ru: "Королевский декрет 240/2007 (граждане ЕС)", uk: "Королівський декрет 240/2007 (громадяни ЄС)"), Links.rd240),
            Source(LText(es: "Modelos de solicitud (Ministerio de Inclusión)", en: "Application forms (Ministry of Inclusion)", ru: "Формы заявлений (Министерство инклюзии)", uk: "Форми заяв (Міністерство інклюзії)"), Links.formsEX),
        ],
        verifiedOn: verified,
        resultDocument: .euRegistration
    )

    // MARK: - TIE inicial

    public static let tieFirst = Tramite(
        id: "tie-first",
        symbol: "person.text.rectangle",
        audience: .nonEUCitizens,
        title: LText(es: "TIE: primera tarjeta", en: "TIE: first residence card", ru: "TIE: первая карта резидента", uk: "TIE: перша картка резидента"),
        summary: LText(
            es: "La tarjeta física que acredita tu residencia. Se pide después de tener la visa o la resolución favorable.",
            en: "The physical card that proves your residence. You apply after getting the visa or the approval.",
            ru: "Пластиковая карта, подтверждающая ВНЖ. Её оформляют после визы или положительного решения.", uk: "Пластикова картка, що підтверджує посвідку на проживання. Її оформлюють після візи або позитивного рішення."),
        who: LText(
            es: "Ciudadanos de fuera de la UE con autorización de residencia o estancia de más de 6 meses.",
            en: "Non-EU citizens with a residence or stay authorization longer than 6 months.",
            ru: "Граждане не из ЕС с разрешением на проживание или пребывание дольше 6 месяцев.", uk: "Громадяни не з ЄС із дозволом на проживання чи перебування понад 6 місяців."),
        whereToApply: LText(
            es: "Comisaría de Policía (oficina de documentación de extranjeros) de tu provincia, con cita para la toma de huellas.",
            en: "Police station (foreigners' documentation office) in your province, with an appointment for fingerprints.",
            ru: "Полиция (отдел документов для иностранцев) вашей провинции, по записи на сдачу отпечатков.", uk: "Поліція (відділ документів для іноземців) вашої провінції, за записом на здачу відбитків."),
        cost: LText(es: "Tasa 790-012: 16,08 €", en: "Fee 790-012: €16.08", ru: "Таса 790-012: 16,08 €", uk: "Таса 790-012: 16,08 €"),
        duration: LText(es: "La tarjeta suele estar lista en 30–45 días tras las huellas (varía por provincia).",
                        en: "The card is usually ready 30–45 days after fingerprinting (varies by province).",
                        ru: "Карта обычно готова через 30–45 дней после отпечатков (зависит от провинции).", uk: "Картка зазвичай готова через 30–45 днів після відбитків (залежить від провінції)."),
        deadline: LText(es: "En el plazo de 1 mes desde tu entrada en España (con visado) o desde la concesión.",
                        en: "Within 1 month of entering Spain (with a visa) or of the approval.",
                        ru: "В течение 1 месяца после въезда (по визе) или после одобрения.", uk: "Протягом 1 місяця після в'їзду (за візою) або після схвалення."),
        forms: [
            FormRef(kind: .ex17, title: LText(es: "EX-17 · Solicitud de TIE", en: "EX-17 · TIE application", ru: "EX-17 · Заявление на TIE", uk: "EX-17 · Заява на TIE"), url: Links.formsEX,
                    mark: LText(es: "Tipo de documento: «Tarjeta inicial»", en: "Document type: «Tarjeta inicial»", ru: "Тип документа: «Tarjeta inicial»", uk: "Тип документа: «Tarjeta inicial»")),
            FormRef(kind: .tasa790012, title: LText(es: "Tasa 790 código 012", en: "Fee form 790 code 012", ru: "Таса 790 код 012", uk: "Таса 790 код 012"), url: Links.tasa790012,
                    mark: LText(es: "«TIE que documenta la primera concesión de la autorización de residencia temporal, de estancia o para trabajadores transfronterizos»",
                                en: "«TIE que documenta la primera concesión de la autorización de residencia temporal, de estancia o para trabajadores transfronterizos»",
                                ru: "«TIE que documenta la primera concesión de la autorización de residencia temporal, de estancia o para trabajadores transfronterizos»", uk: "«TIE que documenta la primera concesión de la autorización de residencia temporal, de estancia o para trabajadores transfronterizos»"),
                    amount: Decimal(string: "16.08")),
        ],
        documents: [
            Requirement("ex17", LText(es: "Formulario EX-17 rellenado y firmado", en: "EX-17 form filled in and signed", ru: "Форма EX-17, заполненная и подписанная", uk: "Форма EX-17, заповнена й підписана")),
            Requirement("passport", LText(es: "Pasaporte en vigor (original y copia), con el visado si lo tienes", en: "Valid passport (original and copy), with the visa if you have one", ru: "Действующий паспорт (оригинал и копия), с визой, если она есть", uk: "Чинний паспорт (оригінал і копія), з візою, якщо вона є")),
            Requirement("resolution", LText(es: "Resolución favorable de la autorización (copia)", en: "Approval decision of your authorization (copy)", ru: "Положительное решение по разрешению (копия)", uk: "Позитивне рішення щодо дозволу (копія)")),
            Requirement("photo", LText(es: "1 foto de carné reciente, fondo blanco", en: "1 recent passport-size photo, white background", ru: "1 свежее фото на документы, белый фон", uk: "1 свіже фото на документи, білий фон")),
            Requirement("tasa", LText(es: "Justificante de pago de la tasa 790-012", en: "Proof of payment of fee 790-012", ru: "Квитанция об оплате тасы 790-012", uk: "Квитанція про сплату таси 790-012")),
            Requirement("padron", LText(es: "Volante de padrón reciente", en: "Recent padrón certificate", ru: "Свежая справка padrón", uk: "Свіжа довідка padrón"),
                        note: LText(es: "Muchas comisarías lo piden para comprobar el domicilio.", en: "Many police stations ask for it to check your address.", ru: "Многие комиссарии просят её для проверки адреса.", uk: "Багато комісаріатів просять її для перевірки адреси.")),
            Requirement("cita", LText(es: "Justificante de la cita", en: "Appointment confirmation", ru: "Подтверждение записи", uk: "Підтвердження запису")),
        ],
        steps: [
            Step("deadline", LText(es: "Apunta tu plazo de 1 mes", en: "Note your 1-month deadline", ru: "Отметьте срок в 1 месяц", uk: "Позначте строк в 1 місяць"),
                 LText(es: "Cuenta desde la entrada en España o desde la notificación de la concesión.", en: "It counts from your entry into Spain or the approval notice.", ru: "Он считается от даты въезда или уведомления об одобрении.", uk: "Він рахується від дати в'їзду або повідомлення про схвалення.")),
            Step("cita", LText(es: "Consigue cita para huellas", en: "Get a fingerprint appointment", ru: "Запишитесь на отпечатки", uk: "Запишіться на відбитки"),
                 LText(es: "En el portal de cita previa elige tu provincia y la toma de huellas.", en: "On the appointment portal choose your province and fingerprinting.", ru: "На портале cita previa выберите провинцию и сдачу отпечатков.", uk: "На порталі cita previa оберіть провінцію та здачу відбитків."),
                 link: CitaInfo.icpURL, isCita: true),
            Step("form", LText(es: "Rellena el EX-17", en: "Fill in EX-17", ru: "Заполните EX-17", uk: "Заповніть EX-17"),
                 LText(es: "Marca «Tarjeta inicial».", en: "Tick «Tarjeta inicial».", ru: "Отметьте «Tarjeta inicial».", uk: "Позначте «Tarjeta inicial»."), link: Links.formsEX),
            Step("pay", LText(es: "Paga la tasa 790-012", en: "Pay fee 790-012", ru: "Оплатите тасу 790-012", uk: "Сплатіть тасу 790-012"),
                 LText(es: "16,08 € para la primera tarjeta de residencia temporal.", en: "€16.08 for the first temporary residence card.", ru: "16,08 € за первую карту временного ВНЖ.", uk: "16,08 € за першу картку тимчасової посвідки."), link: Links.tasa790012),
            Step("fingerprints", LText(es: "Toma de huellas", en: "Fingerprinting", ru: "Сдача отпечатков", uk: "Здача відбитків"),
                 LText(es: "Te dan un resguardo: guárdalo, acredita tu situación mientras esperas la tarjeta.",
                       en: "You get a receipt (resguardo): keep it, it proves your status while you wait for the card.",
                       ru: "Вам дадут resguardo: храните его, он подтверждает статус, пока вы ждёте карту.", uk: "Вам дадуть resguardo: зберігайте його, він підтверджує статус, поки ви чекаєте на картку.")),
            Step("collect", LText(es: "Recoge la TIE", en: "Collect your TIE", ru: "Получите TIE", uk: "Отримайте TIE"),
                 LText(es: "En algunas provincias hace falta otra cita para recogerla. Al recibirla, guárdala en Documentos para los avisos de renovación.",
                       en: "Some provinces need another appointment to collect it. Once you have it, save it in Documents to get renewal reminders.",
                       ru: "В некоторых провинциях для получения нужна отдельная запись. Сохраните карту в «Документах», чтобы получать напоминания о продлении.", uk: "У деяких провінціях для отримання потрібен окремий запис. Збережіть картку в «Документах», щоб отримувати нагадування про продовження.")),
        ],
        cita: CitaInfo(portal: .icp, serviceName: "POLICIA-TOMA DE HUELLAS (EXPEDICIÓN DE TARJETA) Y RENOVACIÓN DE TARJETA DE LARGA DURACIÓN",
                       whereText: LText(es: "Comisaría de tu provincia.", en: "Police station in your province.", ru: "Полиция вашей провинции.", uk: "Поліція вашої провінції."),
                       tips: [LText(es: "Para recoger la tarjeta, algunas provincias usan «POLICÍA-RECOGIDA DE TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)».",
                                    en: "To collect the card, some provinces use «POLICÍA-RECOGIDA DE TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)».",
                                    ru: "Для получения карты в некоторых провинциях есть услуга «POLICÍA-RECOGIDA DE TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)».", uk: "Для отримання картки в деяких провінціях є послуга «POLICÍA-RECOGIDA DE TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)».")]),
        sources: [
            Source(LText(es: "Modelos de solicitud (Ministerio de Inclusión)", en: "Application forms (Ministry of Inclusion)", ru: "Формы заявлений (Министерство инклюзии)", uk: "Форми заяв (Міністерство інклюзії)"), Links.formsEX),
            Source(LText(es: "Tasa 790-012 (Policía Nacional)", en: "Fee 790-012 (National Police)", ru: "Таса 790-012 (Национальная полиция)", uk: "Таса 790-012 (Національна поліція)"), Links.tasa790012),
        ],
        verifiedOn: verified,
        resultDocument: .tie
    )

    // MARK: - Renovación

    public static let renewal = Tramite(
        id: "renewal",
        symbol: "arrow.triangle.2.circlepath",
        audience: .nonEUCitizens,
        title: LText(es: "Renovación de la residencia", en: "Residence permit renewal", ru: "Продление ВНЖ", uk: "Продовження посвідки"),
        summary: LText(
            es: "Renovar la autorización de residencia temporal antes de que caduque y después la TIE.",
            en: "Renew your temporary residence authorization before it expires, then the TIE card.",
            ru: "Продлить разрешение на временное проживание до окончания срока, а затем карту TIE.", uk: "Продовжити дозвіл на тимчасове проживання до закінчення строку, а потім картку TIE."),
        who: LText(
            es: "Residentes de fuera de la UE con residencia temporal (no lucrativa, trabajo, autónomo, reagrupación…).",
            en: "Non-EU residents with temporary residence (non-lucrative, employment, self-employment, family reunification…).",
            ru: "Граждане не из ЕС с временным ВНЖ (без права работы, по найму, автономо, воссоединение семьи…).", uk: "Громадяни не з ЄС із тимчасовою посвідкою (без права роботи, за наймом, автономо, возз'єднання сім'ї…)."),
        whereToApply: LText(
            es: "Online en la sede electrónica de extranjería (con certificado digital o Cl@ve) o en la Oficina de Extranjería.",
            en: "Online at the immigration e-office (with a digital certificate or Cl@ve) or at the immigration office.",
            ru: "Онлайн на электронном портале extranjería (с цифровым сертификатом или Cl@ve) или в офисе extranjería.", uk: "Онлайн на електронному порталі extranjería (з цифровим сертифікатом або Cl@ve) або в офісі extranjería."),
        cost: LText(es: "Tasa 790-052 (según el tipo) y después TIE por renovación: 19,30 € (790-012).",
                    en: "Fee 790-052 (depends on the type), then the renewed TIE: €19.30 (790-012).",
                    ru: "Таса 790-052 (зависит от типа), затем TIE при продлении: 19,30 € (790-012).", uk: "Таса 790-052 (залежить від типу), потім TIE при продовженні: 19,30 € (790-012)."),
        duration: LText(es: "La administración tiene 3 meses para resolver; si no contesta, en la renovación se entiende concedida.",
                        en: "The administration has 3 months to decide; if there is no answer, a renewal is deemed approved.",
                        ru: "На решение есть 3 месяца; если ответа нет, продление считается одобренным.", uk: "На рішення є 3 місяці; якщо відповіді немає, продовження вважається схваленим."),
        deadline: LText(es: "Desde 60 días antes de la caducidad hasta 90 días después (RD 1155/2024).",
                        en: "From 60 days before expiry until 90 days after (RD 1155/2024).",
                        ru: "С 60 дней до окончания срока и до 90 дней после (RD 1155/2024).", uk: "Від 60 днів до закінчення строку й до 90 днів після (RD 1155/2024)."),
        forms: [
            FormRef(kind: .ex17, title: LText(es: "EX-17 · TIE por renovación", en: "EX-17 · TIE renewal", ru: "EX-17 · TIE при продлении", uk: "EX-17 · TIE при продовженні"), url: Links.formsEX,
                    mark: LText(es: "Tipo de documento: «Renovación de tarjeta»", en: "Document type: «Renovación de tarjeta»", ru: "Тип документа: «Renovación de tarjeta»", uk: "Тип документа: «Renovación de tarjeta»")),
            FormRef(kind: .tasa790012, title: LText(es: "Tasa 790 código 012 (tarjeta)", en: "Fee form 790 code 012 (card)", ru: "Таса 790 код 012 (карта)", uk: "Таса 790 код 012 (картка)"), url: Links.tasa790012,
                    mark: LText(es: "«TIE que documenta la renovación o prórroga de la autorización»", en: "«TIE que documenta la renovación o prórroga de la autorización»", ru: "«TIE que documenta la renovación o prórroga de la autorización»", uk: "«TIE que documenta la renovación o prórroga de la autorización»"),
                    amount: Decimal(string: "19.30")),
        ],
        documents: [
            Requirement("form", LText(es: "Formulario EX del mismo tipo de autorización (por ejemplo, EX-01 para residencia no lucrativa)",
                                      en: "The EX form for your type of authorization (for example EX-01 for non-lucrative residence)",
                                      ru: "Форма EX вашего типа разрешения (например, EX-01 для ВНЖ без права работы)", uk: "Форма EX вашого типу дозволу (наприклад, EX-01 для посвідки без права роботи)")),
            Requirement("passport", LText(es: "Pasaporte en vigor (copia completa)", en: "Valid passport (full copy)", ru: "Действующий паспорт (копия всех страниц)", uk: "Чинний паспорт (копія всіх сторінок)")),
            Requirement("tie", LText(es: "TIE actual (copia)", en: "Current TIE (copy)", ru: "Текущая TIE (копия)", uk: "Поточна TIE (копія)")),
            Requirement("tasa052", LText(es: "Justificante de pago de la tasa 790-052", en: "Proof of payment of fee 790-052", ru: "Квитанция об оплате тасы 790-052", uk: "Квитанція про сплату таси 790-052")),
            Requirement("requirements", LText(es: "Pruebas de que sigues cumpliendo los requisitos (medios, seguro, cotizaciones, escolarización de menores…)",
                                              en: "Proof you still meet the requirements (funds, insurance, contributions, children's schooling…)",
                                              ru: "Подтверждение, что вы по-прежнему соответствуете требованиям (средства, страховка, взносы, школа детей…)", uk: "Підтвердження, що ви й надалі відповідаєте вимогам (кошти, страховка, внески, школа дітей…)")),
        ],
        steps: [
            Step("window", LText(es: "Vigila el plazo", en: "Watch the window", ru: "Следите за сроком", uk: "Стежте за строком"),
                 LText(es: "Guarda tu TIE en Documentos: te avisaremos cuando se abra el plazo (60 días antes) y antes de que cierre.",
                       en: "Save your TIE in Documents: we remind you when the window opens (60 days before) and before it closes.",
                       ru: "Сохраните TIE в «Документах»: мы напомним, когда откроется окно (за 60 дней) и перед его закрытием.", uk: "Збережіть TIE в «Документах»: ми нагадаємо, коли відкриється вікно (за 60 днів) і перед його закриттям.")),
            Step("gather", LText(es: "Reúne la documentación", en: "Gather the documents", ru: "Соберите документы", uk: "Зберіть документи"),
                 LText(es: "Los requisitos dependen de tu tipo de residencia: revisa la hoja informativa de tu autorización.",
                       en: "Requirements depend on your residence type: check the information sheet for your authorization.",
                       ru: "Требования зависят от типа ВНЖ: проверьте информационный лист вашего разрешения.", uk: "Вимоги залежать від типу посвідки: перевірте інформаційний лист вашого дозволу."),
                 link: Links.formsEX),
            Step("identity", LText(es: "Prepara tu identificación digital", en: "Set up your digital ID", ru: "Подготовьте цифровую подпись", uk: "Підготуйте цифровий підпис"),
                 LText(es: "Para presentar online necesitas certificado digital o Cl@ve. Mira esos trámites en el catálogo.",
                       en: "To apply online you need a digital certificate or Cl@ve. See those guides in the catalogue.",
                       ru: "Для подачи онлайн нужен цифровой сертификат или Cl@ve. Смотрите эти гайды в каталоге.", uk: "Для подання онлайн потрібен цифровий сертифікат або Cl@ve. Дивіться ці гайди в каталозі.")),
            Step("submit", LText(es: "Presenta la solicitud", en: "Submit the application", ru: "Подайте заявление", uk: "Подайте заяву"),
                 LText(es: "En la sede electrónica de extranjería. Guarda el justificante y el número de expediente.",
                       en: "On the immigration e-office. Keep the receipt and the file number (expediente).",
                       ru: "На электронном портале extranjería. Сохраните квитанцию и номер expediente.", uk: "На електронному порталі extranjería. Збережіть квитанцію та номер expediente."),
                 link: Links.sedeExtranjeria),
            Step("track", LText(es: "Sigue el expediente", en: "Track your file", ru: "Следите за expediente", uk: "Стежте за expediente"),
                 LText(es: "Consulta el estado con tu número de expediente. Presentar en plazo prorroga tu autorización hasta la resolución.",
                       en: "Check the status with your file number. Applying on time extends your authorization until the decision.",
                       ru: "Проверяйте статус по номеру expediente. Подача в срок продлевает действие разрешения до решения.", uk: "Перевіряйте статус за номером expediente. Подання вчасно продовжує дію дозволу до рішення."),
                 link: Links.expedientes),
            Step("cita", LText(es: "Pide cita para la nueva TIE", en: "Book an appointment for the new TIE", ru: "Запишитесь на новую TIE", uk: "Запишіться на нову TIE"),
                 LText(es: "Con la resolución favorable: EX-17 marcando «Renovación de tarjeta» y tasa de 19,30 €.",
                       en: "With the approval: EX-17 ticking «Renovación de tarjeta» and the €19.30 fee.",
                       ru: "После одобрения: EX-17 с отметкой «Renovación de tarjeta» и таса 19,30 €.", uk: "Після схвалення: EX-17 з відміткою «Renovación de tarjeta» і таса 19,30 €."),
                 link: CitaInfo.icpURL, isCita: true),
            Step("collect", LText(es: "Recoge la nueva TIE", en: "Collect the new TIE", ru: "Получите новую TIE", uk: "Отримайте нову TIE"),
                 LText(es: "Actualiza la fecha de caducidad en Documentos para el siguiente aviso.", en: "Update the expiry date in Documents for the next reminder.", ru: "Обновите дату окончания в «Документах» для следующего напоминания.", uk: "Оновіть дату закінчення в «Документах» для наступного нагадування.")),
        ],
        cita: CitaInfo(portal: .icp, serviceName: "POLICIA-TOMA DE HUELLAS (EXPEDICIÓN DE TARJETA) Y RENOVACIÓN DE TARJETA DE LARGA DURACIÓN",
                       whereText: LText(es: "Comisaría de tu provincia (para la tarjeta).", en: "Police station in your province (for the card).", ru: "Полиция вашей провинции (для карты).", uk: "Поліція вашої провінції (для картки).")),
        tips: [
            LText(es: "Si presentas después de los 90 días, la renovación puede denegarse y pueden imponer una sanción.",
                  en: "If you apply after the 90 days, the renewal may be refused and a fine may apply.",
                  ru: "Если подать позже 90 дней, в продлении могут отказать и назначить штраф.", uk: "Якщо подати пізніше ніж за 90 днів, у продовженні можуть відмовити й призначити штраф."),
        ],
        sources: [
            Source(LText(es: "Sede electrónica de las Administraciones Públicas", en: "Public Administration e-office", ru: "Электронный портал госуправления", uk: "Електронний портал держуправління"), Links.sedeExtranjeria),
            Source(LText(es: "Consulta de expedientes de extranjería", en: "Immigration file status", ru: "Статус дел extranjería", uk: "Статус справ extranjería"), Links.expedientes),
            Source(LText(es: "Modelos de solicitud (Ministerio de Inclusión)", en: "Application forms (Ministry of Inclusion)", ru: "Формы заявлений (Министерство инклюзии)", uk: "Форми заяв (Міністерство інклюзії)"), Links.formsEX),
        ],
        verifiedOn: verified,
        resultDocument: .tie
    )

    // MARK: - Certificado digital FNMT

    public static let digitalCertificate = Tramite(
        id: "digital-certificate",
        symbol: "lock.shield",
        audience: .everyone,
        title: LText(es: "Certificado digital FNMT", en: "FNMT digital certificate", ru: "Цифровой сертификат FNMT", uk: "Цифровий сертифікат FNMT"),
        summary: LText(
            es: "Tu firma electrónica para hacer trámites online: Hacienda, Seguridad Social, extranjería, DGT.",
            en: "Your electronic signature for online procedures: tax office, Social Security, immigration, traffic (DGT).",
            ru: "Электронная подпись для онлайн-трамитов: налоговая, Seguridad Social, extranjería, DGT.", uk: "Електронний підпис для онлайн-процедур: податкова, Seguridad Social, extranjería, DGT."),
        who: LText(es: "Cualquier persona con NIE o DNI.", en: "Anyone with an NIE or DNI.", ru: "Любой, у кого есть NIE или DNI.", uk: "Будь-хто, у кого є NIE або DNI."),
        whereToApply: LText(
            es: "Solicitud online en la web de la FNMT y acreditación en una oficina (AEAT, Seguridad Social, algunos ayuntamientos).",
            en: "Online request on the FNMT website and identity check at an office (tax office, Social Security, some town halls).",
            ru: "Заявка онлайн на сайте FNMT и подтверждение личности в офисе (налоговая, Seguridad Social, некоторые ayuntamientos).", uk: "Заявка онлайн на сайті FNMT і підтвердження особи в офісі (податкова, Seguridad Social, деякі ayuntamientos)."),
        cost: LText(es: "Gratis.", en: "Free.", ru: "Бесплатно.", uk: "Безкоштовно."),
        duration: LText(es: "Unos días (lo que tarde la cita de acreditación). Se descarga aprox. 1 hora después.",
                        en: "A few days (depends on the identity appointment). You can download it about 1 hour after.",
                        ru: "Несколько дней (зависит от записи на подтверждение). Скачать можно примерно через час после.", uk: "Кілька днів (залежить від запису на підтвердження). Завантажити можна приблизно через годину після."),
        documents: [
            Requirement("code", LText(es: "Código de solicitud (llega por email)", en: "Request code (sent by email)", ru: "Код заявки (приходит по e-mail)", uk: "Код заявки (приходить на e-mail)")),
            Requirement("id", LText(es: "TIE o certificado de registro UE; o certificado NIE con pasaporte", en: "TIE or EU registration certificate; or NIE certificate with passport", ru: "TIE или сертификат резидента ЕС; или сертификат NIE с паспортом", uk: "TIE або сертифікат резидента ЄС; або сертифікат NIE з паспортом")),
            Requirement("email", LText(es: "Email al que tengas acceso", en: "An email address you can access", ru: "E-mail, к которому есть доступ", uk: "E-mail, до якого є доступ")),
        ],
        steps: [
            Step("setup", LText(es: "Prepara el ordenador", en: "Prepare the computer", ru: "Подготовьте компьютер", uk: "Підготуйте комп'ютер"),
                 LText(es: "La versión «software» se pide y se descarga en el mismo ordenador y navegador. Instala lo que indica la FNMT antes de empezar.",
                       en: "The «software» version is requested and downloaded on the same computer and browser. Install what FNMT lists before starting.",
                       ru: "Версию «software» запрашивают и скачивают на одном и том же компьютере и в одном браузере. Сначала установите то, что указывает FNMT.", uk: "Версію «software» запитують і завантажують на тому самому комп'ютері й у тому самому браузері. Спершу встановіть те, що вказує FNMT."),
                 link: Links.fnmtPersonaFisica),
            Step("request", LText(es: "Solicita el certificado", en: "Request the certificate", ru: "Подайте заявку", uk: "Подайте заявку"),
                 LText(es: "Introduce tu NIE, apellido y email. Recibirás el código de solicitud.", en: "Enter your NIE, surname and email. You will receive the request code.", ru: "Введите NIE, фамилию и e-mail. Придёт код заявки.", uk: "Введіть NIE, прізвище та e-mail. Прийде код заявки."),
                 link: Links.fnmtSolicitar),
            Step("cita", LText(es: "Acredita tu identidad", en: "Prove your identity", ru: "Подтвердите личность", uk: "Підтвердьте особу"),
                 LText(es: "Ve a una oficina de acreditación con el código y tu documento. Muchas oficinas piden cita.",
                       en: "Go to an accreditation office with the code and your ID. Many offices require an appointment.",
                       ru: "Придите в офис с кодом и документом. Во многих офисах нужна запись.", uk: "Прийдіть в офіс із кодом і документом. У багатьох офісах потрібен запис."),
                 link: Links.fnmtAcreditar, isCita: true),
            Step("download", LText(es: "Descarga e instala", en: "Download and install", ru: "Скачайте и установите", uk: "Завантажте й установіть"),
                 LText(es: "En el mismo ordenador y navegador. Haz una copia de seguridad (archivo .p12/.pfx con contraseña).",
                       en: "On the same computer and browser. Make a backup (a password-protected .p12/.pfx file).",
                       ru: "На том же компьютере и в том же браузере. Сделайте резервную копию (файл .p12/.pfx с паролем).", uk: "На тому самому комп'ютері й у тому самому браузері. Зробіть резервну копію (файл .p12/.pfx з паролем)."),
                 link: Links.fnmtDescargar),
        ],
        cita: CitaInfo(portal: .other(Links.fnmtOficinas), serviceName: nil,
                       whereText: LText(es: "Oficinas de acreditación: busca la más cercana en el localizador de la FNMT.",
                                        en: "Accreditation offices: find the nearest one with the FNMT locator.",
                                        ru: "Офисы подтверждения: ближайший можно найти в поиске FNMT.", uk: "Офіси підтвердження: найближчий можна знайти в пошуку FNMT.")),
        tips: [
            LText(es: "La FNMT también tiene una app para obtener el certificado en el móvil.", en: "FNMT also has an app to get the certificate on your phone.", ru: "У FNMT есть и приложение, чтобы получить сертификат на телефон.", uk: "У FNMT є й застосунок, щоб отримати сертифікат на телефон."),
        ],
        sources: [
            Source(LText(es: "FNMT: certificado de persona física", en: "FNMT: personal certificate", ru: "FNMT: сертификат физического лица", uk: "FNMT: сертифікат фізичної особи"), Links.fnmtPersonaFisica),
            Source(LText(es: "FNMT: certificado en dispositivo móvil", en: "FNMT: certificate on a mobile device", ru: "FNMT: сертификат на мобильном устройстве", uk: "FNMT: сертифікат на мобільному пристрої"), Links.fnmtMovil),
        ],
        verifiedOn: verified,
        resultDocument: .digitalCertificate
    )

    // MARK: - Cl@ve

    public static let clave = Tramite(
        id: "clave",
        symbol: "key.horizontal",
        audience: .everyone,
        title: LText(es: "Registro en Cl@ve", en: "Cl@ve registration", ru: "Регистрация в Cl@ve", uk: "Реєстрація в Cl@ve"),
        summary: LText(
            es: "Cl@ve te permite entrar en webs de la administración con un PIN o desde la app, sin certificado.",
            en: "Cl@ve lets you log in to government websites with a PIN or the app, without a certificate.",
            ru: "Cl@ve позволяет входить на госпорталы по PIN-коду или через приложение, без сертификата.", uk: "Cl@ve дає змогу входити на держпортали за PIN-кодом або через застосунок, без сертифіката."),
        who: LText(es: "Personas con DNI o NIE.", en: "People with a DNI or NIE.", ru: "Все, у кого есть DNI или NIE.", uk: "Усі, у кого є DNI або NIE."),
        whereToApply: LText(
            es: "Online (carta de invitación o videollamada, registro básico), con certificado digital (avanzado) o en una oficina de registro Cl@ve (avanzado).",
            en: "Online (invitation letter or video call, basic level), with a digital certificate (advanced) or at a Cl@ve registration office (advanced).",
            ru: "Онлайн (письмо-приглашение или видеозвонок, базовый уровень), с цифровым сертификатом (расширенный) или в офисе регистрации Cl@ve (расширенный).", uk: "Онлайн (лист-запрошення або відеодзвінок, базовий рівень), із цифровим сертифікатом (розширений) або в офісі реєстрації Cl@ve (розширений)."),
        cost: LText(es: "Gratis.", en: "Free.", ru: "Бесплатно.", uk: "Безкоштовно."),
        duration: LText(es: "De minutos (con certificado) a unos días (carta por correo o cita).",
                        en: "From minutes (with a certificate) to a few days (letter by post or appointment).",
                        ru: "От минут (с сертификатом) до нескольких дней (письмо по почте или запись).", uk: "Від хвилин (із сертифікатом) до кількох днів (лист поштою або запис)."),
        documents: [
            Requirement("phone", LText(es: "Móvil propio (cada número solo vale para un DNI/NIE)", en: "Your own mobile number (each number can be linked to one DNI/NIE only)", ru: "Собственный мобильный номер (один номер — один DNI/NIE)", uk: "Власний мобільний номер (один номер — один DNI/NIE)")),
            Requirement("email", LText(es: "Email", en: "Email", ru: "E-mail", uk: "E-mail")),
            Requirement("id", LText(es: "TIE, certificado de registro UE o autorización de residencia, y pasaporte", en: "TIE, EU registration certificate or residence authorization, plus passport", ru: "TIE, сертификат резидента ЕС или разрешение на проживание, плюс паспорт", uk: "TIE, сертифікат резидента ЄС або дозвіл на проживання, плюс паспорт")),
        ],
        steps: [
            Step("method", LText(es: "Elige cómo registrarte", en: "Choose how to register", ru: "Выберите способ регистрации", uk: "Оберіть спосіб реєстрації"),
                 LText(es: "Si ya tienes certificado digital, es lo más rápido y obtienes el nivel avanzado. La videoidentificación automática de la app ahora solo admite DNI.",
                       en: "If you already have a digital certificate, it is fastest and gives the advanced level. Automatic video ID in the app currently accepts only the Spanish DNI.",
                       ru: "Если цифровой сертификат уже есть, это быстрее всего и сразу даёт расширенный уровень. Автоматическая видеоидентификация в приложении сейчас работает только с испанским DNI.", uk: "Якщо цифровий сертифікат уже є, це найшвидше й одразу дає розширений рівень. Автоматична відеоідентифікація в застосунку зараз працює лише з іспанським DNI."),
                 link: Links.clave),
            Step("cita", LText(es: "O pide cita en una oficina", en: "Or book an office appointment", ru: "Или запишитесь в офис", uk: "Або запишіться в офіс"),
                 LText(es: "Oficinas de la AEAT, Seguridad Social y otras. Algunas exigen cita previa.", en: "Tax office, Social Security and others. Some require an appointment.", ru: "Налоговая, Seguridad Social и другие. В некоторых нужна запись.", uk: "Податкова, Seguridad Social та інші. У деяких потрібен запис."),
                 isCita: true),
            Step("activate", LText(es: "Activa Cl@ve en el móvil", en: "Activate Cl@ve on your phone", ru: "Активируйте Cl@ve в телефоне", uk: "Активуйте Cl@ve у телефоні"),
                 LText(es: "Instala la app Cl@ve y actívala con tus datos.", en: "Install the Cl@ve app and activate it with your details.", ru: "Установите приложение Cl@ve и активируйте его своими данными.", uk: "Установіть застосунок Cl@ve і активуйте його своїми даними.")),
        ],
        cita: CitaInfo(portal: .other(Links.clave), serviceName: nil,
                       whereText: LText(es: "Oficinas de registro Cl@ve (AEAT, Seguridad Social y otras).", en: "Cl@ve registration offices (tax office, Social Security and others).", ru: "Офисы регистрации Cl@ve (налоговая, Seguridad Social и другие).", uk: "Офіси реєстрації Cl@ve (податкова, Seguridad Social та інші).")),
        sources: [
            Source(LText(es: "administracion.gob.es: Registrarte en Cl@ve", en: "administracion.gob.es: Register in Cl@ve", ru: "administracion.gob.es: регистрация в Cl@ve", uk: "administracion.gob.es: реєстрація в Cl@ve"), Links.clave),
        ],
        verifiedOn: verified
    )
}
