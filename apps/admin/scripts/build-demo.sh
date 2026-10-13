#!/usr/bin/env bash
# Демо-админка для сайта: статичные файлы в apps/admin/out-demo, без сервера и без настоящих данных.
# Использование: apps/admin/scripts/build-demo.sh [/папка-на-сайте]   (по умолчанию /admin-demo)
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${1:-/admin-demo}"
rm -rf out-demo
NEXT_PUBLIC_DEMO=1 NEXT_PUBLIC_BASE_PATH="$BASE" npx next build
# Шрифт в CSS указан от корня сайта, добавляем папку
sed -i "s#url(/brand/#url($BASE/brand/#g" out-demo/_next/static/css/*.css
# Карточки брони и гостя: любые /bookings/<id>/ отдаются заготовкой «_», id страница берёт из адреса
cat > out-demo/.htaccess <<HT
# Демо-админка QVARC: данные выдуманы, поисковикам не показываем
<IfModule mod_headers.c>
  Header set X-Robots-Tag "noindex, nofollow"
</IfModule>
RewriteEngine On
RewriteBase $BASE/
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(bookings|guests)/[^/]+/index\.txt$ \$1/_/index.txt [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(bookings|guests)/[^/]+/?$ \$1/_/index.html [L]
ErrorDocument 404 $BASE/404.html
HT
echo "Готово: $(pwd)/out-demo (адрес на сайте: $BASE/)"
