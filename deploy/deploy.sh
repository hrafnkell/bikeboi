#!/bin/bash
# Builds locally, copies the build to the server and (re)starts the systemd user service.
# Usage: deploy/deploy.sh [ssh-host] [path]   (default: elmer srv/bikeboi)
set -euo pipefail
HOST=${1:-elmer}
DIR=${2:-srv/bikeboi}
SSH_OPTS="-o ClearAllForwardings=yes"
cd "$(dirname "$0")/.."

bun test
bun run typecheck
rm -rf dist
bun run build

# The build, the server code and the service files go up. --delete only acts inside the
# directories named here; data/ (the database), backups/ and .env are never touched.
ssh $SSH_OPTS "$HOST" "mkdir -p '$DIR'"
rsync -az --delete -e "ssh $SSH_OPTS" dist deploy server src server.ts package.json "$HOST:$DIR/"

ssh $SSH_OPTS "$HOST" "DIR=$DIR bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p ~/.config/systemd/user "$HOME/$DIR/data" "$HOME/$DIR/backups"
# secrets live in .env (read by the service, never synced); make the sealing key once
if ! grep -qs '^SECRET_KEY=' "$HOME/$DIR/.env"; then
  (umask 077; echo "SECRET_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$HOME/$DIR/.env")
  echo "created SECRET_KEY in $DIR/.env"
fi
cp "$HOME/$DIR/deploy/bikeboi.service" ~/.config/systemd/user/bikeboi.service
cp "$HOME/$DIR/deploy/bikeboi-backup.service" "$HOME/$DIR/deploy/bikeboi-backup.timer" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable bikeboi >/dev/null 2>&1
systemctl --user enable --now bikeboi-backup.timer >/dev/null 2>&1
systemctl --user restart bikeboi
sleep 2
systemctl --user --no-pager status bikeboi | head -4
PORT=$(systemctl --user show bikeboi -p Environment --value | tr ' ' '\n' | sed -n 's/^PORT=//p')
BASE="http://127.0.0.1:${PORT:-3070}"
curl -fsS "$BASE/healthz" && echo
curl -fsS "$BASE/api/health" && echo
# the page must point at a script that the server actually has
JS=$(curl -fsS "$BASE/" | grep -o 'src="[^"]*\.js"' | head -1 | sed 's/src="\.\{0,1\}//; s/"$//')
curl -fsS -o /dev/null -w "$JS -> %{http_code}\n" "$BASE$JS"
REMOTE
