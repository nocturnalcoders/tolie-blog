#!/usr/bin/env bash
# First-time setup: creates .env (database password, secret key, admin login).
#   bash deploy/setup.sh                    create everything
#   bash deploy/setup.sh --reset-password   only change the admin password
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null 2>&1 || { echo "Docker isn't installed on this machine."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose (the 'docker compose' command) isn't available."; exit 1; }

rand() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

set_var() {  # set_var KEY VALUE  (replace the line, or add it)
  if grep -q "^$1=" .env 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}

ask_admin() {
  local user pass pass2
  while true; do
    read -rp "Admin username [admin]: " user
    user=${user:-admin}
    [[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] && break
    echo "Use only letters, numbers, dot, dash or underscore."
  done
  while true; do
    read -rsp "Admin password (at least 12 characters): " pass; echo
    [ "${#pass}" -ge 12 ] || { echo "That's too short."; continue; }
    read -rsp "Repeat it: " pass2; echo
    [ "$pass" = "$pass2" ] && break
    echo "Those didn't match."
  done
  echo "Preparing the app image (first time takes a minute)..."
  docker compose build api >/dev/null
  local hash
  hash=$(printf '%s' "$pass" | docker compose run --rm -T --no-deps api python manage.py hash)
  set_var BLOG_ADMIN_USER "$user"
  set_var BLOG_ADMIN_HASH_B64 "$hash"
}

if [ "${1:-}" = "--reset-password" ]; then
  [ -f .env ] || { echo "No .env yet. Run this script without options first."; exit 1; }
  ask_admin
  docker compose up -d api
  echo "Password changed."
  exit 0
fi

if [ -f .env ]; then
  echo ".env already exists, so nothing was changed."
  echo "To change the admin password: bash deploy/setup.sh --reset-password"
  exit 0
fi

umask 077
{
  echo "POSTGRES_PASSWORD=$(rand)"
  echo "BLOG_SECRET_KEY=$(rand)"
  echo "BLOG_ADMIN_USER=admin"
  echo "BLOG_ADMIN_HASH_B64=pending"
  echo "BLOG_SITE_URL=https://blog.tolie.space"
} > .env

ask_admin
echo
echo "Done. .env is ready. Next: docker compose up -d --build"
