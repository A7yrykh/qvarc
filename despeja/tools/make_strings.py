#!/usr/bin/env python3
"""Генерирует Despeja/Localizable.xcstrings и InfoPlist.xcstrings (es — исходный, en, ru, uk).
Ключи — испанские строки из кода; при изменении текста в Swift обновить и здесь."""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..", "Despeja")

# key: (en, ru, uk) ; plural: dict lang -> {one, few, many, other}
T = {
 "3 días gratis": ("3 days free", "3 дня бесплатно", "3 дні безкоштовно"),
 "3 días gratis, después %@ al año. Cancela cuando quieras.": ("3 days free, then %@ per year. Cancel anytime.", "3 дня бесплатно, затем %@ в год. Отмена в любой момент.", "3 дні безкоштовно, потім %@ на рік. Скасування будь-коли."),
 "Abrir Ajustes": ("Open Settings", "Открыть Настройки", "Відкрити Параметри"),
 "Ajustes": ("Settings", "Настройки", "Параметри"),
 "Almacenamiento": ("Storage", "Хранилище", "Сховище"),
 "Analizando tu galería…": ("Scanning your library…", "Анализируем галерею…", "Аналізуємо галерею…"),
 "Analizar galería": ("Scan library", "Анализировать галерею", "Аналізувати галерею"),
 "Anual": ("Yearly", "Год", "Рік"),
 "Ayuda": ("Help", "Помощь", "Допомога"),
 "Borra sin límite diario duplicados, ráfagas, capturas y vídeos": ("Delete duplicates, bursts, screenshots and videos with no daily limit", "Удаляйте дубликаты, серии, скриншоты и видео без дневного лимита", "Видаляйте дублікати, серії, знімки екрана й відео без денного ліміту"),
 "Cancelar": ("Cancel", "Отмена", "Скасувати"),
 "Capturas de pantalla": ("Screenshots", "Снимки экрана", "Знімки екрана"),
 "Cerrar": ("Close", "Закрыть", "Закрити"),
 "Contacto y soporte": ("Contact and support", "Связь и поддержка", "Зв’язок і підтримка"),
 "Continuar": ("Continue", "Продолжить", "Продовжити"),
 "Copias exactas de la misma foto": ("Exact copies of the same photo", "Точные копии одного фото", "Точні копії одного фото"),
 "Dejamos la mejor copia de cada foto (marcada con ★) y seleccionamos el resto.": ("We keep the best copy of each photo (marked ★) and select the rest.", "Лучшую копию каждого фото (★) оставляем, остальные отмечены.", "Найкращу копію кожного фото (★) залишаємо, решту позначено."),
 "Desarrollador": ("Developer", "Разработчик", "Розробник"),
 "Despeja Pro activo": ("Despeja Pro active", "Despeja Pro активен", "Despeja Pro активний"),
 "Despeja analiza las fotos en el propio iPhone. No hay cuentas, servidores ni publicidad, y no recogemos ningún dato.": ("Despeja analyses photos on your iPhone itself. No accounts, servers or ads, and we collect no data at all.", "Despeja анализирует фото прямо на iPhone. Без аккаунтов, серверов и рекламы — мы не собираем никаких данных.", "Despeja аналізує фото просто на iPhone. Без акаунтів, серверів і реклами — ми не збираємо жодних даних."),
 "Despeja encuentra fotos duplicadas, ráfagas, capturas y vídeos pesados para que decidas qué borrar.": ("Despeja finds duplicate photos, bursts, screenshots and heavy videos so you can decide what to delete.", "Despeja находит дубликаты фото, серии, скриншоты и тяжёлые видео, а вы решаете, что удалить.", "Despeja знаходить дублікати фото, серії, знімки екрана й важкі відео, а ви вирішуєте, що видалити."),
 "Despeja solo ve las fotos que elegiste. Para analizarlo todo, permite el acceso completo en Ajustes.": ("Despeja only sees the photos you picked. To scan everything, allow full access in Settings.", "Despeja видит только выбранные вами фото. Чтобы проверить всё, разрешите полный доступ в Настройках.", "Despeja бачить лише вибрані вами фото. Щоб перевірити все, дозвольте повний доступ у Параметрах."),
 "Duplicados": ("Duplicates", "Дубликаты", "Дублікати"),
 "El pago se carga a tu Apple ID al confirmar la compra. La suscripción se renueva automáticamente salvo que la canceles al menos 24 horas antes de que termine el periodo. Puedes gestionarla o cancelarla en Ajustes > Apple ID > Suscripciones. Sin Pro puedes analizar la galería y borrar 20 archivos al día gratis.": (
   "Payment is charged to your Apple ID when you confirm the purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the period. Manage or cancel it in Settings > Apple ID > Subscriptions. Without Pro you can scan your library and delete 20 files a day for free.",
   "Оплата списывается с Apple ID при подтверждении покупки. Подписка продлевается автоматически, если не отменить её минимум за 24 часа до конца периода. Управлять и отменить можно в Настройки > Apple ID > Подписки. Без Pro можно анализировать галерею и бесплатно удалять 20 файлов в день.",
   "Оплата списується з Apple ID під час підтвердження покупки. Підписка поновлюється автоматично, якщо не скасувати її щонайменше за 24 години до кінця періоду. Керувати й скасувати можна в Параметри > Apple ID > Підписки. Без Pro можна аналізувати галерею й безкоштовно видаляти 20 файлів на день."),
 "Eliminar %lld · %@": ("Delete %lld · %@", "Удалить %lld · %@", "Видалити %lld · %@"),
 "Eliminar sin límite con Pro": ("Delete without limits with Pro", "Удалять без лимита с Pro", "Видаляти без ліміту з Pro"),
 "Eliminar solo %lld": ("Delete only %lld", "Удалить только %lld", "Видалити лише %lld"),
 "En cada serie dejamos la mejor foto (★). Revisa la selección antes de borrar.": ("In each series we keep the best photo (★). Check the selection before deleting.", "В каждой серии оставляем лучшее фото (★). Проверьте выбор перед удалением.", "У кожній серії залишаємо найкраще фото (★). Перевірте вибір перед видаленням."),
 "Equivale a %@ a la semana": ("Just %@ per week", "Это %@ в неделю", "Це %@ на тиждень"),
 "Fotos similares": ("Similar photos", "Похожие фото", "Схожі фото"),
 "Gestionar suscripción": ("Manage subscription", "Управление подпиской", "Керувати підпискою"),
 "Has llegado al límite gratuito": ("You've reached the free limit", "Бесплатный лимит исчерпан", "Безкоштовний ліміт вичерпано"),
 "La compra está pendiente de aprobación.": ("The purchase is pending approval.", "Покупка ожидает подтверждения.", "Покупка очікує підтвердження."),
 "Las más antiguas primero.": ("Oldest first.", "Сначала самые старые.", "Спочатку найстаріші."),
 "Libera espacio en tu iPhone": ("Free up space on your iPhone", "Освободите место на iPhone", "Звільніть місце на iPhone"),
 "Libera gigas en minutos, sin revisar foto a foto": ("Free up gigabytes in minutes, without going photo by photo", "Освобождайте гигабайты за минуты, не перебирая фото по одному", "Звільняйте гігабайти за хвилини, не перебираючи фото по одному"),
 "Libre: %@": ("Free: %@", "Свободно: %@", "Вільно: %@"),
 "Listo": ("Done", "Готово", "Готово"),
 "Lo borrado pasa 30 días en «Eliminado» de Fotos.": ("Deleted items stay 30 days in Photos' Recently Deleted.", "Удалённое 30 дней хранится в «Недавно удалённых» в Фото.", "Видалене 30 днів зберігається в «Нещодавно видалених» у Фото."),
 "Lo que borras va a «Eliminado» en la app Fotos y puedes recuperarlo durante 30 días.": ("What you delete goes to Recently Deleted in the Photos app, where you can recover it for 30 days.", "Удалённое попадает в «Недавно удалённые» в приложении Фото, его можно вернуть в течение 30 дней.", "Видалене потрапляє в «Нещодавно видалені» в програмі Фото, його можна повернути протягом 30 днів."),
 "Los que más espacio ocupan": ("The ones taking up the most space", "Занимают больше всего места", "Займають найбільше місця"),
 "Nada se borra sin tu confirmación.": ("Nothing is deleted without your confirmation.", "Без вашего подтверждения ничего не удаляется.", "Без вашого підтвердження нічого не видаляється."),
 "Ninguno": ("None", "Снять", "Зняти"),
 "No hay nada que borrar en esta sección.": ("Nothing to delete in this section.", "В этом разделе удалять нечего.", "У цьому розділі нічого видаляти."),
 "No hay suscripciones activas con este Apple ID.": ("There are no active subscriptions for this Apple ID.", "У этого Apple ID нет активных подписок.", "Для цього Apple ID немає активних підписок."),
 "No se pudo eliminar": ("Couldn't delete", "Не удалось удалить", "Не вдалося видалити"),
 "OK": ("OK", "OK", "OK"),
 "Ocupado %@ de %@": ("%1$@ used of %2$@", "Занято %1$@ из %2$@", "Зайнято %1$@ з %2$@"),
 "Ordenados por tamaño. Los vídeos de más de 50 MB aparecen aquí.": ("Sorted by size. Videos over 50 MB show up here.", "По размеру. Здесь видео больше 50 МБ.", "За розміром. Тут відео понад 50 МБ."),
 "Pasar a Pro": ("Upgrade to Pro", "Перейти на Pro", "Перейти на Pro"),
 "Permitir acceso a Fotos": ("Allow access to Photos", "Разрешить доступ к Фото", "Дозволити доступ до Фото"),
 "Política de privacidad": ("Privacy policy", "Политика конфиденциальности", "Політика конфіденційності"),
 "Privacidad": ("Privacy", "Конфиденциальность", "Конфіденційність"),
 "Probar 3 días gratis": ("Try 3 days free", "3 дня бесплатно", "3 дні безкоштовно"),
 "Puedes liberar": ("You can free up", "Можно освободить", "Можна звільнити"),
 "Restaurar compras": ("Restore purchases", "Восстановить покупки", "Відновити покупки"),
 "Ráfagas y fotos casi iguales": ("Bursts and near-identical photos", "Серии и почти одинаковые фото", "Серії та майже однакові фото"),
 "Selecciona lo que quieras borrar": ("Select what you want to delete", "Выберите, что удалить", "Виберіть, що видалити"),
 "Semanal": ("Weekly", "Неделя", "Тиждень"),
 "Sin acceso a Fotos Despeja no puede buscar duplicados. Actívalo en Ajustes.": ("Without access to Photos, Despeja can't look for duplicates. Turn it on in Settings.", "Без доступа к Фото Despeja не сможет искать дубликаты. Включите его в Настройках.", "Без доступу до Фото Despeja не зможе шукати дублікати. Увімкніть його в Параметрах."),
 "Suelen sobrar al cabo de unos días": ("Usually unneeded after a few days", "Обычно не нужны уже через пару дней", "Зазвичай непотрібні вже за кілька днів"),
 "Suscripción": ("Subscription", "Подписка", "Підписка"),
 "Todo limpio": ("All clean", "Всё чисто", "Усе чисто"),
 "Todo se analiza en el iPhone. Ninguna foto sale del dispositivo.": ("Everything is analysed on your iPhone. No photo ever leaves the device.", "Всё анализируется на iPhone. Ни одно фото не покидает устройство.", "Усе аналізується на iPhone. Жодне фото не залишає пристрій."),
 "Todo sigue en tu iPhone: sin cuentas, sin anuncios": ("Everything stays on your iPhone: no accounts, no ads", "Всё остаётся на iPhone: без аккаунтов и рекламы", "Усе залишається на iPhone: без акаунтів і реклами"),
 "Todos": ("All", "Все", "Усі"),
 "Términos (EULA)": ("Terms (EULA)", "Условия (EULA)", "Умови (EULA)"),
 "Términos de uso (EULA)": ("Terms of use (EULA)", "Условия использования (EULA)", "Умови використання (EULA)"),
 "Versión": ("Version", "Версия", "Версія"),
 "Volver a analizar": ("Scan again", "Проверить снова", "Перевірити знову"),
 "Vídeos grandes": ("Large videos", "Большие видео", "Великі відео"),
 "Ya has liberado %@": ("You've freed %@", "Уже освобождено %@", "Уже звільнено %@"),
 "%@ a la semana. Cancela cuando quieras.": ("%@ per week. Cancel anytime.", "%@ в неделю. Отмена в любой момент.", "%@ на тиждень. Скасування будь-коли."),
 "%@ al año. Cancela cuando quieras.": ("%@ per year. Cancel anytime.", "%@ в год. Отмена в любой момент.", "%@ на рік. Скасування будь-коли."),
 "%@ a la semana": ("%@ per week", "%@ в неделю", "%@ на тиждень"),
 "%@ al año": ("%@ per year", "%@ в год", "%@ на рік"),
 "★ Mejor": ("★ Best", "★ Лучшее", "★ Краще"),
 "Despeja Pro": None, "Despeja": None, "AVSyrykh SL": None,
}

