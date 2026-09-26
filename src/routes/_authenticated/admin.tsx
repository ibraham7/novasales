import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { isAdmin } from "@/modules/admin";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert, LayoutDashboard, Building2, CreditCard, Users, Shield, FileText, Settings2, ScrollText, Activity, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "لوحة المشرف - NovaSales" },
      { name: "description", content: "لوحة إدارة السوبر أدمن." },
    ],
  }),
  component: AdminLayout,
});

const TABS = [
  { to: "/admin", exact: true, icon: LayoutDashboard, label: "نظرة عامة" },
  { to: "/admin/organizations", icon: Building2, label: "المؤسسات" },
  { to: "/admin/plans", icon: CreditCard, label: "الخطط" },
  { to: "/admin/subscriptions", icon: FileText, label: "الاشتراكات" },
  { to: "/admin/users", icon: Users, label: "المستخدمون" },
  { to: "/admin/numbers", icon: Activity, label: "صحة الأرقام" },
  { to: "/admin/risk-rules", icon: SlidersHorizontal, label: "قواعد الخطورة" },
  { to: "/admin/logs", icon: ScrollText, label: "السجل" },

  { to: "/admin/settings", icon: Settings2, label: "الإعدادات العامة" },
] as const;

function AdminLayout() {
  const check = useServerFn(isAdmin);
  const roleQ = useQuery({ queryKey: ["is-admin"], queryFn: () => check() });
  const location = useLocation();

  if (roleQ.isLoading) return <div className="p-8">جاري التحقق...</div>;

  if (!roleQ.data?.isAdmin) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card>
          <CardContent className="p-8 flex flex-col items-center text-center gap-3">
            <ShieldAlert className="h-12 w-12 text-destructive" />
            <h2 className="text-xl font-bold">هذه الصفحة للمشرفين العامّين فقط</h2>
            <p className="text-muted-foreground">لا تملك صلاحية الوصول.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">لوحة السوبر أدمن</h1>
      </div>
      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {TABS.map((t) => {
            const active = (t as any).exact ? location.pathname === t.to : location.pathname.startsWith(t.to);
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
