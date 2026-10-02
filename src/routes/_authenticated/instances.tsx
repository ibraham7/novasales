import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  listInstances,
  listProvidersFn,
  createInstanceFn,
  connectInstanceFn,
  refreshInstanceStatusFn,
  updateInstanceNameFn,
  logoutInstanceFn,
  deleteInstanceFn,
} from "@/modules/channels";
import { CoexistenceLinkDialog } from "@/modules/channels";
import { getNumbersRisk } from "@/modules/risk";
import { ShieldAlert, ShieldCheck, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { LogOut, Pencil, Plus, RefreshCw, Trash2, QrCode, Smartphone } from "lucide-react";

type ProviderOption = {
  id: string;
  label: string;
  description?: string | null;
  enabled: boolean;
  linkMode?: "qr" | "embedded_signup";
  isOfficial?: boolean;
  capabilities: Record<string, boolean>;
};

function providerLabel(list: ProviderOption[], id?: string) {
  if (!id) return "evolution";
  return list.find((p) => p.id === id)?.label ?? id;
}

function summarizeCaps(caps: Record<string, boolean>) {
  const names: Record<string, string> = {
    supportsMedia: "وسائط",
    supportsHistory: "سجل",
    supportsReactions: "تفاعلات",
    supportsEdit: "تعديل",
    supportsDelete: "حذف",
    supportsTyping: "كتابة",
    supportsQrLogin: "QR",
  };
  const on = Object.keys(names).filter((k) => caps?.[k]);
  return on.length ? on.map((k) => names[k]).join(" · ") : "قدرات محدودة";
}

type InstanceRow = {
  id: string;
  name: string;
  display_name: string | null;
  status: string;
  phone_number: string | null;
  profile_pic_url?: string | null;
  webhook_configured: boolean;
  provider?: string;
};

export const Route = createFileRoute("/_authenticated/instances")({
  head: () => ({
    meta: [
      { title: "جلسات واتساب - NovaSales" },
      { name: "description", content: "أنشئ واربط جلسات واتساب متعددة." },
      { property: "og:title", content: "جلسات واتساب - NovaSales" },
      { property: "og:description", content: "أنشئ واربط جلسات واتساب متعددة." },
    ],
  }),
  component: Instances,
});

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  connected: { label: "متصل", variant: "default" },
  connecting: { label: "جاري الربط", variant: "secondary" },
  disconnected: { label: "غير متصل", variant: "outline" },
  unconfigured: { label: "لم يُهيّأ", variant: "destructive" },
};

