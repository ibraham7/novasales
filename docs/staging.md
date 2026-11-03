# النسخة التجريبية (Staging) لفرع `feature/marketing-outbound`

تشغّل الفرع على السيرفر **بجانب** الموقع الحقيقي، على منفذ داخلي `18082`، بدون أي تعديل على `novasales-web` أو `/opt/novasales`.

## قاعدة البيانات: قرار لازم قبل البدء

الموقع الحقيقي يشغّل مؤقّت الحملات كل دقيقة على قاعدة Supabase الحالية. أي حملة صادرة (outbound) تُعتمد من النسخة التجريبية على **نفس القاعدة** يلتقطها الموقع الحقيقي بكوده القديم، أي **بدون فحص قائمة «لا ترسل»** وبدون ربط الردود. لذلك:

- **الموصى به:** مشروع Supabase منفصل للتجربة (الخطة المجانية تكفي). تُطبَّق عليه كل ملفات `supabase/migrations` بالترتيب، وتنشئ فيه مستخدماً ومؤسسة تجريبية.
- **البديل (غير موصى به):** نفس القاعدة الحقيقية. مقبول فقط لتجربة الصفحة (اكتشاف/اعتماد/لا ترسل) **دون اعتماد أي حملة**، وبعد تشغيل ملفّي الترحيل الجديدين.

ملاحظة الردود: ويبهوك Evolution يشير للموقع الحقيقي. لتجربة تتبّع الردود على النسخة التجريبية لازم Instance واتساب مخصص للتجربة ويبهوكه يشير إليها (بدون تعديل الـInstances الحالية).

## التشغيل على السيرفر

```bash
# 1) نسخة عمل منفصلة من نفس ما يشغّله الموقع الآن + الفرع الجديد (لا يُدفع شيء)
cd /opt/novasales
git fetch origin
git worktree add /opt/novasales-staging -b staging-marketing HEAD
cd /opt/novasales-staging
git merge --no-edit origin/feature/marketing-outbound

# 2) ملف البيئة (يبقى على السيرفر فقط، لا يُرسل في المحادثة)
cp /opt/novasales/.env .env.staging
nano .env.staging
#   - SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY: مشروع التجربة
#   - PUBLIC_APP_URL=http://localhost:18082
#   - احذف أو أفرغ: META_*، EVOLUTION_WEBHOOK_TOKEN، مفاتيح VAPID (حتى لا ترسل النسخة التجريبية أشياء حقيقية)
#   - EVOLUTION_API_URL / EVOLUTION_API_KEY: فقط لـ Instance تجريبي
#   - GOOGLE_PLACES_API_KEY: اختياري (بدونها تعمل الإضافة اليدوية)

# 3) البناء والتشغيل
docker compose -p novasales-staging -f compose.staging.yaml --env-file .env.staging up -d --build
docker compose -p novasales-staging ps
```

## الدخول

بدون فتح منفذ للعالم: من جهازك

```bash
ssh -L 18082:127.0.0.1:18082 root@186.241.26.155
```

ثم افتح `http://localhost:18082`.

## الإيقاف والحذف (لا يمس الموقع الحقيقي)

```bash
cd /opt/novasales-staging
docker compose -p novasales-staging -f compose.staging.yaml down
```

## التحديث بعد كل دفعة جديدة على الفرع

```bash
cd /opt/novasales-staging && git fetch origin && git merge --no-edit origin/feature/marketing-outbound \
 && docker compose -p novasales-staging -f compose.staging.yaml --env-file .env.staging up -d --build
```

## خطة تجربة آمنة

1. الإعدادات ← فعّل «السماح بالإرسال عبر واتساب غير الرسمي» (مالك المؤسسة، مع الإقرارات).
2. أضف 2–3 جهات **أرقام الفريق** يدوياً → اعتمدها.
3. «إنشاء حملة من المعتمدين» ← معاينة ← اعتماد نهائي (حد الإرسال البطيء).
4. من رقم فريق: ردّ نصاً عادياً ثم الكلمة «إيقاف» وتأكد أنه دخل «لا ترسل» وأن الحالة تغيّرت.
5. شغّل المؤقّت يدوياً (زر «معالجة الحملات») لأن `CAMPAIGN_AUTO_TICK` مطفأ هنا.
