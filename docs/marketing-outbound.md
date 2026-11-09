# التسويق (Outbound) — فرع `feature/marketing-outbound`

> هذا العمل على فرع منفصل ولا يدخل الموقع الأساسي حتى يُقرَّر الدمج. الميزة تُبنى على مراحل.

## ما يعمل في المرحلة الحالية (1): اكتشاف ومراجعة
- صفحة **التسويق** (`/marketing`) لمن يملك صلاحية `cmp.campaigns.manage`.
- بحث في Google Places (New) بنوع النشاط والكلمات والدولة والمدينة واللغة وأقل تقييم وعدد النتائج (حتى 60).
- النتائج تُحفظ في الجدولين `ob_searches` و`ob_prospects` (منفصلان عن جهات الاتصال والعملاء المحتملين، فلا يتأثر CRM ولا حدود الخطة).
- جدول بفلاتر (هاتف، جوال محتمل، موقع، تقييم، حالة، عملية بحث) وتحديد جماعي وإجراءات (مؤهل / اعتماد للتواصل / مراجعة / استبعاد) ودرج تفاصيل وملاحظات.
- منع التكرار: نفس مكان Google لا يُحفظ مرتين في المؤسسة، وإعادة البحث تحدّث بياناته وتبقي حالته وملاحظاته.
- **لا يُرسل أي شيء من هذه المرحلة.** «اعتماد للتواصل» حالة فقط.

## الإعداد المطلوب
1. شغّل `supabase/migrations/20261103120000_marketing_prospects.sql` في Supabase SQL Editor (جداول إضافية فقط).
2. مفتاح Google (على السيرفر فقط، وليس في الكود):
   - في Google Cloud: أنشئ مشروعاً وفعّل الفوترة، ثم فعّل **Places API (New)**، وأنشئ مفتاح API وقيّده بعنوان IP للسيرفر وبواجهة Places API فقط.
   - أضف إلى `.env`: `GOOGLE_PLACES_API_KEY=...`
3. اختياري في `.env`:
   - `MARKETING_MAX_REQUESTS_PER_MONTH` الحد الشهري لطلبات Google لكل مؤسسة (الافتراضي 300).
   - `PLACES_PRICE_PER_1000_USD` سعر الألف طلب لحساب **تقدير** التكلفة (الافتراضي 35). الرقم الحقيقي من صفحة أسعار Google.

## بيانات Google وقيود التخزين
- يُحفظ `place_id` بلا حد زمني، وباقي البيانات تُعامل كذاكرة مؤقتة: العمود `expires_at` = وقت الجلب + 30 يوماً. **لم تُبنَ بعد مهمة تنظيف/تحديث تلقائية** عند انتهاء الصلاحية.
- قيود Google على التخزين وإعادة الاستعمال والتسويق المباشر لم تُحسم بعد من مصدرها الرسمي، وتحتاج موقفاً قانونياً قبل ربط هذه البيانات بالإرسال أو نسخها إلى CRM.

## المرحلة 2: اعتماد وحملة واتساب وردود
- **إضافة جهة يدوياً** (لتجربة الحملة على أرقام فريقك بدون Google).
- **حملة Outbound** (تبويب «الحملات» أو زر «إنشاء حملة من المعتمدين»): ثلاث خطوات (المستلمون، الرسالة والرقم والسرعة والموعد، الاعتماد النهائي بثلاث إقرارات). لا يُرسل شيء قبل الاعتماد النهائي.
- تعيد استعمال محرك الحملات الحالي (التباطؤ، حماية الرقم، المؤقّت). تُنشأ الحملة بحالة «مجدولة» مع سجل اعتماد (`compliance_snapshot`) يوضح من اعتمد وماذا.
- **المستلمون:** الجهات بحالة «معتمد للتواصل» فقط، بلا رقم ثابت/بلا رقم/ضمن «لا ترسل»/المنتظرة في حملة أخرى/المكررة. الحد الأقصى `OUTBOUND_MAX_RECIPIENTS` (200) والسرعة `OUTBOUND_MAX_THROTTLE` (10 بالدقيقة).
- **جملة الإيقاف** تُضاف تلقائياً لكل رسالة، ومن يردّ بكلمة إيقاف (عربي/إنجليزي/تركي) يُضاف إلى «لا ترسل».
- **قائمة «لا ترسل»** تُطبَّق على **كل** الحملات (قديمة وجديدة): المرسِل يتخطى هذه الأرقام (حالة `skipped`).
- **ربط الردود:** رسالة واردة من رقم أُرسل إليه خلال 14 يوماً تُسجَّل (`replied_at`) وتتحول حالة الجهة إلى «رد»، وتُربط بجهة الاتصال التي ينشئها النظام عند أول رد.
- **القناة:** الإرسال عبر الرقم **الرسمي** معطّل (يحتاج قوالب Meta ولم يُبنَ). الأرقام **غير الرسمية** معطّلة افتراضياً، ويفعّلها مالك المؤسسة من «الإعدادات» بعد إقرار صريح بالمخاطر (يُسجَّل من فعّل ومتى).

