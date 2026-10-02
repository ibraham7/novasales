import { usePlatformSettings } from "@/modules/superadmin/use-platform-settings";
import { RealtimeNotifications } from "@/components/realtime-notifications";

import {
  Link,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";

import {
  BarChart3,
  Building2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Megaphone,
  Package,
  Settings,
  Shield,
  ShoppingCart,
  Smartphone,
  Trophy,
  UserRoundCheck,
  Users,
  Users2,
  X,
  Zap,
} from "lucide-react";

import { useState } from "react";
import type { ReactNode } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { AvailabilityWidget } from "@/components/availability-widget";

import { cn } from "@/lib/utils";

import {
  hasAnyPermission,
} from "@/platform/rbac/route-policies";

const NAV = [
  {
    to: "/dashboard",
    icon: LayoutDashboard,
    label: "لوحة التحكم",
    anyOf: [
      "reports.view",
      "org.manage",
    ],
  },

  {
    to: "/chat",
    icon: MessagesSquare,
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
    to: "/leads",
    icon: Users2,
    label: "العملاء المحتملون",
    anyOf: [
      "crm.leads.view",
    ],
  },

  {
    to: "/contacts",
    icon: Users,
    label: "جهات الاتصال",
    anyOf: [
      "contacts.view",
      "contacts.view_department",
    ],
  },

  {
    to: "/products",
    icon: Package,
    label: "المنتجات والمخزون",
    anyOf: [
      "products.page.view",
    ],
  },

  {
    to: "/sales",
    icon: ShoppingCart,
    label: "المبيعات والطلبات",
    anyOf: [
      "sales.orders.create",
      "sales.orders.view",
      "sales.orders.manage",
      "sales.reports.view",
    ],
  },

  {
    to: "/buyers",
    icon: UserRoundCheck,
    label: "العملاء المشترون",
    anyOf: [
      "sales.orders.view",
    ],
  },
  {
    to: "/reports",
    icon: BarChart3,
    label: "التقارير والمحاسبة",
    anyOf: [
      "sales.reports.view",
    ],
  },
  {
    to: "/performance",
    icon: Trophy,
    label: "أداء المندوبين",
    anyOf: [
      "sales.performance.view",
    ],
  },

  {
    to: "/automation",
    icon: Zap,
    label: "الأتمتة",
    anyOf: [
      "automation.view",
      "wf.workflows.manage",
    ],
  },

  {
    to: "/campaigns",
    icon: Megaphone,
    label: "الحملات",
    anyOf: [
      "cmp.campaigns.manage",
      "cmp.campaigns.send",
    ],
  },

  {
    to: "/teams",
    icon: Building2,
    label: "الأقسام والفرق",
    anyOf: [
      "departments:read",
      "department.manage",
    ],
  },

  {
    to: "/instances",
    icon: Smartphone,
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

  {
    to: "/settings/billing",
    icon: CreditCard,
    label: "الفوترة",
    anyOf: [
      "org.manage",
    ],
  },

  {
    to: "/settings",
    icon: Settings,
    label: "الإعدادات",
    anyOf: null,
  },
] as const;

export function AppShell({
  children,
  permissions = [],
  isSuperAdmin = false,
  accessReady = true,
}: {
  children: ReactNode;
  permissions?: string[];
  isSuperAdmin?: boolean;
  accessReady?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const platform = usePlatformSettings();

  const [
    mobileMenuOpen,
    setMobileMenuOpen,
  ] = useState(false);

  const perms = new Set(
    permissions,
  );

  const items = isSuperAdmin
    ? [
      {
        to: "/admin" as const,
        icon: Shield,
        label: "لوحة المشرف",
        anyOf: null as any,
      },
    ]
    : NAV.filter(
      (item) =>
        item.anyOf === null ||
        hasAnyPermission(
          perms,
          item.anyOf,
        ),
    );

  async function signOut() {
    setMobileMenuOpen(
      false,
    );

    await qc.cancelQueries();

    qc.clear();

    await supabase.auth.signOut();

    navigate({
      to: "/auth",
      replace: true,
    });
  }

  function isActive(
    to: string,
  ) {
    if (
      to === "/dashboard"
    ) {
      return (
        location.pathname ===
        "/dashboard"
      );
    }

    if (
      to === "/settings"
    ) {
      return (
        location.pathname.startsWith(
          "/settings",
        ) &&
        !location.pathname.startsWith(
          "/settings/billing",
        )
      );
    }

    return location.pathname.startsWith(
      to,
    );
  }

  const SidebarContent = ({
    mobile = false,
  }: {
    mobile?: boolean;
  }) => (
    <>
      <div className="h-16 px-5 border-b border-sidebar-border flex items-center justify-between shrink-0">
        <Link
          to="/dashboard"
          onClick={() => {
            if (
              mobile
            ) {
              setMobileMenuOpen(
                false,
              );
            }
          }}
          className="flex items-center gap-2 text-sidebar-primary"
        >
          <MessageCircle className="h-7 w-7" />

          <span className="text-xl font-bold">
            {platform.platform_name}
          </span>
        </Link>

        {mobile && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() =>
              setMobileMenuOpen(
                false,
              )
            }
            className="text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {items.map(
          (item) => {
            const active =
              isActive(
                item.to,
              );

            return (
              <Link
                key={
                  item.to
                }
                to={
                  item.to
                }
                onClick={() => {
                  if (
                    mobile
                  ) {
                    setMobileMenuOpen(
                      false,
                    );
                  }
                }}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />

                <span>
                  {
                    item.label
                  }
                </span>
              </Link>
            );
          },
        )}
      </nav>

      <div className="p-3 border-t border-sidebar-border space-y-1 shrink-0">
        <AvailabilityWidget
          compact
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={
            signOut
          }
          className="w-full justify-start gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent"
        >
          <LogOut className="h-4 w-4" />

          تسجيل الخروج
        </Button>
      </div>
    </>
  );

  return (
    <div
      className="min-h-screen min-w-0 overflow-x-clip bg-background"
      dir="rtl"
    >
      {accessReady ? (
        <RealtimeNotifications />
      ) : null}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 right-0 z-30 w-64 bg-sidebar text-sidebar-foreground border-l border-sidebar-border flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile header */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 bg-background/95 backdrop-blur border-b flex items-center justify-between px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() =>
            setMobileMenuOpen(
              true,
            )
          }
        >
          <Menu className="h-5 w-5" />
        </Button>

        <Link
          to="/dashboard"
          className="flex items-center gap-2 font-bold"
        >
          <MessageCircle className="h-5 w-5 text-primary" />

          {platform.platform_name}
        </Link>

        <div className="w-9" />
      </header>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="إغلاق القائمة"
            className="absolute inset-0 bg-black/45"
            onClick={() =>
              setMobileMenuOpen(
                false,
              )
            }
          />

          <aside className="absolute inset-y-0 right-0 w-[84vw] max-w-[320px] bg-sidebar text-sidebar-foreground border-l border-sidebar-border flex flex-col shadow-2xl">
            <SidebarContent
              mobile
            />
          </aside>
        </div>
      )}

      <main
        className={cn(
          "min-w-0",
          "lg:mr-64",
          "pt-14 lg:pt-0",
          "min-h-screen",
        )}
      >
        {children}
      </main>
    </div>
  );
}
