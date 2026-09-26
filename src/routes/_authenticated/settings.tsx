import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Building2, User, Users, Mail, Shield, KanbanSquare, ListPlus, CreditCard, Plug } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyPermissions } from "@/modules/identity";
import { isAdmin } from "@/modules/admin";
import { getRoutePolicy, hasAnyPermission } from "@/platform/rbac/route-policies";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات - NovaSales" },
      { name: "description", content: "إعدادات المؤسسة والفريق والأدوار." },
    ],
  }),
  component: SettingsLayout,
});

const TABS = [
  { to: "/settings/organization", icon: Building2, label: "المؤسسة" },
  { to: "/settings/profile", icon: User, label: "الملف الشخصي" },
  { to: "/settings/members", icon: Users, label: "الأعضاء" },
  { to: "/settings/invitations", icon: Mail, label: "الدعوات" },
  { to: "/settings/pipelines", icon: KanbanSquare, label: "قنوات المبيعات" },
  { to: "/settings/custom-fields", icon: ListPlus, label: "الحقول المخصصة" },
  { to: "/settings/billing", icon: CreditCard, label: "الفوترة" },
  { to: "/settings/integrations", icon: Plug, label: "التكاملات" },
] as const;

function SettingsLayout() {
  const location = useLocation();
  const fetchPermissions = useServerFn(getMyPermissions);
  const checkAdmin = useServerFn(isAdmin);
  const permsQ = useQuery({ queryKey: ["my-permissions"], queryFn: () => fetchPermissions() });
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => checkAdmin() });
  const perms = permsQ.data ?? [];
  const isSuper = adminQ.data?.isAdmin === true;
  const tabs = TABS.filter((tab) => {
    const policy = getRoutePolicy(tab.to);
    return !policy || (policy.superAdminOnly ? isSuper : isSuper || hasAnyPermission(perms, policy.anyOf));
  });
  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      <h1 className="text-2xl font-bold mb-6">الإعدادات</h1>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {tabs.map((t) => {
            const active = location.pathname === t.to;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
