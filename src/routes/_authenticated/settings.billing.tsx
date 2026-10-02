import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { getMyEntitlements, listInvoices, listPublicPlans, requestPlan } from "@/modules/billing";
import {
  PERIOD_LABELS,
  STATUS_LABELS,
  planPrice,
  billingMoney,
  usageLimit,
} from "@/modules/billing/billing-model";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
export const Route = createFileRoute("/_authenticated/settings/billing")({
  head: () => ({ meta: [{ title: "الفوترة - NovaSales" }] }),
  component: BillingPage,
});
const LABELS: Record<string, string> = {
  seats: "المقاعد",
  whatsapp_accounts: "جلسات واتساب",
  monthly_messages: "الرسائل المرسلة هذا الشهر",
  leads: "العملاء المحتملون",
  opportunities: "الفرص",
  contacts: "جهات الاتصال",
  active_workflows: "أتمتات نشطة",
  active_campaigns: "حملات نشطة",
  storage_mb: "التخزين بالميغابايت",
};
function BillingPage() {
  const ent = useServerFn(getMyEntitlements),
    inv = useServerFn(listInvoices),
    plans = useServerFn(listPublicPlans),
    request = useServerFn(requestPlan);
  const entQ = useQuery({ queryKey: ["my-entitlements"], queryFn: () => ent() }),
    invQ = useQuery({ queryKey: ["my-invoices"], queryFn: () => inv({ data: {} }) }),
    plansQ = useQuery({ queryKey: ["public-plans"], queryFn: () => plans() });
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("");
  const req = useMutation({
    mutationFn: (id: string) => request({ data: { planId: id } }),
    onSuccess: () =>
      toast.success("تم تسجيل طلب الخطة لدى الإدارة؛ لم يتغير الاشتراك ولم يتم الدفع"),
    onError: (e: Error) => toast.error(e.message),
  });
  const sub = entQ.data?.subscription;
  const error = (q: any, label: string) =>
    q.isError ? (
      <div className="text-destructive">
        تعذر تحميل {label}.{" "}
        <Button variant="outline" onClick={() => q.refetch()}>
          إعادة المحاولة
        </Button>
      </div>
    ) : q.isPending ? (
      <div>جارٍ تحميل {label}…</div>
    ) : null;
  return (
    <div className="space-y-6 min-w-0" dir="rtl">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">الفوترة</h2>
        <Button
          variant="outline"
          onClick={() => {
            entQ.refetch();
            invQ.refetch();
            plansQ.refetch();
          }}
        >
          تحديث
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>اشتراكك الحالي</CardTitle>
        </CardHeader>
        <CardContent>
          {error(entQ, "الاشتراك")}
          {entQ.isSuccess &&
            (sub ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-3">
                  <b>{sub.plan?.name}</b>
                  <Badge>{STATUS_LABELS[sub.status] ?? sub.status}</Badge>
                </div>
                <p>
                  {billingMoney(
                    planPrice(sub.plan, sub.billing_period),
                    sub.plan?.currency ?? "USD",
                  )}{" "}
                  / {PERIOD_LABELS[sub.billing_period]}
                </p>
                {sub.current_period_end && (
                  <p>
                    نهاية فترة الاشتراك: {new Date(sub.current_period_end).toLocaleDateString("ar")}
                  </p>
                )}
                {sub.trial_ends_at && (
                  <p>نهاية التجربة: {new Date(sub.trial_ends_at).toLocaleDateString("ar")}</p>
                )}
                {sub.cancel_at_period_end && (
                  <Badge variant="destructive">سيتم الإلغاء في نهاية الفترة</Badge>
                )}
              </div>
            ) : (
              <p>لا يوجد اشتراك مسجل لهذه المؤسسة. يمكنك طلب خطة من القائمة أدناه.</p>
            ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>الاستخدام</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error(entQ, "الاستخدام")}
          {entQ.isSuccess &&
            Object.entries(LABELS).map(([key, label]) => {
              const max = entQ.data.limits[key],
                cur = Number(entQ.data.usage[key] ?? 0);
              return (
                <div key={key}>
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>{label}</span>
                    <span dir="rtl">
                      {cur.toLocaleString("ar", { maximumFractionDigits: 2 })} من {usageLimit(max)}
                    </span>
                  </div>
                  {max !== undefined && max >= 0 && (
                    <Progress
                      value={Math.min(100, max === 0 ? (cur ? 100 : 0) : (cur / max) * 100)}
                    />
                  )}
                </div>
              );
            })}
          <p className="text-xs text-muted-foreground">
            الرسائل تُحسب حسب الشهر الميلادي بتوقيت UTC. المساحة تشمل الملفات المخزنة للمؤسسة في
            النظام.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>الميزات المتاحة</CardTitle>
        </CardHeader>
        <CardContent>
          {error(entQ, "الميزات")}
          {entQ.isSuccess && (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(entQ.data.features).map(([key, value]) => (
                <div key={key}>
                  {value ? "✓" : "—"} {entQ.data.featureLabels[key] ?? key}
                </div>
              ))}
              {!Object.keys(entQ.data.features).length && <p>لا توجد ميزات محددة.</p>}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>الفواتير</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error(invQ, "الفواتير")}
          {invQ.isSuccess && (
            <>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="w-full sm:w-64"
                  placeholder="بحث برقم الفاتورة"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  className="border rounded-md p-2"
                  aria-label="حالة الفاتورة"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">كل الحالات</option>
                  {["open", "paid", "void"].map((k) => (
                    <option key={k} value={k}>
                      {STATUS_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead>
                    <tr>
                      <th>الرقم</th>
                      <th>المبلغ</th>
                      <th>الحالة</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invQ.data ?? [])
                      .filter(
                        (i: any) => i.number.includes(search) && (!status || i.status === status),
                      )
                      .map((i: any) => (
                        <tr key={i.id} className="border-t">
                          <td className="py-3 font-mono">{i.number}</td>
                          <td>{billingMoney(Number(i.amount), i.currency)}</td>
                          <td>{STATUS_LABELS[i.status] ?? i.status}</td>
                          <td>{new Date(i.issued_at).toLocaleDateString("ar")}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!(invQ.data ?? []).some(
                (i: any) => i.number.includes(search) && (!status || i.status === status),
              ) && <p>لا توجد فواتير مطابقة.</p>}
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>الخطط المتاحة</CardTitle>
        </CardHeader>
        <CardContent>
          {error(plansQ, "الخطط")}
          {plansQ.isSuccess && (
            <div className="grid gap-3 md:grid-cols-3">
              {(plansQ.data ?? []).map((p: any) => (
                <Card key={p.id}>
                  <CardHeader>
                    <CardTitle>{p.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p>{billingMoney(Number(p.price_monthly), p.currency)} / شهر</p>
                    <p>{p.description}</p>
                    <Button
                      disabled={req.isPending || sub?.plan_id === p.id || !entQ.isSuccess}
                      onClick={() => req.mutate(p.id)}
                    >
                      {sub?.plan_id === p.id ? "خطتك الحالية" : "طلب هذه الخطة"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {!plansQ.data?.length && <p>لا توجد خطط عامة متاحة حاليًا؛ تواصل مع إدارة النظام.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
