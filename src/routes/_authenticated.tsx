import { createFileRoute, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ShieldAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccessSnapshot } from "@/modules/identity";
import { getRoutePolicy, hasAnyPermission } from "@/platform/rbac/route-policies";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { readAccessCache, writeAccessCache, clearAccessCache } from "@/lib/access-cache";
import { clearPersistedQueries } from "@/lib/query-persist";
import { clearLocalAuthStorage, withAuthTimeout } from "@/lib/auth-session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthGate,
});

function PageSkeleton() {
  return (
    <div className="p-6 space-y-4" dir="rtl">
      <Skeleton className="h-9 w-56" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function AuthGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const [hydrated, setHydrated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const fetchAccess = useServerFn(getMyAccessSnapshot);

  useEffect(() => setHydrated(true), []);

  const cached = useMemo(() => readAccessCache(userId), [userId]);

  const accessQ = useQuery({
    queryKey: ["my-access"],
    queryFn: () => withAuthTimeout(fetchAccess()),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    networkMode: "online",
    refetchOnWindowFocus: false,
    ...(cached ? {
      initialData: { permissions: cached.permissions, isSuperAdmin: cached.isSuperAdmin },
      initialDataUpdatedAt: cached.at,
    } : {}),
  });

  // Persist the last verified access snapshot so the next refresh/navigation is
  // instant. Cached values are only ever used for the same user id.
  useEffect(() => {
    if (!userId) return;
    if (!accessQ.isSuccess) return;
    writeAccessCache({
      userId,
      permissions: accessQ.data?.permissions ?? [],
      isSuperAdmin: accessQ.data?.isSuperAdmin === true,
    });
  }, [userId, accessQ.isSuccess, accessQ.data]);

  useEffect(() => {
    let active = true;
    withAuthTimeout(supabase.auth.getUser()).then(({ data, error }) => {
      if (!active) return;
      setSessionChecked(true);
      if (error || !data.user) {
        clearAccessCache();
        clearPersistedQueries();
        clearLocalAuthStorage();
        navigate({ to: "/auth", search: { redirect: window.location.pathname }, replace: true });
      } else {
        setUserId(data.user.id);
      }
    }).catch(() => {
      if (!active) return;
      setSessionChecked(true);
      setUserId(null);
      clearAccessCache();
      clearPersistedQueries();
      clearLocalAuthStorage();
      navigate({ to: "/auth", search: { redirect: window.location.pathname }, replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearAccessCache();
        clearPersistedQueries();
        setUserId(null);
        navigate({ to: "/auth", replace: true });
        return;
      }
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session) {
        setUserId(session.user.id);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  // تطابق أول عرض في المتصفح مع fallback الفارغ للمسار ذي ssr:false، ثم ابدأ فحص الجلسة.
  if (!hydrated) return null;

  // No session known at all yet → minimal splash (very short: local read only).
  if (!userId) {
    if (!sessionChecked) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }
    return null; // redirecting to /auth
  }

  const policy = getRoutePolicy(location.pathname);
  const permissions = accessQ.data?.permissions ?? [];
  const isSuperAdmin = accessQ.data?.isSuperAdmin === true;
  // A failed check must not hang the app forever: treat an error as "known"
  // (fail-closed on permissions, but the UI stays usable and retryable).
  const accessKnown = accessQ.data !== undefined || accessQ.isError;
  const accessFailed = accessQ.isError && accessQ.data === undefined;

  // Fail-closed: never render protected content before access is known.
  if (policy && !accessKnown) {
    return (
      <AppShell permissions={permissions} isSuperAdmin={isSuperAdmin} accessReady={false}>
        <PageSkeleton />
      </AppShell>
    );
  }

  if (policy && accessFailed) {
    return (
      <AppShell permissions={permissions} isSuperAdmin={isSuperAdmin} accessReady={false}>
        <div className="p-8 max-w-xl mx-auto" dir="rtl">
          <Card>
            <CardContent className="p-8 flex flex-col items-center text-center gap-4">
              <ShieldAlert className="h-10 w-10 text-destructive" />
              <h1 className="text-lg font-bold">تعذّر تحميل الصلاحيات</h1>
              <p className="text-muted-foreground text-sm">
                يبدو أن الاتصال بالخادم ضعيف أو انقطع. أعد المحاولة.
              </p>
              <button
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                onClick={() => {
                  accessQ.refetch();
                }}
              >
                إعادة المحاولة
              </button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }


  const canAccess =
    !policy ||
    (policy.superAdminOnly ? isSuperAdmin : isSuperAdmin || hasAnyPermission(permissions, policy.anyOf));

  if (!canAccess) {
    // Users without reporting access land on the chats page instead of a dead end.
    if (location.pathname === "/dashboard" || location.pathname.startsWith("/dashboard/")) {
      return <Navigate to="/chat" replace />;
    }
    return (
      <AppShell permissions={permissions} isSuperAdmin={isSuperAdmin}>
        <div className="p-8 max-w-2xl mx-auto" dir="rtl">
          <Card>
            <CardContent className="p-8 flex flex-col items-center text-center gap-3">
              <ShieldAlert className="h-12 w-12 text-destructive" />
              <h1 className="text-xl font-bold">لا تملك صلاحية الوصول</h1>
              <p className="text-muted-foreground">هذه الصفحة مخصصة لصلاحيات أعلى: {policy?.label}</p>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell permissions={permissions} isSuperAdmin={isSuperAdmin}>
      <Outlet />
    </AppShell>
  );
}
