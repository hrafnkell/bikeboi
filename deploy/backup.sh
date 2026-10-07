#!/bin/bash
# Nightly copy of the database: online backup, integrity check, gzip, keep 14 days.
# Run by bikeboi-backup.timer; works while the service is running (WAL mode).
set -euo pipefail
DIR=${BIKEBOI_DIR:-$HOME/srv/bikeboi}
DB=${DB_PATH:-$DIR/data/bikeboi.db}
OUT=${BACKUP_DIR:-$DIR/backups}
mkdir -p "$OUT"
[ -f "$DB" ] || { echo "no database at $DB"; exit 0; }

stamp=$(date +%F)
tmp="$OUT/bikeboi-$stamp.db"
sqlite3 "$DB" ".backup '$tmp'"
check=$(sqlite3 "$tmp" "PRAGMA integrity_check")
if [ "$check" != "ok" ]; then
  echo "integrity check failed: $check"
  rm -f "$tmp"
  exit 1
fi
rides=$(sqlite3 "$tmp" "SELECT count(*) FROM rides")
users=$(sqlite3 "$tmp" "SELECT count(*) FROM users")
gzip -f "$tmp"
find "$OUT" -name 'bikeboi-*.db.gz' -mtime +14 -delete
echo "backup $stamp ok: $users users, $rides rides; $(du -sh "$DB" | cut -f1) live, $(du -sh "$OUT" | cut -f1) in backups"
