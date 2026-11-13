#!/usr/bin/env bash
# Saves the database and the uploaded images to ./backups (keeps the latest 14 of each).
# If BACKUP_S3_* is set in .env, each backup is also copied off the droplet to S3-compatible
# storage (DigitalOcean Spaces, AWS S3, Cloudflare R2, Backblaze B2, ...), so a lost droplet
# doesn't take the backups with it. Old copies there are removed after BACKUP_KEEP_DAYS (30).
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

# Only the BACKUP_ lines are read, so other values in .env never reach the shell.
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    export "$key=$value"
  done < <(grep -E '^BACKUP_[A-Z0-9_]+=' .env || true)
fi
if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
  echo "Off-site copy skipped (no BACKUP_S3_BUCKET in .env)."
  exit 0
fi

export RCLONE_CONFIG_OFFSITE_TYPE=s3
export RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_OFFSITE_ENDPOINT="${BACKUP_S3_ENDPOINT:?Set BACKUP_S3_ENDPOINT in .env}"
export RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-us-east-1}"
export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:?Set BACKUP_S3_ACCESS_KEY in .env}"
export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:?Set BACKUP_S3_SECRET_KEY in .env}"
export RCLONE_CONFIG_OFFSITE_ACL=private
target="offsite:${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-tolie-blog}"

rclone() {  # run rclone from its official image; secrets go in by name, not on the command line
  docker run --rm -v "$PWD/backups:/backups:ro" \
    -e RCLONE_CONFIG_OFFSITE_TYPE -e RCLONE_CONFIG_OFFSITE_PROVIDER -e RCLONE_CONFIG_OFFSITE_ENDPOINT \
    -e RCLONE_CONFIG_OFFSITE_REGION -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID \
    -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY -e RCLONE_CONFIG_OFFSITE_ACL \
    rclone/rclone:1.68.2 "$@"
}

rclone copy "/backups/blog-$stamp.sql.gz" "$target/"
rclone copy "/backups/uploads-$stamp.tar.gz" "$target/"
rclone delete "$target/" --min-age "${BACKUP_KEEP_DAYS:-30}d"
echo "Copied both files to ${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-tolie-blog} (copies older than ${BACKUP_KEEP_DAYS:-30} days removed)."
