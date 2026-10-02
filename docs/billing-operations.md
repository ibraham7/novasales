# الفوترة

يجب تطبيق `20261002221105_restore_billing_operations.sql` قبل نشر الكود. يضيف الفواتير والعدادات والتجاوزات وطلبات الخطط ودوال حساب الاشتراك والتخزين، ومشغلات فرض الحدود. لا يغير أسعار الخطط أو الاشتراك الحالي ولا يسجل أي دفعة.

الفواتير وإدارتها وتجاوزات الاشتراكات تتطلب السوبر أدمن. قراءة المؤسسة لبياناتها وطلب خطة تتطلب إدارة المؤسسة. طلب خطة يسجل طلبًا فقط؛ يظهر في صفحة اشتراكات السوبر أدمن، ويمكن إغلاقه بعد المتابعة. تعيين الخطة يظل إجراءً إداريًا منفصلًا؛ لا توجد بوابة دفع أو تجديد مالي تلقائي.

الحد غير المحدد يعرض «غير محدد»، والقيمة -1 تعني غير محدود، والقيمة صفر تمنع الإضافة. تُفرض حدود المقاعد والجلسات والعملاء والفرص والأتمتة والحملات عند الإدخال/التفعيل داخل معاملة قاعدة البيانات مع قفل المؤسسة، بما يشمل الإضافات القادمة من التكاملات. الاشتراك المسجل الموقوف أو المنتهي يمنع هذه الإضافات. المؤسسة دون اشتراك تبقى ضمن وضع الاستخدام اليدوي الحالي ما لم يضبط المدير حدودًا بالتجاوزات.

حد الرسائل يُفحص قبل إرسال النص أو الوسائط أو الصوت؛ وحد التخزين يُفحص قبل رفع مرفقات المحادثات. الفحص قبل الإرسال/الرفع لا يحجز حصة ذرية لدى مزود خارجي؛ الطلبات المتزامنة قد تتجاوز حد الرسائل أو التخزين قليلًا. لا نعيد إرسال الرسائل تلقائيًا بسبب فشل تسجيل البيانات.

استخدام الرسائل هو عدد الرسائل الصادرة الناجحة المسجلة هذا الشهر UTC؛ المساحة هي بيانات الملفات في `crm-files` ذات مسار المؤسسة أو `chat-media/<organization>/`. لا يُحسب التخزين الخارجي أو ملفات ذات مسار قديم لا يتضمن المؤسسة.

اختبارات PostgreSQL المحلية تتحقق من انتهاء التجاوزات، عزل المؤسسات، حساب التخزين والعدادات ومنع تجاوز الحصة. لا تنشئ بيانات اختبار على الإنتاج ولا ترسل رسائل واتساب.

## Database deployment verification

Applied `20261002221105_restore_billing_operations.sql` to Supabase project `eqkfbwknxlozakpnnatq` after explicit user approval on 2026-10-02 UTC. Verified all four tables have RLS and server-only grants, all five functions are security invoker and server-only, and all seven quota triggers are enabled. Live entitlement/storage queries succeeded (nine limits; the feature catalog currently has no active entries). UI changes remain local pending site deployment. Security advisor informational no-policy notices are expected for server-only tables; existing workspace authorization functions and Auth password protection warnings remain outside this migration.
