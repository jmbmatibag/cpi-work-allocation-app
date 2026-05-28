#!/bin/bash
# Nightly Postgres backup for the single-box EC2 deployment.
#
# What it does:
#   1. pg_dump the cpi_work_allocation database from the cpi-postgres container.
#   2. Gzip the dump to /opt/backups with a timestamped filename.
#   3. (Optional) Push the dump to S3 if BACKUP_S3_BUCKET is set.
#   4. Rotate: delete local dumps older than RETENTION_DAYS (default 30).
#
# Install on the EC2:
#   sudo mkdir -p /opt/backups && sudo chown ubuntu:ubuntu /opt/backups
#   sudo cp deploy/backup-db.sh /opt/cpi/backup-db.sh
#   sudo chmod +x /opt/cpi/backup-db.sh
#   crontab -e
#     0 2 * * * /opt/cpi/backup-db.sh >> /var/log/cpi-backup.log 2>&1
#
# Restore (test this once, on a non-prod DB or a freshly reset prod):
#   gunzip -c /opt/backups/cpi-20260601-020000.sql.gz \
#     | docker exec -i cpi-postgres psql -U cpi -d cpi_work_allocation

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CONTAINER="${CONTAINER:-cpi-postgres}"
DB_USER="${DB_USER:-cpi}"
DB_NAME="${DB_NAME:-cpi_work_allocation}"
# Set BACKUP_S3_BUCKET=cpi-app-backups (no trailing slash) to enable S3 sync.
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"

mkdir -p "$BACKUP_DIR"

TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/cpi-${TS}.sql.gz"

echo "[$(date -Iseconds)] starting backup → $OUT"

# --clean --if-exists makes the dump self-contained: restoring it into a
# populated DB will drop existing objects first. Safer for emergency restores.
docker exec "$CONTAINER" pg_dump \
    -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --clean --if-exists \
    | gzip > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "[$(date -Iseconds)] dump written: $OUT ($SIZE)"

if [[ -n "$BACKUP_S3_BUCKET" ]]; then
    if command -v aws >/dev/null; then
        echo "[$(date -Iseconds)] uploading to s3://$BACKUP_S3_BUCKET/"
        aws s3 cp "$OUT" "s3://$BACKUP_S3_BUCKET/$(basename "$OUT")" --only-show-errors
        echo "[$(date -Iseconds)] s3 upload complete"
    else
        echo "[$(date -Iseconds)] WARNING: BACKUP_S3_BUCKET is set but aws CLI not installed — skipping upload"
    fi
fi

# Rotate local dumps
DELETED=$(find "$BACKUP_DIR" -name 'cpi-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
echo "[$(date -Iseconds)] rotated $DELETED files older than $RETENTION_DAYS days"

echo "[$(date -Iseconds)] backup done"