P = {  # plurals: lang -> forms
 "%lld archivos": {
   "es": {"one": "%lld archivo", "other": "%lld archivos"},
   "en": {"one": "%lld file", "other": "%lld files"},
   "ru": {"one": "%lld файл", "few": "%lld файла", "many": "%lld файлов", "other": "%lld файла"},
   "uk": {"one": "%lld файл", "few": "%lld файли", "many": "%lld файлів", "other": "%lld файлу"}},
 "%lld fotos · %@": {
   "es": {"one": "%lld foto · %@", "other": "%lld fotos · %@"},
   "en": {"one": "%lld photo · %@", "other": "%lld photos · %@"},
   "ru": {"one": "%lld фото · %@", "few": "%lld фото · %@", "many": "%lld фото · %@", "other": "%lld фото · %@"},
   "uk": {"one": "%lld фото · %@", "few": "%lld фото · %@", "many": "%lld фото · %@", "other": "%lld фото · %@"}},
 "Hoy te quedan %lld borrados gratis": {
   "es": {"one": "Hoy te queda %lld borrado gratis", "other": "Hoy te quedan %lld borrados gratis"},
   "en": {"one": "%lld free deletion left today", "other": "%lld free deletions left today"},
   "ru": {"one": "Сегодня осталось %lld бесплатное удаление", "few": "Сегодня осталось %lld бесплатных удаления", "many": "Сегодня осталось %lld бесплатных удалений", "other": "Сегодня осталось %lld бесплатных удаления"},
   "uk": {"one": "Сьогодні залишилося %lld безкоштовне видалення", "few": "Сьогодні залишилося %lld безкоштовні видалення", "many": "Сьогодні залишилося %lld безкоштовних видалень", "other": "Сьогодні залишилося %lld безкоштовного видалення"}},
 "Hoy te quedan %lld borrados gratis. Con Pro, sin límite.": {
   "es": {"one": "Hoy te queda %lld borrado gratis. Con Pro, sin límite.", "other": "Hoy te quedan %lld borrados gratis. Con Pro, sin límite."},
   "en": {"one": "%lld free deletion left today. With Pro, no limits.", "other": "%lld free deletions left today. With Pro, no limits."},
   "ru": {"one": "Сегодня осталось %lld бесплатное удаление. С Pro — без лимита.", "few": "Сегодня осталось %lld бесплатных удаления. С Pro — без лимита.", "many": "Сегодня осталось %lld бесплатных удалений. С Pro — без лимита.", "other": "Сегодня осталось %lld бесплатных удаления. С Pro — без лимита."},
   "uk": {"one": "Сьогодні залишилося %lld безкоштовне видалення. З Pro — без ліміту.", "few": "Сьогодні залишилося %lld безкоштовні видалення. З Pro — без ліміту.", "many": "Сьогодні залишилося %lld безкоштовних видалень. З Pro — без ліміту.", "other": "Сьогодні залишилося %lld безкоштовного видалення. З Pro — без ліміту."}},
 "Con la versión gratuita puedes borrar %lld archivos al día.": {
   "es": {"one": "Con la versión gratuita puedes borrar %lld archivo al día.", "other": "Con la versión gratuita puedes borrar %lld archivos al día."},
   "en": {"one": "The free version lets you delete %lld file a day.", "other": "The free version lets you delete %lld files a day."},
   "ru": {"one": "В бесплатной версии можно удалять %lld файл в день.", "few": "В бесплатной версии можно удалять %lld файла в день.", "many": "В бесплатной версии можно удалять %lld файлов в день.", "other": "В бесплатной версии можно удалять %lld файла в день."},
   "uk": {"one": "У безкоштовній версії можна видаляти %lld файл на день.", "few": "У безкоштовній версії можна видаляти %lld файли на день.", "many": "У безкоштовній версії можна видаляти %lld файлів на день.", "other": "У безкоштовній версії можна видаляти %lld файлу на день."}},
}

