#!/usr/bin/env bash
# Установка QVARC на чистый сервер Ubuntu 24.04 одной командой из консоли панели (от root):
#   curl -fsSL https://raw.githubusercontent.com/A7yrykh/qvarc/<ветка>/deploy/install.sh -o install.sh
#   nohup bash install.sh <почта владельца> [ветка] > install.log 2>&1 &
# Код берётся из GitHub в /opt/qvarc. Пароли и ключи создаются здесь же и пишутся только в /opt/qvarc/deploy/.env.
# Пока DNS кварц.рус не настроен, адреса временные: admin|book|api.<IP через дефисы>.sslip.io (указывают на этот же сервер).
# Выгрузки TravelLine, если нужны сразу, положить в /opt/qvarc/deploy/import до запуска setup.sh.
set -euo pipefail
OWNER_EMAIL="${1:?Укажите почту владельца: bash install.sh почта@пример.рф}"
BRANCH="${2:-main}"
IP="$(hostname -I | awk '{print $1}')"
IP_DASH="${IP//./-}"

# Подкачка 2 ГБ: сборка админки и модуля бронирования требует памяти
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 git openssl ufw
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || echo '{"registry-mirrors":["https://dockerhub.timeweb.cloud","https://mirror.gcr.io"]}' > /etc/docker/daemon.json
systemctl enable docker
systemctl restart docker

# Снаружи открыты только SSH и веб
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

if [ -d /opt/qvarc/.git ]; then
  git -C /opt/qvarc fetch -q origin "$BRANCH" && git -C /opt/qvarc checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" https://github.com/A7yrykh/qvarc.git /opt/qvarc
fi
mkdir -p /opt/qvarc/deploy/import

cd /opt/qvarc/deploy
NEW_ENV=0
if [ ! -f .env ]; then
  NEW_ENV=1
  OWNER_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  cp .env.example .env
  sed -i \
    -e "s|^ADMIN_HOST=.*|ADMIN_HOST=admin.$IP_DASH.sslip.io|" \
    -e "s|^BOOKING_HOST=.*|BOOKING_HOST=book.$IP_DASH.sslip.io|" \
    -e "s|^API_HOST=.*|API_HOST=api.$IP_DASH.sslip.io|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
    -e "s|^DOCUMENTS_KEY=.*|DOCUMENTS_KEY=$(openssl rand -base64 32)|" \
    -e "s|^SANDBOX_WEBHOOK_SECRET=.*|SANDBOX_WEBHOOK_SECRET=$(openssl rand -hex 24)|" \
    -e "s|^QVARC_OWNER_NAME=.*|QVARC_OWNER_NAME=Владелец|" \
    -e "s|^QVARC_OWNER_EMAIL=.*|QVARC_OWNER_EMAIL=$OWNER_EMAIL|" \
    -e "s|^QVARC_OWNER_PASSWORD=.*|QVARC_OWNER_PASSWORD=$OWNER_PASSWORD|" \
    .env
  chmod 600 .env
fi

./setup.sh

ADMIN="$(grep ^ADMIN_HOST= .env | cut -d= -f2)"
echo
echo "ГОТОВО. Админка: https://$ADMIN"
echo "Вход: $(grep ^QVARC_OWNER_EMAIL= .env | cut -d= -f2)"
[ "$NEW_ENV" = 1 ] && echo "Пароль владельца: $(grep ^QVARC_OWNER_PASSWORD= .env | cut -d= -f2)  (сохраните его)"
echo "Пароли и ключ паспортных данных: /opt/qvarc/deploy/.env — сделайте копию в надёжное место."
