# Product attributes and stock batches

Each organization defines its own attribute names and types: free text, a single choice, multiple choices, number, or date. Product variants store a validated selection of these definitions. Existing attributes can be renamed and choice options extended; changing type or removing options requires a new definition, preserving existing variants.

Open **Products → Properties and batches** to define attributes, create product variants, receive new lots, or correct an individual lot's balance. Product/attribute administration uses `products.manage`; lot receipts/corrections use `inventory.manage`. Sales staff can inspect the catalog and lot balances.

Every receipt has a distinct batch code per product and an optional expiry date. Receipts are never merged automatically. Existing balances are preserved in an unspecified basic variant and a `LEGACY` lot; no expiry date is inferred.

Orders from Sales and Chat show each available lot separately, with variant, batch code, quantity, and expiry. Expiring lots are sorted first and the earliest is indicated. The user selects the specific lot. Expired lots remain visible in stock administration but cannot be sold. Order lines snapshot the variant values, batch code, and expiry.

Confirmation locks the order and all affected product balances in a consistent order, then checks/decrements the selected lots in the same transaction. Duplicate order lines cannot exceed the available balance; any failure rolls back all deductions. Older clients without a batch ID can only consume the original basic lot.

## Validation

- `npm run build`
- `node --experimental-strip-types --test tests/stock-catalog.test.ts`
- Execute `supabase/tests/product_stock_batches.sql` and `supabase/tests/product_stock_rls.sql` on a migrated database. Both roll back their fixtures. RLS test requires a non-admin test user.

The schema migrations were applied to the connected Supabase project. Application code still requires deployment of the new build. No new environment variables or packages are required.

## صور المنتج والفيديو والعملات

- يمكن حفظ 12 صورة و4 فيديوهات لكل منتج، ورفع عدة ملفات دفعة واحدة.
- الصور: JPG / PNG / WebP / GIF، حتى 5MB لكل صورة. الفيديو: MP4 / WebM، حتى 25MB لكل فيديو.
- يمكن إضافة روابط ملفات مباشرة. الصورة الأولى غلاف ويمكن تغييرها دون حذف الصور الأخرى.
- معرض الكتالوج يعرض الصور كاملة دون قص، مع تنقل ومعاينة مكبرة وتشغيل الفيديو.
- قائمة العملات تعرض اسم العملة ورمزها، مثل الليرة التركية TRY والسورية SYP والدولار USD. لا يُكتب رمز ₺ أو $ في حقل العملة.
- قيمة المخزون والإيرادات والخصومات تعرض منفصلة حسب العملة، دون تحويل تلقائي.
- بطاقة المنتج والكتالوج داخل المحادثة يعرضان الكميات المتاحة حسب الخصائص ولكل متغير، مع استبعاد المنتهي.
- إضافة اللون والمقاس: افتح الخصائص والدفعات، عرّف الخاصيتين، أنشئ متغيرًا لكل تركيبة، ثم أدخل كمية كل متغير في استلام دفعة.
