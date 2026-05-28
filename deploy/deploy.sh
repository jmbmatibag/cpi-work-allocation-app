#!/bin/bash
# Redeploy script for the single-box EC2 host.
#
# Workflow:
#   - Local: fix issue, commit, git push
#   - Server: ssh in, run this script
#
# What it does:
#   1. Pulls latest main from origin (refuses to run with dirty working tree).
#   2. Rebuilds the shared package (file: dependency, has to be rebuilt by hand).
#   3. Reinstalls + rebuilds the API; runs `prisma migrate deploy` if there
#      are new migrations; restarts the PM2 process.
#   4. Reinstalls + rebuilds the frontend; reloads Nginx so it serves the new
#      hashed assets immediately.
#
# Usage:
#   cd /opt/cpi/cpi-work-allocation-app
#   ./deploy/deploy.sh
#
# Add --no-pull to skip git pull (e.g. when testing local edits on the server).
# Add --skip-frontend to deploy backend-only changes (faster).
# Add --skip-migrate to skip prisma migrate deploy (when you know schema is unchanged).

set -euo pipefail

PULL=1
DO_FRONTEND=1
DO_MIGRATE=1

for arg in "$@"; do
    case "$arg" in
        --no-pull)        PULL=0 ;;
        --skip-frontend)  DO_FRONTEND=0 ;;
        --skip-migrate)   DO_MIGRATE=0 ;;
        *) echo "Unknown arg: $arg" >&2; exit 2 ;;
    esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "==> Deploying from $ROOT"

if [[ "$PULL" -eq 1 ]]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "ERROR: working tree is dirty. Commit or stash before deploying."
        echo "       (or rerun with --no-pull to deploy current local state)"
        exit 1
    fi
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    echo "==> git pull origin $BRANCH"
    git pull --ff-only origin "$BRANCH"
fi

echo
echo "==> Building shared package"
cd "$ROOT/cpi-work-allocation-shared"
npm ci
npm run build

echo
echo "==> Building API"
cd "$ROOT/cpi-work-allocation-api"
npm ci
npm run build

if [[ "$DO_MIGRATE" -eq 1 ]]; then
    echo
    echo "==> Applying Prisma migrations (if any)"
    npx prisma migrate deploy
fi

echo
echo "==> Restarting API via PM2"
pm2 restart cpi-api --update-env
pm2 save

if [[ "$DO_FRONTEND" -eq 1 ]]; then
    echo
    echo "==> Building frontend"
    cd "$ROOT/cpi-work-allocation-frontend"
    npm ci
    npm run build

    echo
    echo "==> Reloading Nginx"
    sudo systemctl reload nginx
fi

echo
echo "==> Deploy complete."
echo
echo "Recent API logs:"
pm2 logs cpi-api --lines 15 --nostream || true
