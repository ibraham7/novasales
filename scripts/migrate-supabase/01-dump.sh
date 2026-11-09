#!/usr/bin/env bash
# نسخة كاملة من القاعدة القديمة (قراءة فقط، لا تغيّر شيئاً فيها).
set -euo pipefail
cd "$(dirname "$0")"
ENVF="${1:-./migrate.env}"
[ -f "$ENVF" ] || { echo "الملف $ENVF غير موجود. انسخ migrate.env.example إلى migrate.env واملأه."; exit 1; }
mkdir -p backup
OUT="backup/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
run() { docker run --rm --env-file "$ENVF" -v "$PWD/$OUT:/out" postgres:17 sh -c "$1"; }

echo "1/4 جداول التطبيق (public)..."
run 'pg_dump "$OLD_DB_URL" --schema=public --no-owner --file=/out/public.sql'
echo "2/4 المستخدمون وكلمات السر (auth.users, auth.identities)..."
run 'pg_dump "$OLD_DB_URL" --data-only --column-inserts --rows-per-insert=50 --no-owner --table=auth.users --table=auth.identities --file=/out/auth.sql'
echo "3/4 إعدادات مجلدات الملفات (storage.buckets)..."
run 'pg_dump "$OLD_DB_URL" --data-only --column-inserts --no-owner --table=storage.buckets --file=/out/buckets.sql'
echo "4/4 صلاحيات anon/authenticated (لننسخها حرفياً)..."
run 'psql "$OLD_DB_URL" -At -v ON_ERROR_STOP=1 -c "
select format(\$f\$grant %s on %s %s to %s;\$f\$, string_agg(a.privilege_type, \$f\$,\$f\$), case c.relkind when \$f\$S\$f\$ then \$f\$sequence\$f\$ else \$f\$table\$f\$ end, c.oid::regclass, r.rolname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
where n.nspname = \$f\$public\$f\$ and c.relkind in (\$f\$r\$f\$,\$f\$p\$f\$,\$f\$v\$f\$,\$f\$m\$f\$,\$f\$S\$f\$) and r.rolname in (\$f\$anon\$f\$,\$f\$authenticated\$f\$)
group by c.oid, c.relkind, r.rolname
union all
select format(\$f\$grant execute on function %s to %s;\$f\$, p.oid::regprocedure, r.rolname)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
where n.nspname = \$f\$public\$f\$ and r.rolname in (\$f\$anon\$f\$,\$f\$authenticated\$f\$) and a.privilege_type = \$f\$EXECUTE\$f\$;
" > /out/grants.sql'

echo "$OUT" > backup/LATEST
echo; echo "تمت النسخة في: $OUT"; ls -lh "$OUT"
echo "احتفظ بهذا المجلد (فيه بيانات المستخدمين)، وانسخه لمكان آمن خارج السيرفر."
