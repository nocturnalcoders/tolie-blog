#!/usr/bin/env bash
# Saves the database and the uploaded images to ./backups (keeps the latest 14 of each).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M)

docker compose exec -T db pg_dump -U blog blog | gzip > "backups/blog-$stamp.sql.gz"
docker run --rm -v tolie-blog_uploads:/data:ro -v "$PWD/backups:/out" alpine \
  tar czf "/out/uploads-$stamp.tar.gz" -C /data .

ls -1t backups/blog-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t backups/uploads-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Saved backups/blog-$stamp.sql.gz and backups/uploads-$stamp.tar.gz"