### تعديلات على أجزاء قائمة (للمراجعة قبل الدمج)
- `supabase/migrations/20261104120000_marketing_outbound_campaigns.sql`: **يخفف قيداً واحداً على جدول قائم:** `cmp_recipients.contact_id` يصبح اختيارياً (مستلم Outbound ليس جهة اتصال في CRM بعد). يضيف أيضاً أعمدة اختيارية (`ob_prospect_id`, `replied_at`, `kind`, `approved_*`, `compliance_snapshot`) وثلاثة جداول (`ob_suppressions`, `ob_events`, `ob_org_settings`).
- `src/modules/campaigns/dispatcher.server.ts`: يتخطى أرقام «لا ترسل» ويحوّل الجهة المعتمدة إلى «تم التواصل» بعد الإرسال.
- `src/modules/channels/whatsapp/channel-events.server.ts`: سطر في الخلفية (لا يعطّل الرسالة) لتسجيل الردود وكلمات الإيقاف.

### تجربة آمنة بدون Google
1. شغّل الـ migration الثاني.
2. أضف رقمين أو ثلاثة من أرقام فريقك بـ«إضافة جهة يدوياً».
3. من الإعدادات فعّل الإرسال غير الرسمي (بعد الإقرار) واستعمل رقماً مخصصاً للتجربة.
4. اعتمد الجهات (تحديد ثم «اعتماد للتواصل») وأنشئ حملة بسرعة 1 بالدقيقة.
5. ردّ من أحد الأرقام برسالة عادية ثم برسالة «إيقاف» وراقب «الحملات» و«لا ترسل».

## ما لم يُبنَ بعد
إرسال قوالب واتساب الرسمي (Cloud API)، إثراء المواقع (إيميل/سوشال)، البريد، إنستغرام، مهمة تنظيف بيانات Google المنتهية، وربط جهة الاتصال بالـCRM عند «استيراد» يدوي.

## Who can open the page (temporary limit)

The marketing page and every marketing server call are limited to the accounts listed in
`MARKETING_ALLOWED_EMAILS` (comma-separated login emails, set in the server `.env`). Empty or missing
means nobody can open it. The email is read from the auth service on the server. To open it to
everyone later, remove the `assertMarketingUser` call from `access()` in `marketing.functions.ts` and
`outbound.functions.ts`, and the `marketingAllowed` condition in `app-shell.tsx`.

## Site enrichment (emails, social pages, WhatsApp)

Select businesses in the table and press «إثراء من المواقع» (up to 25 per press), or open one business and
press «إثراء من الموقع». The server reads the business's own public website (home page plus up to two
contact/about pages) and stores:

- `emails` (up to 5, the site's own domain first), `socials` (instagram, facebook, tiktok, linkedin, x, youtube),
  `site_whatsapp` (from wa.me / api.whatsapp.com links), `enrich_status` (done / failed / no_website), `enriched_at`.

Safety: only http(s) on default ports; internal hosts, private IPs and redirects to them are refused (checked before
each request, at each redirect, and on the DNS answer); 8 s timeout, 1 MB cap, HTML only, 3 redirects max; 4 presses
per minute per user. Only information the business publishes itself is read. Migration:
`20261105120000_marketing_enrichment.sql` (additive columns). Nothing is sent from this step.

## Email campaigns

Cold email to the businesses whose site gave an email (see enrichment). Sent through Resend; everything else is ours.

**Server settings (`.env`)** — nothing is sent until all of these exist:
- `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `NovaSales <hello@your-domain.com>`; the domain must be verified in Resend: SPF, DKIM, and ideally DMARC).
- `PUBLIC_APP_URL` (the unsubscribe link needs it).
- `RESEND_WEBHOOK_SECRET` and a Resend webhook pointing at `/api/public/resend-webhook` for delivered / bounced / complained.
- Optional: `EMAIL_REPLY_TO`, `EMAIL_DAILY_CAP` (default 100 emails per organization per day; raise it slowly as the domain warms up).

**What it does:** the final approval (same three confirmations as WhatsApp) creates a campaign and one row per recipient; the minute timer sends each running campaign's per-minute limit, never above the daily cap. Every email carries the sender's name, an unsubscribe link and the one-click `List-Unsubscribe` headers. Pressing the link, a bounce or a complaint puts the address on the do-not-send list (channel `email`); a complaint also stops the business. Addresses on the list are skipped at send time too. A send that never finished is not retried automatically.

Tables: `ob_email_campaigns`, `ob_email_messages` (migration `20261110120000`, server-only).

## Slow sending (daily limit, hours, ramp-up, wording options)

A WhatsApp campaign can send like a person instead of in a burst: a **daily limit**, only inside a **window of hours** in a chosen time zone (Turkey by default: 30 a day, 10:00 to 17:00), with a random gap (about ±40 %) that spreads the day's messages over the whole window, never faster than one every 45 seconds. An optional **ramp-up** starts small (10) and adds a few each day (5) up to the limit. When the window closes or the day's limit is reached the campaign waits and continues by itself the next day. The limits are per campaign; the number's own protection (hourly and daily caps by health, the 48 hour observation window) still applies on top.

Wording options: `{مرحباً|أهلاً|السلام عليكم}` in the message gives each recipient one of the options at random, so the messages are not identical. A campaign without a schedule keeps the per-minute behaviour.

Stored in `cmp_campaigns.send_schedule` (migration `20261112120000`, additive). Logic in `src/modules/campaigns/send-schedule.ts`, used by the dispatcher.
