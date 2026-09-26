import { createFileRoute, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getOrganizationDetails, deleteOrganization } from "@/modules/superadmin";
import { listPlans, setSubscriptionPlan, cancelSubscription, extendTrial, suspendSubscription, reactivateSubscription, listOverrides, createOverride, deleteOverride } from "@/modules/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState } from "react";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/organizations_/$id")({
  component: OrgDetailPage,
});

function OrgDetailPage() {
  const { id } = useParams({ from: "/_authenticated/admin/organizations_/$id" });
  const qc = useQueryClient();

  const detailsFn = useServerFn(getOrganizationDetails);
  const plansFn = useServerFn(listPlans);
  const setPlan = useServerFn(setSubscriptionPlan);
  const cancel = useServerFn(cancelSubscription);
  const extend = useServerFn(extendTrial);
  const suspend = useServerFn(suspendSubscription);
  const reactivate = useServerFn(reactivateSubscription);
  const overridesFn = useServerFn(listOverrides);
  const addOverride = useServerFn(createOverride);
  const removeOverride = useServerFn(deleteOverride);
  const delOrg = useServerFn(deleteOrganization);

  const detailQ = useQuery({ queryKey: ["sa-org", id], queryFn: () => detailsFn({ data: { id } }) });
  const plansQ = useQuery({ queryKey: ["billing-plans"], queryFn: () => plansFn() });
  const ovrQ = useQuery({ queryKey: ["sa-ovr", id], queryFn: () => overridesFn({ data: { organization_id: id } }) });

  const [selectedPlan, setSelectedPlan] = useState("");
  const [period, setPeriod] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [trialDays, setTrialDays] = useState(7);
  const [ovrLimit, setOvrLimit] = useState({ key: "", value: 0 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sa-org", id] });
    qc.invalidateQueries({ queryKey: ["sa-ovr", id] });
  };

  const changePlan = useMutation({
    mutationFn: () => setPlan({ data: { organization_id: id, plan_id: selectedPlan, billing_period: period } }),
    onSuccess: () => { toast.success("تم تحديث الخطة"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const d = detailQ.data;
  if (!d?.organization) return <div>جاري التحميل...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>{d.organization.name}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Slug:</span> {d.organization.slug}</div>
          <div><span className="text-muted-foreground">أعضاء:</span> {d.members.length}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الاشتراك</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {d.subscription ? (
            <div className="flex flex-wrap gap-3 items-center">
              <Badge>{d.subscription.status}</Badge>
              <div className="text-sm">
                <span className="text-muted-foreground">الخطة:</span> {d.subscription.plan?.name} · {d.subscription.billing_period}
              </div>
              {d.subscription.trial_ends_at && (
                <div className="text-sm">
                  <span className="text-muted-foreground">تجربة تنتهي:</span> {new Date(d.subscription.trial_ends_at).toLocaleDateString("ar")}
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">لا يوجد اشتراك.</div>
          )}

          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <Label>الخطة</Label>
              <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                <SelectTrigger><SelectValue placeholder="اختر خطة" /></SelectTrigger>
                <SelectContent>
                  {(plansQ.data ?? []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الفترة</Label>
              <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">شهري</SelectItem>
                  <SelectItem value="quarterly">ربع سنوي</SelectItem>
                  <SelectItem value="yearly">سنوي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!selectedPlan} onClick={() => changePlan.mutate()}>تطبيق</Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex gap-2 items-center">
              <Input type="number" value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} className="w-24" />
              <Button variant="outline" size="sm" onClick={async () => {
                await extend({ data: { organization_id: id, days: trialDays } });
                toast.success("تم تمديد التجربة"); invalidate();
              }}>تمديد التجربة</Button>
            </div>
            {d.subscription?.status === "suspended" ? (
              <Button variant="outline" size="sm" onClick={async () => {
                await reactivate({ data: { organization_id: id } }); invalidate();
              }}>إعادة تفعيل</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={async () => {
                await suspend({ data: { organization_id: id } }); invalidate();
              }}>تعليق</Button>
            )}
            <Button variant="destructive" size="sm" onClick={async () => {
              if (!confirm("إلغاء الاشتراك؟")) return;
              await cancel({ data: { organization_id: id, immediate: false } }); invalidate();
            }}>إلغاء</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الاستثناءات (Overrides)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label>مفتاح الحد</Label>
              <Input value={ovrLimit.key} onChange={(e) => setOvrLimit({ ...ovrLimit, key: e.target.value })} placeholder="مثال: seats" />
            </div>
            <div className="w-32">
              <Label>القيمة</Label>
              <Input type="number" value={ovrLimit.value} onChange={(e) => setOvrLimit({ ...ovrLimit, value: Number(e.target.value) })} />
            </div>
            <Button onClick={async () => {
              if (!ovrLimit.key) return;
              await addOverride({ data: { organization_id: id, limit_key: ovrLimit.key, limit_value: ovrLimit.value } });
              setOvrLimit({ key: "", value: 0 }); invalidate();
            }}>إضافة</Button>
          </div>
          <div className="space-y-2">
            {(ovrQ.data ?? []).map((o: any) => (
              <div key={o.id} className="flex items-center justify-between p-2 border rounded">
                <div className="text-sm">
                  {o.feature_key && <span>ميزة: <b>{o.feature_key}</b> = {String(o.is_enabled)}</span>}
                  {o.limit_key && <span>حد: <b>{o.limit_key}</b> = {o.limit_value}</span>}
                </div>
                <Button size="sm" variant="ghost" onClick={async () => {
                  await removeOverride({ data: { id: o.id } }); invalidate();
                }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {(ovrQ.data ?? []).length === 0 && <div className="text-muted-foreground text-sm">لا توجد استثناءات.</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الاستخدام (آخر الفترات)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-muted-foreground border-b">
                <tr><th className="py-1">الفترة</th><th>العدّاد</th><th>القيمة</th></tr>
              </thead>
              <tbody>
                {d.usage.map((u: any) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-1">{u.period}</td>
                    <td>{u.counter_key}</td>
                    <td>{u.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-destructive">منطقة الخطر</CardTitle></CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={async () => {
            if (!confirm(`حذف المؤسسة "${d.organization.name}" نهائياً؟`)) return;
            await delOrg({ data: { id } });
            toast.success("تم حذف المؤسسة");
            window.location.href = "/admin/organizations";
          }}>حذف المؤسسة</Button>
        </CardContent>
      </Card>
    </div>
  );
}
