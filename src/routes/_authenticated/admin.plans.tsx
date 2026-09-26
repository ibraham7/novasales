import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listPlans, upsertPlan, deletePlan, listFeatures } from "@/modules/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2, Edit } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/plans")({
  component: PlansPage,
});

const LIMIT_KEYS = ["seats", "whatsapp_accounts", "monthly_messages", "leads", "opportunities", "contacts", "active_workflows", "active_campaigns", "storage_mb"];
const LIMIT_LABELS: Record<string, string> = {
  seats: "عدد المستخدمين",
  whatsapp_accounts: "أرقام واتساب",
  monthly_messages: "الرسائل الشهرية",
  leads: "العملاء المحتملون",
  opportunities: "الفرص",
  contacts: "جهات الاتصال",
  active_workflows: "الأتمتات النشطة",
  active_campaigns: "الحملات النشطة",
  storage_mb: "التخزين (ميغابايت)",
};

function emptyPlan() {
  return {
    id: undefined as string | undefined,
    code: "",
    name: "",
    description: "",
    status: "draft" as "draft" | "published" | "archived",
    price_monthly: 0,
    price_quarterly: 0,
    price_yearly: 0,
    currency: "USD",
    trial_days: 0,
    is_public: true,
    sort_order: 0,
    features: [] as { feature_key: string; is_enabled: boolean }[],
    limits: [] as { limit_key: string; limit_value: number }[],
  };
}

function PlansPage() {
  const qc = useQueryClient();
  const plansFn = useServerFn(listPlans);
  const featsFn = useServerFn(listFeatures);
  const save = useServerFn(upsertPlan);
  const del = useServerFn(deletePlan);

  const plansQ = useQuery({ queryKey: ["billing-plans"], queryFn: () => plansFn() });
  const featsQ = useQuery({ queryKey: ["billing-features"], queryFn: () => featsFn() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyPlan());

  const openEdit = (p: any) => {
    setForm({
      ...emptyPlan(),
      ...p,
      features: (p.features ?? []).map((f: any) => ({ feature_key: f.feature_key, is_enabled: f.is_enabled })),
      limits: (p.limits ?? []).map((l: any) => ({ limit_key: l.limit_key, limit_value: l.limit_value })),
    });
    setOpen(true);
  };

  const openNew = () => { setForm(emptyPlan()); setOpen(true); };

  const submit = useMutation({
    mutationFn: () => save({ data: form as any }),
    onSuccess: () => { toast.success("تم الحفظ"); setOpen(false); qc.invalidateQueries({ queryKey: ["billing-plans"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleFeature = (key: string, enabled: boolean) => {
    const filtered = form.features.filter((f) => f.feature_key !== key);
    setForm({ ...form, features: [...filtered, { feature_key: key, is_enabled: enabled }] });
  };

  const getFeature = (key: string) => form.features.find((f) => f.feature_key === key)?.is_enabled ?? false;

  const setLimit = (key: string, value: number) => {
    const filtered = form.limits.filter((l) => l.limit_key !== key);
    setForm({ ...form, limits: [...filtered, { limit_key: key, limit_value: value }] });
  };

  const getLimit = (key: string) => form.limits.find((l) => l.limit_key === key)?.limit_value ?? -1;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">الخطط ({plansQ.data?.length ?? 0})</h2>
        <Button onClick={openNew}><Plus className="h-4 w-4 ml-1" /> خطة جديدة</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(plansQ.data ?? []).map((p: any) => (
          <Card key={p.id}>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <div className="text-xs text-muted-foreground mt-1">{p.code}</div>
                </div>
                <Badge variant={p.status === "published" ? "default" : "secondary"}>{p.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="text-2xl font-bold">${p.price_monthly}<span className="text-sm text-muted-foreground">/شهر</span></div>
              {p.trial_days > 0 && <div className="text-xs text-muted-foreground">تجربة {p.trial_days} يوم</div>}
              <div className="text-xs text-muted-foreground">{p.features?.length ?? 0} ميزة · {p.limits?.length ?? 0} حد</div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(p)}><Edit className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={async () => {
                  if (!confirm("حذف الخطة؟")) return;
                  try {
                    await del({ data: { id: p.id } });
                    qc.invalidateQueries({ queryKey: ["billing-plans"] });
                  } catch (e: any) { toast.error(e.message); }
                }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>{form.id ? "تعديل خطة" : "خطة جديدة"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>الكود</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="starter" /></div>
            </div>
            <div><Label>الوصف</Label><Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-4 gap-3">
              <div><Label>شهري</Label><Input type="number" value={form.price_monthly} onChange={(e) => setForm({ ...form, price_monthly: Number(e.target.value) })} /></div>
              <div><Label>ربع سنوي</Label><Input type="number" value={form.price_quarterly} onChange={(e) => setForm({ ...form, price_quarterly: Number(e.target.value) })} /></div>
              <div><Label>سنوي</Label><Input type="number" value={form.price_yearly} onChange={(e) => setForm({ ...form, price_yearly: Number(e.target.value) })} /></div>
              <div><Label>أيام التجربة</Label><Input type="number" value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>العملة</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
              <div>
                <Label>الحالة</Label>
                <Select value={form.status} onValueChange={(v: any) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">مسودة</SelectItem>
                    <SelectItem value="published">منشورة</SelectItem>
                    <SelectItem value="archived">مؤرشفة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Switch checked={form.is_public} onCheckedChange={(v) => setForm({ ...form, is_public: v })} />
                <Label>ظاهرة للعامة</Label>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">الميزات</h3>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {(featsQ.data ?? []).map((f: any) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm p-2 border rounded">
                    <Switch checked={getFeature(f.key)} onCheckedChange={(v) => toggleFeature(f.key, v)} />
                    <span>{f.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-1">الحدود</h3>
              <p className="text-xs text-muted-foreground mb-3">
                أدخل الحد الأقصى المسموح لكل بند. اكتب <b>-1</b> للسماح بعدد غير محدود (بلا حدود).
              </p>
              <div className="grid grid-cols-2 gap-2">
                {LIMIT_KEYS.map((k) => {
                  const v = getLimit(k);
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <Label className="w-40 text-xs">{LIMIT_LABELS[k] ?? k}</Label>
                      <Input
                        type="number"
                        value={v}
                        onChange={(e) => setLimit(k, Number(e.target.value))}
                      />
                      {v === -1 && <span className="text-xs text-muted-foreground shrink-0">بلا حدود</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