def unit(v): return {"stringUnit": {"state": "translated", "value": v}}

strings = {}
for key, tr in T.items():
    if tr is None:
        strings[key] = {"shouldTranslate": False}
        continue
    strings[key] = {"localizations": {l: unit(v) for l, v in zip(("en", "ru", "uk"), tr)}}
for key, langs in P.items():
    strings[key] = {"localizations": {l: {"variations": {"plural": {f: unit(v) for f, v in forms.items()}}}
                                      for l, forms in langs.items()}}

# Проверка: все ключи из кода покрыты.
code = ""
for d in ("App", "Views"):
    for f in os.listdir(os.path.join(APP, d)):
        code += open(os.path.join(APP, d, f)).read()
missing = []
for lit in set(re.findall(r'"((?:[^"\\]|\\.)*)"', code)):
    if not re.search(r"[A-ZÁÉÍÓÚ¿¡★]", lit[:2] + lit) or lit.startswith(("http", "CF", "-", "AccentColor")):
        continue
    key = re.sub(r"\\\((?:[^()]|\([^()]*\))*\)", "%@", lit)
    if any(k.replace("%lld", "%@") == key for k in list(T) + list(P)):
        continue
    missing.append(lit)
for m in sorted(missing):
    print("НЕТ ПЕРЕВОДА:", m)

