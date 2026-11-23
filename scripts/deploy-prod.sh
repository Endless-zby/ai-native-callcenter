#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Build the branch this production host checks out and restart the stack.
#
#   scripts/deploy-prod.sh [branch]     # default: custom
#
# The application image is built on the production host from its own clone at
# /opt/aicc: no registry is involved, and PostgreSQL and FreeSWITCH are left
# running with their volumes. The deploy ends with aicc doctor.
set -euo pipefail

BRANCH="${1:-custom}"
HOST="${AICC_PROD_HOST:-aicc-root}"
DEPLOY_DIR=/opt/aicc/deploy
# The address doctor checks against: the host's own, read from the host
# rather than written down here.
EXTERNAL_IP="${AICC_PROD_IP:-}"

echo "== $HOST: pull $BRANCH"
ssh "$HOST" "cd /opt/aicc && git fetch origin --prune && git checkout '$BRANCH' && git reset --hard 'origin/$BRANCH' && git log --oneline -1"

echo "== build the application image"
ssh "$HOST" "cd $DEPLOY_DIR && docker compose build aicc"

echo "== restart the application container"
# --force-recreate: rebuilding with the same tag does not always make compose
# replace the container, and a deploy that leaves the old binary running looks
# like a success. Only aicc is recreated; PostgreSQL and the switch stay up.
ssh "$HOST" "cd $DEPLOY_DIR && docker compose up -d --force-recreate aicc && docker compose ps"

echo "== doctor"
if [ -z "$EXTERNAL_IP" ]; then
  EXTERNAL_IP=$(ssh "$HOST" "hostname -I | cut -d' ' -f1")
fi
ssh "$HOST" "cd $DEPLOY_DIR && docker compose exec -T aicc aicc doctor --host-addrs $EXTERNAL_IP,127.0.0.1 --wait 60s"