function Instances() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listInstances);
  const fetchProviders = useServerFn(listProvidersFn);
  const create = useServerFn(createInstanceFn);
  const connect = useServerFn(connectInstanceFn);
  const refresh = useServerFn(refreshInstanceStatusFn);
  const rename = useServerFn(updateInstanceNameFn);
  const logout = useServerFn(logoutInstanceFn);
  const del = useServerFn(deleteInstanceFn);

  const { data: providers = [] } = useQuery({
    queryKey: ["wa-providers"],
    queryFn: () => fetchProviders(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: instances = [] } = useQuery({
    queryKey: ["instances"],
    queryFn: () => fetchList(),
    refetchInterval: 5000,
  });

  const riskFn = useServerFn(getNumbersRisk);
  const { data: risks = [] } = useQuery({
    queryKey: ["numbers-risk"],
    queryFn: () => riskFn(),
    refetchInterval: 30000,
  });
  const riskById = new Map<string, any>((risks as any[]).map((r) => [r.id, r]));


  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [providerId, setProviderId] = useState<string>("evolution");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [qrDialog, setQrDialog] = useState<{ id: string; qr: string | null; value?: string | null } | null>(null);

  const createMut = useMutation({
    mutationFn: (displayName: string) => create({ data: { displayName, provider: providerId } }),
    onSuccess: async (res) => {
      toast.success("تم إنشاء الجلسة");
      setOpen(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["instances"] });
      // Auto-connect to get QR
      const r = await connect({ data: { id: res.instance.id } }).catch(() => null);
       if (r?.qrCode || r?.qrValue) setQrDialog({ id: res.instance.id, qr: r.qrCode, value: r.qrValue });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "خطأ"),
  });

  const connectMut = useMutation({
    mutationFn: (id: string) => connect({ data: { id } }),
    onSuccess: (r, id) => {
      if (r.qrCode || r.qrValue) setQrDialog({ id, qr: r.qrCode, value: r.qrValue });
      else toast.info("لا يوجد QR — قد تكون الجلسة متصلة بالفعل.");
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "خطأ"),
  });

  const refreshMut = useMutation({
    mutationFn: (id: string) => refresh({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instances"] }),
  });

  // نقرأ الحالة أولاً ثم نجلب نسخة واحدة من QR الحالي، من دون إعادة تشغيل الجلسة.
  useEffect(() => {
    if (!qrDialog) return;
    const id = qrDialog.id;
    let stopped = false;
    const tick = async () => {
      const st = await refresh({ data: { id } }).catch(() => null as any);
      if (stopped) return;
      qc.invalidateQueries({ queryKey: ["instances"] });
      const status = (st as any)?.status ?? (st as any)?.instance?.status;
      if (status === "connected") {
        toast.success("تم ربط الرقم بنجاح");
        setQrDialog(null);
        return;
      }
      const r = await connect({ data: { id } }).catch(() => null);
      if (!stopped && (r?.qrCode || r?.qrValue)) {
        setQrDialog((v) => (v && v.id === id ? { id, qr: r.qrCode, value: r.qrValue } : v));
      }
    };
    const timer = setInterval(tick, 12000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [qrDialog?.id, qc, refresh, connect]);


  const renameMut = useMutation({
    mutationFn: (v: { id: string; displayName: string }) => rename({ data: v }),
    onSuccess: () => {
      toast.success("تم تغيير اسم الجلسة");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "خطأ"),
  });

  const logoutMut = useMutation({
    mutationFn: (id: string) => logout({ data: { id } }),
    onSuccess: () => {
      toast.success("تم تسجيل خروج الرقم");
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "خطأ"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("تم حذف الجلسة");
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "خطأ"),
  });


  const allProviders = providers as unknown as ProviderOption[];
  const qrProviders = allProviders.filter((p) => (p.linkMode ?? "qr") === "qr");
  const officialProvider = allProviders.find((p) => p.linkMode === "embedded_signup");

  useEffect(() => {
    if (qrProviders.length && !qrProviders.some((p) => p.id === providerId)) {
      setProviderId(qrProviders[0]!.id);
    }
  }, [qrProviders.map((p) => p.id).join(","), providerId]);

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="text-3xl font-bold">جلسات واتساب</h1>
          <p className="text-muted-foreground mt-1">اربط رقماً رسمياً عبر Meta، أو أنشئ جلسة QR.</p>
        </div>
        <div className="flex items-center gap-2">
        {officialProvider ? <CoexistenceLinkDialog /> : null}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary"><Plus className="h-4 w-4 ml-1" /> جلسة QR</Button>
          </DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>إنشاء جلسة واتساب (QR)</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>اسم الجلسة (للعرض)</Label>
                <Input required aria-label="اسم الجلسة" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: خدمة العملاء" />
              </div>
              <div className="space-y-2">
                <Label>المحرّك (Provider)</Label>
                <div className="grid gap-2">
                  {qrProviders.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!p.enabled}
                      onClick={() => setProviderId(p.id)}
                      className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-right transition ${
                        providerId === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      } ${p.enabled ? "" : "opacity-50 cursor-not-allowed"}`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{p.label}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.enabled ? summarizeCaps(p.capabilities) : "غير مُهيّأ على السيرفر"}
                        </div>
                      </div>
                      {providerId === p.id && p.enabled ? <Badge>مختار</Badge> : null}
                    </button>
                  ))}
                  {qrProviders.length === 0 ? (
                    <p className="text-xs text-muted-foreground">لا توجد محرّكات متاحة.</p>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  الربط عبر QR غير رسمي وقد يعرّض الرقم للتقييد — للأرقام المهمة استخدم «ربط رقم رسمي».
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button validate
                disabled={createMut.isPending}
                onClick={() => createMut.mutate(name)}
              >
                {createMut.isPending ? "..." : "إنشاء"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </header>

      {instances.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Smartphone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">لا توجد جلسات بعد. أنشئ أول جلسة للبدء.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {instances.map((inst: InstanceRow) => {
            const s = STATUS_LABEL[inst.status] ?? { label: inst.status, variant: "outline" as const };
            const phoneLabel = inst.phone_number ? `+${inst.phone_number}` : "لم يظهر رقم الجوال بعد";
            const label = inst.phone_number ? phoneLabel : inst.display_name ?? "جلسة واتساب";
            return (
              <Card key={inst.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-11 w-11">
                      <AvatarImage src={inst.profile_pic_url ?? undefined} alt={label} />
                      <AvatarFallback><Smartphone className="h-5 w-5" /></AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <CardTitle className="text-lg truncate" dir="ltr">{label}</CardTitle>
                      <div className="text-sm font-medium text-muted-foreground truncate">
                        {inst.display_name ?? inst.name ?? "جلسة واتساب"}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={s.variant}>{s.label}</Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {providerLabel(providers as unknown as ProviderOption[], inst.provider)}
                    </Badge>
                    {(() => {
                      const r = riskById.get(inst.id);
                      if (!r) return null;
                      if (r.health_state === "high_risk")
                        return (
                          <Badge variant="destructive" className="gap-1">
                            <ShieldAlert className="h-3 w-3" /> مرتفع الخطورة
                          </Badge>
                        );
                      if (r.health_state === "observation")
                        return (
                          <Badge variant="secondary" className="gap-1">
                            <Clock className="h-3 w-3" /> مراقبة {r.observation_remaining_hours}س
                          </Badge>
                        );
                      if (r.health_state === "watch")
                        return (
                          <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
                            <ShieldAlert className="h-3 w-3" /> تحت المتابعة
                          </Badge>
                        );
                      return (
                        <Badge variant="outline" className="gap-1 border-emerald-500 text-emerald-600">
                          <ShieldCheck className="h-3 w-3" /> مستقر
                        </Badge>
                      );
                    })()}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(() => {
                    const r = riskById.get(inst.id);
                    if (!r) return null;
                    if (r.send_paused)
                      return (
                        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
                          تم إيقاف الإرسال التلقائي من هذا الرقم مؤقتاً لحمايته. الردود اليدوية تعمل.
                        </div>
                      );
                    if (r.health_state === "observation")
                      return (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                          الرقم في فترة المراقبة ({r.observation_remaining_hours} ساعة متبقية): لا رسائل ترحيب تلقائية ولا حملات.
                          راسل العملاء يدوياً وبهدوء خلال هذه الفترة.
                        </div>
                      );
                    return null;
                  })()}
                  <div className="text-xs">
                    {inst.webhook_configured ? (
                      <span className="text-emerald-600">✓ Webhook مربوط تلقائيًا</span>
                    ) : (
                      <span className="text-muted-foreground">سيتم ربط الويبهوك تلقائيًا عند الاتصال</span>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap pt-2">
                    <Button validate size="sm" variant="outline" onClick={() => connectMut.mutate(inst.id)} disabled={connectMut.isPending}>
                      <QrCode className="h-3.5 w-3.5 ml-1" /> QR
                    </Button>
                    <Button validate size="sm" variant="ghost" onClick={() => refreshMut.mutate(inst.id)} disabled={refreshMut.isPending}>
                      <RefreshCw className="h-3.5 w-3.5 ml-1" /> مزامنة الرقم
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ id: inst.id, name: inst.display_name ?? "" })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm("تسجيل خروج الرقم من واتساب؟")) logoutMut.mutate(inst.id); }}>
                      <LogOut className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm("حذف الجلسة؟")) deleteMut.mutate(inst.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!qrDialog} onOpenChange={(o) => !o && setQrDialog(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>امسح رمز QR بواتساب</DialogTitle></DialogHeader>
          {qrDialog?.qr || qrDialog?.value ? (
            <div className="flex justify-center p-6 bg-white rounded-lg overflow-hidden">
              {qrDialog.value ? (
                <QRCodeSVG
                  value={qrDialog.value}
                  size={360}
                  level="L"
                  marginSize={4}
                  className="w-full max-w-[360px] h-auto"
                  title="رمز ربط واتساب"
                />
              ) : (
                <img
                  src={qrDialog.qr?.startsWith("data:") ? qrDialog.qr : `data:image/png;base64,${qrDialog.qr}`}
                  alt="رمز ربط واتساب"
                  width={360}
                  height={360}
                  className="w-full max-w-[360px] h-auto [image-rendering:pixelated]"
                />
              )}
            </div>
          ) : (
            <p className="text-center py-8 text-muted-foreground">جارٍ توليد QR...</p>
          )}
          <p className="text-sm text-muted-foreground text-center">
            افتح واتساب › الأجهزة المرتبطة › ربط جهاز
          </p>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تغيير اسم الجلسة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>اسم الجلسة</Label>
            <Input required aria-label="اسم الجلسة" value={editing?.name ?? ""} onChange={(e) => setEditing((v) => v ? { ...v, name: e.target.value } : v)} />
          </div>
          <DialogFooter>
            <Button validate disabled={renameMut.isPending} onClick={() => editing && renameMut.mutate({ id: editing.id, displayName: editing.name })}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
