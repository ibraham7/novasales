
INSERT INTO public.rbac_permissions(key, description) VALUES
 ('org.manage','إدارة المؤسسة'),('org:update','تعديل المؤسسة'),('reports.view','التقارير'),
 ('members:read','عرض الأعضاء'),('members:update','تعديل الأعضاء'),('members:invite','دعوة أعضاء'),
 ('roles:read','عرض الأدوار'),('roles:manage','إدارة الأدوار'),('roles:assign','إسناد الأدوار'),('rbac.manage','إدارة الصلاحيات'),
 ('departments:read','عرض الأقسام'),('department.manage','إدارة الأقسام'),
 ('crm.leads.view','عرض العملاء المحتملين'),('crm.leads.update','تعديل العملاء المحتملين'),('crm.leads.assign','إسناد العملاء المحتملين'),
 ('leads:read','قراءة العملاء'),('leads:write','كتابة العملاء'),
 ('contacts.view','عرض جهات الاتصال'),('contacts.view_department','عرض جهات اتصال القسم'),('contacts.manage','إدارة جهات الاتصال'),('contacts:read','قراءة جهات الاتصال'),
 ('crm.opportunities.view','عرض الفرص'),('opportunities.view','عرض الفرص'),('opportunities.view_department','عرض فرص القسم'),('opportunities.view_own','عرض فرصي'),
 ('opportunities:read','قراءة الفرص'),('crm.opportunities.update','تعديل الفرص'),('opportunities.manage','إدارة الفرص'),
 ('crm.opportunities.delete','حذف الفرص'),('opportunities.delete','حذف الفرص'),('opportunities.assign','إسناد الفرص'),
 ('crm.pipelines.manage','إدارة قنوات المبيعات'),('crm.custom_fields.manage','الحقول المخصصة'),('crm.tags.manage','الوسوم'),
 ('messaging.send','إرسال الرسائل'),('messaging.channels.view','عرض جلسات واتساب'),('messaging.channels.manage','إدارة جلسات واتساب'),
 ('automation.view','عرض الأتمتة'),('wf.workflows.manage','إدارة الأتمتة'),
 ('cmp.campaigns.manage','إدارة الحملات'),('cmp.campaigns.send','إرسال الحملات'),
 ('integrations.manage','إدارة التكاملات'),('api_keys.manage','مفاتيح API'),('plugins.manage','الإضافات')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.rbac_roles(organization_id, key, name, is_system, description)
SELECT o.id, v.key, v.name, true, v.name
FROM public.organizations o
CROSS JOIN (VALUES
  ('owner','مالك المؤسسة'),
  ('supervisor','مشرف عام'),
  ('department_supervisor','مشرف قسم'),
  ('sales','مندوب مبيعات')
) AS v(key,name)
WHERE NOT EXISTS (SELECT 1 FROM public.rbac_roles r WHERE r.organization_id=o.id AND r.key=v.key);

-- owner + supervisor: كل الصلاحيات
INSERT INTO public.rbac_role_permissions(role_id, permission_key)
SELECT r.id, p.key FROM public.rbac_roles r CROSS JOIN public.rbac_permissions p
WHERE r.key IN ('owner','supervisor')
ON CONFLICT DO NOTHING;

-- مشرف قسم
INSERT INTO public.rbac_role_permissions(role_id, permission_key)
SELECT r.id, k FROM public.rbac_roles r
CROSS JOIN unnest(ARRAY['reports.view','members:read','departments:read','crm.leads.view','crm.leads.update','crm.leads.assign',
 'contacts.view','contacts.view_department','contacts.manage','crm.opportunities.view','opportunities.view','opportunities.view_department',
 'opportunities.view_own','crm.opportunities.update','opportunities.assign','crm.opportunities.delete','opportunities.delete',
 'messaging.send','messaging.channels.view','messaging.channels.manage','cmp.campaigns.manage','cmp.campaigns.send']) AS k
WHERE r.key='department_supervisor'
ON CONFLICT DO NOTHING;

-- مندوب مبيعات
INSERT INTO public.rbac_role_permissions(role_id, permission_key)
SELECT r.id, k FROM public.rbac_roles r
CROSS JOIN unnest(ARRAY['opportunities.view_own','crm.opportunities.update','contacts.view',
 'messaging.send','messaging.channels.view','messaging.channels.manage']) AS k
WHERE r.key='sales'
ON CONFLICT DO NOTHING;

-- إسناد: مالك لكل مؤسسة (أقدم عضو أو سوبر أدمن)، والباقي مندوب مبيعات
INSERT INTO public.rbac_user_roles(organization_id, user_id, role_id)
SELECT m.organization_id, m.user_id, r.id
FROM public.org_memberships m
JOIN public.rbac_roles r ON r.organization_id=m.organization_id AND r.key='owner'
WHERE (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=m.user_id AND ur.role='admin')
  OR m.user_id = (SELECT m2.user_id FROM public.org_memberships m2 WHERE m2.organization_id=m.organization_id ORDER BY m2.joined_at NULLS LAST, m2.created_at LIMIT 1)
)
AND NOT EXISTS (SELECT 1 FROM public.rbac_user_roles x WHERE x.user_id=m.user_id AND x.organization_id=m.organization_id);

INSERT INTO public.rbac_user_roles(organization_id, user_id, role_id)
SELECT m.organization_id, m.user_id, r.id
FROM public.org_memberships m
JOIN public.rbac_roles r ON r.organization_id=m.organization_id AND r.key='sales'
WHERE NOT EXISTS (SELECT 1 FROM public.rbac_user_roles x WHERE x.user_id=m.user_id AND x.organization_id=m.organization_id);
