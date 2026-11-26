-- الصلاحية crm.leads.create يطلبها الكود (إنشاء عميل محتمل، ونقل جهة تسويق إلى العملاء المحتملين) ودالة crm_save_lead_atomic،
-- لكنها لم تُضف يوماً لجدول الصلاحيات ولا لأي دور، فكان «نقل إلى العملاء المحتملين» يفشل حتى لمالك المؤسسة. آمن لإعادة التشغيل.
insert into public.rbac_permissions (key, description)
values ('crm.leads.create', 'إنشاء العملاء المحتملين')
on conflict (key) do nothing;

-- المالك والمشرف العام ومشرف القسم، في كل المؤسسات الموجودة. (مندوب المبيعات لا.)
insert into public.rbac_role_permissions (role_id, permission_key)
select r.id, 'crm.leads.create'
from public.rbac_roles r
where r.key in ('owner', 'supervisor', 'department_supervisor')
on conflict do nothing;