out = {"sourceLanguage": "es", "strings": dict(sorted(strings.items())), "version": "1.0"}
json.dump(out, open(os.path.join(APP, "Localizable.xcstrings"), "w"), ensure_ascii=False, indent=2)

info = {"sourceLanguage": "es", "version": "1.0", "strings": {
  "CFBundleDisplayName": {"shouldTranslate": False},
  "NSPhotoLibraryUsageDescription": {"localizations": {
    "es": unit("Despeja analiza tus fotos y vídeos en el propio iPhone para encontrar duplicados, ráfagas, capturas y vídeos grandes. Nada sale del dispositivo."),
    "en": unit("Despeja analyses your photos and videos on your iPhone to find duplicates, bursts, screenshots and large videos. Nothing leaves the device."),
    "ru": unit("Despeja анализирует фото и видео прямо на iPhone, чтобы найти дубликаты, серии, скриншоты и большие видео. Ничего не покидает устройство."),
    "uk": unit("Despeja аналізує фото й відео просто на iPhone, щоб знайти дублікати, серії, знімки екрана й великі відео. Ніщо не залишає пристрій.")}}}}
json.dump(info, open(os.path.join(APP, "InfoPlist.xcstrings"), "w"), ensure_ascii=False, indent=2)
print("ok", len(strings))
