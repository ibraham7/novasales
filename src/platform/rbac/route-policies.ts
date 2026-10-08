export type RoutePolicy = {
  prefix: string;
  label: string;
  anyOf?: string[];
  superAdminOnly?: boolean;
};

export const ROUTE_POLICIES: RoutePolicy[] = [
  {
    prefix: "/admin",
    label: "لوحة السوبر أدمن",
    superAdminOnly: true,
  },

  {
    prefix: "/settings/profile",
    label: "الملف الشخصي",
  },
  {
    prefix: "/settings/organization",
    label: "إعدادات المؤسسة",
    anyOf: ["org:update", "org.manage"],
  },
  {
    prefix: "/settings/members",
    label: "الأعضاء",
    anyOf: ["members:read", "members:update", "org.manage"],
  },
  {
    prefix: "/settings/invitations",
    label: "الدعوات",
    anyOf: ["members:invite", "org.manage"],
  },
  {
    prefix: "/settings/roles",
    label: "الأدوار",
    anyOf: ["rbac.manage", "roles:read", "roles:manage"],
  },
  {
    prefix: "/settings/pipelines",
    label: "قنوات المبيعات",
    anyOf: ["crm.pipelines.manage", "org.manage"],
  },
  { prefix: "/settings/conversions", label: "تحويلات الإعلانات", anyOf: ["crm.pipelines.manage", "org.manage"] },
  {
    prefix: "/settings/custom-fields",
    label: "الحقول المخصصة",
    anyOf: ["crm.custom_fields.manage"],
  },
  {
    prefix: "/settings/billing",
    label: "الفوترة",
    anyOf: ["org.manage"],
  },
  {
    prefix: "/settings/integrations",
    label: "التكاملات",
    anyOf: ["api_keys.manage", "plugins.manage"],
  },
  {
    prefix: "/settings",
    label: "الإعدادات",
  },

  {
    prefix: "/automation",
    label: "الأتمتة",
    anyOf: ["automation.view", "wf.workflows.manage"],
  },

  {
    prefix: "/campaigns",
    label: "الحملات",
    anyOf: ["cmp.campaigns.manage", "cmp.campaigns.send"],
  },

  {
    prefix: "/inbox",
    label: "صندوق المشرف",
    anyOf: ["crm.leads.view"],
  },

  {
    prefix: "/teams",
    label: "الأقسام والفرق",
    anyOf: ["departments:read", "department.manage"],
  },

  {
    prefix: "/instances",
    label: "جلسات واتساب",
    anyOf: [
      "messaging.channels.manage",
      "messaging.channels.view",
      "messaging.send",
      "crm.opportunities.view",
      "opportunities.view",
      "opportunities.view_own",
    ],
  },

  // Commerce
  {
    prefix: "/products",
    label: "المنتجات والمخزون",
    anyOf: [
      "products.page.view",
    ],
  },

  {
    prefix: "/sales",
    label: "المبيعات والطلبات",
    anyOf: [
      "sales.orders.create",
      "sales.orders.view",
      "sales.orders.manage",
      "sales.reports.view",
    ],
  },

  {
    prefix: "/buyers",
    label: "العملاء المشترون",
    anyOf: [
      "sales.orders.view",
    ],
  },
  {
    prefix: "/reports",
    label: "التقارير والمحاسبة",
    anyOf: [
      "sales.reports.view",
    ],
  },
  {
    prefix: "/performance",
    label: "أداء المندوبين",
    anyOf: [
      "sales.performance.view",
    ],
  },
  {
    prefix: "/leads",
    label: "العملاء المحتملون",
    anyOf: ["crm.leads.view"],
  },

  {
    prefix: "/contacts",
    label: "جهات الاتصال",
    anyOf: ["contacts.view", "contacts.view_department"],
  },

  {
    prefix: "/chat",
    label: "المحادثات",
    anyOf: [
      "messaging.send",
      "messaging.channels.view",
      "messaging.channels.manage",
      "crm.opportunities.view",
      "opportunities.view",
      "opportunities.view_department",
      "opportunities.view_own",
    ],
  },

  {
    prefix: "/opportunities",
    label: "الفرص",
    anyOf: [
      "crm.opportunities.view",
      "opportunities.view",
      "opportunities.view_department",
      "opportunities.view_own",
    ],
  },

  {
    prefix: "/pipeline",
    label: "قمع المبيعات",
    anyOf: [
      "crm.opportunities.view",
      "opportunities.view",
      "opportunities.view_department",
      "opportunities.view_own",
    ],
  },

  {
    prefix: "/dashboard",
    label: "لوحة التحكم",
    anyOf: ["reports.view", "org.manage"],
  },
];

export function getRoutePolicy(pathname: string) {
  return (
    ROUTE_POLICIES
      .filter(
        (policy) =>
          pathname === policy.prefix ||
          pathname.startsWith(`${policy.prefix}/`),
      )
      .sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? null
  );
}

export function hasAnyPermission(
  permissions: Iterable<string>,
  anyOf?: readonly string[],
) {
  if (!anyOf || anyOf.length === 0) return true;

  const set =
    permissions instanceof Set
      ? permissions
      : new Set(permissions);

  return anyOf.some((permission) => set.has(permission));
}
