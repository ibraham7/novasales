#!/usr/bin/env bash
# يقارن عدد الصفوف بين القديم والجديد (كل جداول public + المستخدمين + الملفات). لازم تتطابق.
set -euo pipefail
cd "$(dirname "$0")"
ENVF="${1:-./migrate.env}"
[ -f "$ENVF" ] || { echo "الملف $ENVF غير موجود."; exit 1; }
Q="select format('%s|%s', t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %s', t), false, true, '')))[1]::text)
from (select format('public.%I', tablename) as t from pg_tables where schemaname='public'
      union all select 'auth.users' union all select 'auth.identities') x order by 1;"
dump() { docker run --rm --env-file "$ENVF" postgres:17 sh -c "psql \"\$$1\" -At -v ON_ERROR_STOP=1 -c \"$Q\""; }
dump OLD_DB_URL > /tmp/verify-old.txt
dump NEW_DB_URL > /tmp/verify-new.txt
if diff /tmp/verify-old.txt /tmp/verify-new.txt; then
  echo "✅ كل الأعداد متطابقة ($(wc -l < /tmp/verify-old.txt) جدول)."
else
  echo "❌ في اختلاف بالأعلى (< القديم، > الجديد)."; exit 1
fi
