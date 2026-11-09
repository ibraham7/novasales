#!/usr/bin/env bash
# فحص قبل النقل (قراءة فقط، لا يكتب شيئاً): الاتصال بالقاعدتين، حالة الجديدة (يجب أن تكون فاضية)، ومفاتيح الملفات.
set -euo pipefail
cd "$(dirname "$0")"
ENVF="${1:-./migrate.env}"
[ -f "$ENVF" ] || { echo "الملف $ENVF غير موجود."; exit 1; }
set -a; . "$ENVF"; set +a
bad=0
if grep -q -E 'OLDREF|NEWREF|OLDPASSWORD|NEWPASSWORD|service_role_key_of' "$ENVF"; then echo "❌ migrate.env فيه قيم لم تُبدَّل بعد"; bad=1; fi
[ "$OLD_DB_URL" != "$NEW_DB_URL" ] || { echo "❌ رابط القديم والجديد متطابقان"; bad=1; }
psqlq() { docker run --rm --env-file "$ENVF" postgres:17 sh -c "psql \"\$$1\" -At -v ON_ERROR_STOP=1 -c \"$2\""; }

echo "== القاعدة القديمة =="
psqlq OLD_DB_URL "select 'PostgreSQL ' || current_setting('server_version') || ' | جداول public: ' || (select count(*) from pg_tables where schemaname='public') || ' | مستخدمون: ' || (select count(*) from auth.users)" || bad=1
echo "== القاعدة الجديدة (يجب أن تكون فاضية) =="
psqlq NEW_DB_URL "select 'PostgreSQL ' || current_setting('server_version') || ' | جداول public: ' || (select count(*) from pg_tables where schemaname='public') || ' | مستخدمون: ' || (select count(*) from auth.users)" || bad=1
n="$(psqlq NEW_DB_URL "select (select count(*) from pg_tables where schemaname='public') + (select count(*) from auth.users)" 2>/dev/null || echo x)"
if [ "$n" != "0" ]; then echo "❌ القاعدة الجديدة ليست فاضية (أو تعذّر الفحص): $n"; bad=1; else echo "✅ الجديدة فاضية"; fi

echo "== مفاتيح التخزين =="
for side in OLD NEW; do
  url_var="${side}_SUPABASE_URL"; key_var="${side}_SERVICE_KEY"
  code="$(docker run --rm --env-file "$ENVF" node:22-slim node -e "
    fetch(process.env.${url_var}.replace(/\/\$/, '') + '/storage/v1/bucket', { headers: { Authorization: 'Bearer ' + process.env.${key_var}, apikey: process.env.${key_var} } })
      .then(async (r) => { const t = await r.text(); let n = ''; try { n = JSON.parse(t).length + ' bucket'; } catch {} console.log(r.status + ' ' + n); })
      .catch((e) => console.log('ERR ' + e.message));
  ")"
  echo "$side: $code"
  case "$code" in 200*) ;; *) bad=1;; esac
done
echo
if [ "$bad" = 0 ]; then echo "✅ كل شيء جاهز للنقل."; else echo "❌ في مشاكل بالأعلى. أصلحها قبل النقل."; exit 1; fi
