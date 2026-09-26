import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMyPermissions } from "@/platform/rbac/use-permission";

export const Route = createFileRoute("/_authenticated/settings/")({
  component: SettingsIndex,
});

function SettingsIndex() {
  const permsQ = useMyPermissions();
  if (permsQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">جاري التحميل...</div>;
  const perms = permsQ.data ?? [];
  const canOrg = perms.includes("org:update") || perms.includes("org.manage");
  return <Navigate to={canOrg ? "/settings/organization" : "/settings/profile"} replace />;
}
