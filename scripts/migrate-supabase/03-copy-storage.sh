#!/usr/bin/env bash
# ينسخ ملفات التخزين (صور المنتجات، الفيديو، ملفات CRM) من القديم للجديد. آمن للتكرار.
set -euo pipefail
cd "$(dirname "$0")"
ENVF="${1:-./migrate.env}"
[ -f "$ENVF" ] || { echo "الملف $ENVF غير موجود."; exit 1; }
docker run --rm --env-file "$ENVF" -v "$PWD/copy-storage.mjs:/app/copy-storage.mjs:ro" node:22-slim node /app/copy-storage.mjs
