import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listSubscriptions } from "@/modules/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { arabicError } from "@/lib/validation";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/subscriptions")({
  component: SubsPage,
});

const STATUS_LABELS: Record<string, string> = { active: "نشط", trialing: "تجريبي", canceled: "ملغى", suspended: "موقوف", past_due: "متأخر السداد", unpaid: "غير مدفوع", incomplete: "غير مكتمل", expired: "منتهي" };
const PERIOD_LABELS: Record<string, string> = { monthly: "شهري", quarterly: "ربع سنوي", yearly: "سنوي" };
function SubsPage() {
  const fn = useServerFn(listSubscriptions);
  const q = useQuery({ queryKey: ["sa-subs"], queryFn: () => fn() });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState("all");
  const all = q.data ?? [];
  const term = search.trim().toLocaleLowerCase("ar");
  const rows = all.filter((s: any) =>
    (status === "all" || s.status === status) &&
    (period === "all" || s.billing_period === period) &&
    (!term || [s.organization?.name, s.organization?.slug, s.plan?.name, s.plan?.code].some((v) => String(v ?? "").toLocaleLowerCase("ar").includes(term)))
  );
  const filtered = !!term || status !== "all" || period !== "all";
  return (
    <Card>
      <CardHeader><CardTitle>الاشتراكات ({all.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 lg:col-span-2">
            <Label htmlFor="subscription-search">البحث</Label>
            <Input id="subscription-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم المؤسسة أو الخطة أو الكود" />
          </div>
          <div className="space-y-1"><Label htmlFor="subscription-status">الحالة</Label>
            <Select value={status} onValueChange={setStatus}><SelectTrigger id="subscription-status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">كل الحالات</SelectItem>{Object.entries(STATUS_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="subscription-period">فترة الفوترة</Label>
            <Select value={period} onValueChange={setPeriod}><SelectTrigger id="subscription-period"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">كل الفترات</SelectItem>{Object.entries(PERIOD_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">عرض {rows.length} من {all.length} اشتراك</p>
          {filtered && <Button variant="outline" onClick={() => { setSearch(""); setStatus("all"); setPeriod("all"); }}>مسح البحث والفلاتر</Button>}
        </div>
        {q.isPending && <p role="status">جارِ تحميل الاشتراكات...</p>}
        {q.isError && <div role="alert" className="text-destructive">{arabicError(q.error)} <Button variant="outline" onClick={() => q.refetch()}>إعادة المحاولة</Button></div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-right text-muted-foreground border-b">
              <tr>
                <th className="py-2 px-2">المؤسسة</th>
                <th className="py-2 px-2">الخطة</th>
                <th className="py-2 px-2">الحالة</th>
                <th className="py-2 px-2">الفترة</th>
                <th className="py-2 px-2">تنتهي في</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s: any) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="py-2 px-2 font-medium">
                    <Link to="/admin/organizations/$id" params={{ id: s.organization_id }} className="hover:underline">
                      {s.organization?.name ?? s.organization_id}
                    </Link>
                  </td>
                  <td className="py-2 px-2">{s.plan?.name ?? "—"}</td>
                  <td className="py-2 px-2"><Badge variant="secondary">{STATUS_LABELS[s.status] ?? s.status}</Badge></td>
                  <td className="py-2 px-2">{PERIOD_LABELS[s.billing_period] ?? s.billing_period}</td>
                  <td className="py-2 px-2 text-muted-foreground">
                    {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("ar") : "—"}
                  </td>
                </tr>
              ))}
              {!q.isPending && !q.isError && rows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">{filtered ? "لا توجد اشتراكات تطابق البحث والفلاتر" : "لا توجد اشتراكات حتى الآن"}</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
