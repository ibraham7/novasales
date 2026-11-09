# نقل قاعدة البيانات إلى مشروع Supabase جديد

يتم النقل **من القديم إلى الجديد دون لمس القديم** (القراءة فقط منه). إذا حصل أي خلل نرجع للقديم بتغيير سطور `.env` فقط.

## قبل البدء
1. مشروع Supabase **جديد وفاضي** (منطقة أقرب للسيرفر). كلمة سر القاعدة: **حروف وأرقام فقط** (بدون رموز) لتجنّب مشاكل الروابط.
2. من لوحة كل مشروع: زر **Connect** ← **Session pooler** ← انسخ الرابط (يدعم IPv4). ومن **Project Settings ← API** انسخ **service_role** key.
3. على السيرفر:
   ```
   cd /opt/novasales/scripts/migrate-supabase
   cp migrate.env.example migrate.env
   nano migrate.env        # املأ القيم (بدون علامات اقتباس)
   chmod 600 migrate.env
   ```
   **لا تُرسل `migrate.env` ولا أي قيمة منه لأحد.**

## فحص قبل النقل (مرة، قراءة فقط)
`./00-check.sh` يتأكد من الاتصال بالقاعدتين، ومن أن الجديدة فاضية، ومن صحة مفتاحي `service_role`. يجب أن يظهر ✅ قبل النافذة.

## نافذة الصيانة (حوالي 20 إلى 30 دقيقة، يُفضّل ليلاً)
1. أوقف الموقع: `cd /opt/novasales && docker compose stop` (حتى لا تُكتب بيانات أثناء النقل). لاحظ أن رسائل واتساب الواردة بهذه الفترة لن تُحفظ.
2. `./01-dump.sh` نسخة كاملة (قراءة فقط). انسخ مجلد `backup/` لمكان آمن خارج السيرفر.
3. `./02-restore.sh` يرجّع النسخة في الجديد (اكتب YES). الجديد يجب أن يكون فاضياً.
4. `./04-verify.sh` يقارن عدد الصفوف. يجب أن تظهر ✅. **إذا ظهر ❌ لا تكمل.**
5. `./03-copy-storage.sh` ينسخ الملفات (صور وفيديو وملفات CRM). آمن للتكرار.
6. بالمشروع الجديد: **Authentication ← URL Configuration**: Site URL = `https://sales.novanoai.online`. وطابق إعدادات **Authentication ← Providers/Sign In** مع القديم.
7. بدّل القيم في `/opt/novasales/.env` (احفظ نسخة قبلها: `cp /opt/novasales/.env /opt/novasales/.env.old`):
   - `SUPABASE_URL` و`VITE_SUPABASE_URL` = رابط المشروع الجديد
   - `SUPABASE_PUBLISHABLE_KEY` و`VITE_SUPABASE_PUBLISHABLE_KEY` = المفتاح العام (anon/publishable) الجديد
   - `SUPABASE_SERVICE_ROLE_KEY` = مفتاح service_role الجديد
8. أعد البناء: `cd /opt/novasales && docker compose up -d --build`
9. جرّب: دخول، المحادثات، قمع المبيعات، فتح ملف، رفع صورة منتج.

## الرجوع للقديم (إذا فشل شيء)
`cp /opt/novasales/.env.old /opt/novasales/.env && docker compose up -d --build`
القاعدة القديمة لم تتغير، فلا ضياع بيانات (ما دام الموقع كان متوقفاً أثناء النقل).

## ملاحظات
- المستخدمون يحتفظون بكلمات سرهم، لكن **سيسجّلون الدخول مرة وحدة من جديد** (المفتاح السري تغيّر).
- الخطة المجانية **بدون نسخ احتياطي تلقائي**. بعد النقل شغّل 01-dump.sh دورياً (أو جدوله بـcron) واحفظ النسخ خارج السيرفر.
- أبقِ المشروع القديم أسبوعاً على الأقل قبل حذفه.
