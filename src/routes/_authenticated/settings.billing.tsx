import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyEntitlements, listInvoices, listPublicPlans } from "@/modules/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/billing")({
  head: () => ({
    meta: [
      { title: "الفوترة - NovaSales" },
      { name: "description", content: "إدارة اشتراك المؤسسة والاستخدام." },
    ],
  }),
  component: BillingPage,
});

const LIMIT_LABELS: Record<string, string> = {
  seats: "المقاعد",
  whatsapp_accounts: "جلسات واتساب",
  monthly_messages: "رسائل شهرياً",
  leads: "العملاء المحتملون",
  opportunities: "الفرص",
  contacts: "جهات الاتصال",
  active_workflows: "أتمتات نشطة",
  active_campaigns: "حملات نشطة",
  storage_mb: "التخزين (MB)",
};

function BillingPage() {
  const entFn = useServerFn(getMyEntitlements);
  const invFn = useServerFn(listInvoices);
  const plansFn = useServerFn(listPublicPlans);
  const entQ = useQuery({ queryKey: ["my-entitlements"], queryFn: () => entFn() });
  const invQ = useQuery({ queryKey: ["my-invoices"], queryFn: () => invFn({ data: {} }) });
  const plansQ = useQuery({ queryKey: ["public-plans"], queryFn: () => plansFn() });

  const sub = entQ.data?.subscription;
  const features = entQ.data?.features ?? {};
  const limits = entQ.data?.limits ?? {};
  const usage = entQ.data?.usage ?? {};

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>اشتراكك الحالي</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {sub ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold">{sub.plan?.name}</h3>
                <Badge>{sub.status}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                ${sub.plan?.price_monthly}/شهر · {sub.billing_period}
              </div>
              {sub.trial_ends_at && (
                <div className="text-sm">
                  التجربة تنتهي في: {new Date(sub.trial_ends_at).toLocaleDateString("ar")}
                </div>
              )}
              {sub.current_period_end && (
                <div className="text-sm text-muted-foreground">
                  التجديد التالي: {new Date(sub.current_period_end).toLocaleDateString("ar")}
                </div>
              )}
              {sub.cancel_at_period_end && (
                <Badge variant="destructive">سيتم الإلغاء في نهاية الفترة</Badge>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground">لا يوجد اشتراك فعّال. اختر خطة أدناه.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الاستخدام</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(LIMIT_LABELS).map(([key, label]) => {
            const max = Number(limits[key] ?? -1);
            const cur = Number(usage[key] ?? 0);
            const unlimited = max === -1;
            const pct = unlimited ? 0 : Math.min(100, (cur / (max || 1)) * 100);
            return (
              <div key={key}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{label}</span>
                  <span className="text-muted-foreground">
                    {cur} / {unlimited ? "∞" : max}
                  </span>
                </div>
                {!unlimited && <Progress value={pct} />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الميزات المتاحة</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(features).map(([key, enabled]) => (
              <div key={key} className="flex items-center gap-2">
                {enabled ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
                <span className={enabled ? "" : "text-muted-foreground line-through"}>{key}</span>
              </div>
            ))}
            {Object.keys(features).length === 0 && <div className="text-muted-foreground">لا توجد ميزات محددة.</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الفواتير</CardTitle></CardHeader>
        <CardContent>
          {(invQ.data ?? []).length === 0 ? (
            <div className="text-muted-foreground text-sm">لا توجد فواتير.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-right text-muted-foreground border-b">
                  <tr>
                    <th className="py-2">الرقم</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {(invQ.data ?? []).map((i: any) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="py-2 font-mono text-xs">{i.number}</td>
                      <td>${i.amount} {i.currency}</td>
                      <td><Badge variant={i.status === "paid" ? "default" : "secondary"}>{i.status}</Badge></td>
                      <td className="text-muted-foreground text-xs">{new Date(i.issued_at).toLocaleDateString("ar")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {(plansQ.data ?? []).length > 0 && (
        <Card>
          <CardHeader><CardTitle>الخطط المتاحة</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              {(plansQ.data ?? []).map((p: any) => (
                <Card key={p.id} className="relative">
                  <CardHeader>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <div className="text-2xl font-bold">${p.price_monthly}<span className="text-sm text-muted-foreground">/شهر</span></div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                    {p.trial_days > 0 && <Badge variant="secondary">تجربة {p.trial_days} يوم</Badge>}
                    <Button className="w-full" variant="outline" disabled>
                      {sub?.plan_id === p.id ? "خطتك الحالية" : "تواصل معنا"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
