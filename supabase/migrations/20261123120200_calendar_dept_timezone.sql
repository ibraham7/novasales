-- التقويم (المرحلة 1/ج): تأكيد وجود عمود المنطقة الزمنية لأقسام المؤسسة (كان بالأنواع بلا هجرة في المستودع).
-- إن كان العمود موجوداً فلا يتغير شيء. آمن لإعادة التشغيل.
do $$ begin
  if to_regclass('public.org_departments') is not null then
    alter table public.org_departments add column if not exists timezone text not null default 'Europe/Istanbul';
  end if;
end $$;
