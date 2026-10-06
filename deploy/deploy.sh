#!/bin/bash
# Builds locally, copies the build to the server and (re)starts the systemd user service.
# Usage: deploy/deploy.sh [ssh-host] [path]   (default: elmer srv/bikeboi)
set -euo pipefail
HOST=${1:-elmer}
DIR=${2:-srv/bikeboi}
SSH_OPTS="-o ClearAllForwardings=yes"
cd "$(dirname "$0")/.."

bun test
rm -rf dist
bun run build

# Only the build, the server and the service files go up. --delete clears old hashed
# assets inside dist/ and deploy/; .env and anything else on the server is left alone.
ssh $SSH_OPTS "$HOST" "mkdir -p '$DIR'"
rsync -az --delete -e "ssh $SSH_OPTS" dist deploy server.ts package.json "$HOST:$DIR/"

ssh $SSH_OPTS "$HOST" "DIR=$DIR bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p ~/.config/systemd/user
cp "$HOME/$DIR/deploy/bikeboi.service" ~/.config/systemd/user/bikeboi.service
systemctl --user daemon-reload
systemctl --user enable bikeboi >/dev/null 2>&1
systemctl --user restart bikeboi
sleep 2
systemctl --user --no-pager status bikeboi | head -4
PORT=$(systemctl --user show bikeboi -p Environment --value | tr ' ' '\n' | sed -n 's/^PORT=//p')
BASE="http://127.0.0.1:${PORT:-3070}"
curl -fsS "$BASE/healthz" && echo
# the page must point at a script that the server actually has
JS=$(curl -fsS "$BASE/" | grep -o 'src="[^"]*\.js"' | head -1 | sed 's/src="\.\{0,1\}//; s/"$//')
curl -fsS -o /dev/null -w "$JS -> %{http_code}\n" "$BASE$JS"
REMOTE
