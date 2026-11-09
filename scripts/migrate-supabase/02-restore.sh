#!/usr/bin/env bash
# يرجّع آخر نسخة (01-dump.sh) في القاعدة الجديدة. القاعدة الجديدة يجب أن تكون فاضية.
set -euo pipefail
cd "$(dirname "$0")"
ENVF="${1:-./migrate.env}"
[ -f "$ENVF" ] || { echo "الملف $ENVF غير موجود."; exit 1; }
[ -f backup/LATEST ] || { echo "لا توجد نسخة. شغّل 01-dump.sh أولاً."; exit 1; }
OUT="$(cat backup/LATEST)"
set -a; . "$ENVF"; set +a
[ "$OLD_DB_URL" != "$NEW_DB_URL" ] || { echo "رابط القديم والجديد متطابقان! توقف."; exit 1; }
HOST="$(echo "$NEW_DB_URL" | sed -E 's#^[a-z]+://[^@]*@([^/:]+).*#\1#')"
echo "سيتم الاسترجاع في: $HOST"
echo "من النسخة: $OUT"
read -r -p "اكتب YES للمتابعة: " ans
[ "$ans" = "YES" ] || { echo "أُلغي."; exit 1; }

{
  echo "set session_replication_role = replica;"   # لا تُشغَّل المشغّلات أثناء نسخ البيانات
  cat "$OUT/auth.sql"
  cat "$OUT/buckets.sql"
  grep -v '^CREATE SCHEMA public;' "$OUT/public.sql"
  echo "set session_replication_role = origin;"
  # صلاحيات: نمسح ما أعطته القاعدة الجديدة افتراضياً ثم نطبّق صلاحيات القديمة حرفياً.
  echo "revoke all on all tables in schema public from anon, authenticated;"
  echo "revoke all on all sequences in schema public from anon, authenticated;"
  echo "revoke all on all functions in schema public from anon, authenticated;"
  cat "$OUT/grants.sql"
  # مشغّل إنشاء الملف الشخصي عند تسجيل مستخدم جديد (كان موجوداً في القاعدة القديمة).
  echo "drop trigger if exists on_auth_user_created on auth.users;"
  echo "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();"
} > "$OUT/restore.sql"

docker run --rm --env-file "$ENVF" -v "$PWD/$OUT:/out" postgres:17 sh -c 'psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f /out/restore.sql'
echo; echo "تم الاسترجاع. شغّل الآن 04-verify.sh ثم 03-copy-storage.sh."
