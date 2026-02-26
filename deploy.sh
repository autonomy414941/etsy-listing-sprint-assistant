#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="etsy-listing-sprint-assistant:latest"
CONTAINER_NAME="etsy-listing-sprint-assistant"
TRAEFIK_DYNAMIC_DIR="/data/coolify/proxy/dynamic"
PERSIST_DIR="$ROOT_DIR/../data/etsy-listing-sprint-assistant"

cd "$ROOT_DIR"

docker build -t "$IMAGE_NAME" .

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
mkdir -p "$PERSIST_DIR"

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network coolify \
  -e DATA_DIR=/data \
  -e PUBLIC_BASE_URL="http://etsy-listing.46.225.49.219.nip.io" \
  -v "$PERSIST_DIR:/data" \
  "$IMAGE_NAME" >/dev/null

cp "$ROOT_DIR/infra/etsy-listing-sprint-assistant.traefik.yaml" "$TRAEFIK_DYNAMIC_DIR/etsy-listing-sprint-assistant.yaml"

echo "Deployed: https://etsy-listing.devtoolbox.dedyn.io"
