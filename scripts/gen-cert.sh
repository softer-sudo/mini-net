#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/server.key" ] && [ -f "$CERT_DIR/server.cert" ]; then
  echo "certs already exist in $CERT_DIR, skipping (delete them to regenerate)"
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl not found on PATH. Install it (e.g. 'brew install openssl' or 'apt-get install openssl') and re-run." >&2
  exit 1
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.cert" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "generated $CERT_DIR/server.key and $CERT_DIR/server.cert"
