import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  getNumbersActivity,
  getSendDecisions,
  setNumberRiskControls,
  getRiskComparison,
  recordRestriction,
  endRestriction,
} from "@/modules/risk";
import { getProviderStats, getNumberDebug } from "@/modules/channels/whatsapp/provider-stats.functions";
import { listProvidersFn, moveSessionProviderFn } from "@/modules/channels/whatsapp/instances.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Activity, ShieldAlert, ShieldCheck, Clock, Pause, Play, Ban, GitCompare, Smartphone, MonitorSmartphone, Server, Plug, ArrowLeftRight, Bug } from "lucide-react";


export const Route = createFileRoute("/_authenticated/admin/numbers")({
  head: () => ({
    meta: [
      { title: "صحة أرقام واتساب - NovaSales" },
      { name: "description", content: "مراقبة تشغيل أرقام واتساب وإدارة مخاطر التقييد." },
      { property: "og:title", content: "صحة أرقام واتساب - NovaSales" },
      { property: "og:description", content: "مراقبة تشغيل أرقام واتساب وإدارة مخاطر التقييد." },
    ],
  }),
  component: AdminNumbers,
});

const STATE: Record<string, { label: string; className: string; icon: any }> = {
  stable: { label: "مستقر", className: "border-emerald-500 text-emerald-600", icon: ShieldCheck },
  observation: { label: "تحت المراقبة", className: "border-amber-500 text-amber-600", icon: Clock },
  watch: { label: "تحت المتابعة", className: "border-orange-500 text-orange-600", icon: ShieldAlert },
  high_risk: { label: "مرتفع الخطورة", className: "border-destructive text-destructive", icon: ShieldAlert },
};

const REASON_LABEL: Record<string, string> = {
  temporary_ban: "تقييد مؤقت",
  logged_out: "تسجيل خروج قسري",
  connection_blocked: "حجب الاتصال",
  manual: "تسجيل يدوي",
};

function fmt(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
}

function delayLabel(min: number | null) {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${min} دقيقة`;
  if (min < 1440) return `${Math.round(min / 60)} ساعة`;
  return `${Math.round(min / 1440)} يوم`;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "bad" | "warn" | "good" }) {
  const cls = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : "";
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function ComparisonSection() {
  const fn = useServerFn(getRiskComparison);
  const q = useQuery({ queryKey: ["admin-risk-comparison"], queryFn: () => fn() });
  if (q.isLoading || !q.data) return null;
  const rows: Array<{ label: string; key: string; unit?: string }> = [
    { label: "تأخير أول رسالة صادرة", key: "first_outbound_delay_minutes", unit: "دقيقة" },
    { label: "نسبة الردود", key: "reply_rate", unit: "%" },
    { label: "نسبة بدء المحادثات", key: "new_conversation_ratio", unit: "%" },
    { label: "متوسط الصادر", key: "outbound_total" },
    { label: "مُرسل من الجوال", key: "from_phone_total" },
    { label: "مُرسل من النظام", key: "from_system_total" },
    { label: "مرات إعادة الربط", key: "relink_count" },
  ];
  const d: any = q.data;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-primary" /> مقارنة بالأرقام السليمة
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">أرقام سليمة</div>
            <div className="text-base font-bold text-emerald-600">{d.healthy.count}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">أرقام سبق تقييدها</div>
            <div className="text-base font-bold text-destructive">{d.restricted.count}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">أرسلت أول رسالة خلال ٣٠ دقيقة</div>
            <div className="text-base font-bold text-amber-600">{d.fast_first_send}</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-right py-1">المؤشر</th>
                <th className="py-1">سليمة</th>
                <th className="py-1">مقيّدة (الآن)</th>
                <th className="py-1">وقت التقييد</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="py-1 text-right">{r.label}</td>
                  <td className="py-1 text-center text-emerald-600">{d.healthy[r.key]}{r.unit ?? ""}</td>
                  <td className="py-1 text-center text-destructive">{d.restricted[r.key]}{r.unit ?? ""}</td>
                  <td className="py-1 text-center">{d.at_restriction[r.key]}{r.unit ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-muted-foreground">
          عمود «وقت التقييد» يعتمد على اللقطة المحفوظة لحالة كل رقم لحظة تقييده.
        </div>
      </CardContent>
    </Card>
  );
}

/** إحصائيات مقارنة بين المحرّكات — يظهر كل محرّك مسجّل تلقائياً. */
function ProviderStatsSection() {
  const fn = useServerFn(getProviderStats);
  const q = useQuery({ queryKey: ["admin-provider-stats"], queryFn: () => fn(), refetchInterval: 60000 });
  if (q.isLoading || !q.data) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" /> إحصائيات المحرّكات (Providers)
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {(q.data as any[]).map((p) => (
          <div key={p.id} className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm">{p.label}</div>
              <Badge variant="outline" className={p.enabled ? "border-emerald-500 text-emerald-600" : "text-muted-foreground"}>
                {p.enabled ? "مُهيّأ" : "غير مُهيّأ"}
              </Badge>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label="جلسات" value={`${p.sessions}`} />
              <Stat label="رسائل" value={`${p.messages}`} />
              <Stat label="أخطاء" value={`${p.errors}`} tone={p.errors > 0 ? "bad" : "good"} />
              <Stat label="تقييدات" value={`${p.restrictions}`} tone={p.restrictions > 0 ? "bad" : "good"} />
            </div>
            <div className="text-[11px] text-muted-foreground">
              متصل الآن: {p.connected} · آخر ويبهوك: {fmt(p.last_webhook_at)}
            </div>
            {p.last_error && <div className="text-[11px] text-destructive truncate">آخر خطأ: {p.last_error}</div>}
            <div className="flex flex-wrap gap-1">
              {Object.entries(p.capabilities as Record<string, boolean>)
                .filter(([, v]) => v)
                .map(([k]) => (
                  <Badge key={k} variant="secondary" className="text-[10px]">
                    {(CAP_LABELS as any)[k] ?? k}
                  </Badge>
                ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const CAP_LABELS: Record<string, string> = {
  supportsMedia: "وسائط",
  supportsAudioNote: "صوتي",
  supportsTyping: "كتابة",
  supportsPresence: "تواجد",
  supportsEdit: "تعديل",
  supportsDelete: "حذف",
  supportsHistory: "سجل",
  supportsReactions: "تفاعلات",
  supportsMarkRead: "مقروء",
  supportsPolls: "استطلاعات",
  supportsChannels: "قنوات",
  supportsCommunities: "مجتمعات",
  supportsCalls: "مكالمات",
  supportsStories: "حالات",
  supportsNewsletters: "نشرات",
  supportsStatus: "حالة",
  supportsGroups: "مجموعات",
  supportsQrLogin: "QR",
  supportsProfilePicture: "صورة",
};

/** لوحة تشخيص رقم + نقل الجلسة إلى محرّك آخر. */
function NumberDebugPanel({ accountId, onMoved }: { accountId: string; onMoved: () => void }) {
  const debugFn = useServerFn(getNumberDebug);
  const providersFn = useServerFn(listProvidersFn);
  const moveFn = useServerFn(moveSessionProviderFn);
  const q = useQuery({
    queryKey: ["admin-number-debug", accountId],
    queryFn: () => debugFn({ data: { accountId } }),
    refetchInterval: 30000,
  });
  const providersQ = useQuery({ queryKey: ["wa-providers"], queryFn: () => providersFn() });
  const move = useMutation({
    mutationFn: (targetProvider: string) => moveFn({ data: { id: accountId, targetProvider } }),
    onSuccess: () => {
      toast.success("تم نقل الجلسة — أعد مسح رمز QR على المحرّك الجديد.");
      q.refetch();
      onMoved();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="text-xs text-muted-foreground">جاري فحص المحرّك...</div>;
  if (q.error) return <div className="text-xs text-destructive">{(q.error as Error).message}</div>;
  const d: any = q.data;
  const others = ((providersQ.data ?? []) as any[]).filter((p) => p.id !== d.provider && p.enabled);
  return (
    <div className="rounded-md border p-2 space-y-2">
      <div className="text-xs font-semibold flex items-center gap-1">
        <Bug className="h-3.5 w-3.5" /> تشخيص المحرّك
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Provider" value={d.providerLabel} />
        <Stat label="Session" value={<span dir="ltr">{d.session}</span>} />
        <Stat label="Engine" value={d.engine ?? "—"} />
        <Stat label="Server" value={<span dir="ltr" className="text-[11px]">{d.server ?? "—"}</span>} />
        <Stat label="Latency" value={d.latencyMs !== null ? `${d.latencyMs}ms` : "—"} tone={d.latencyMs !== null && d.latencyMs > 1500 ? "warn" : "good"} />
        <Stat
          label="Webhook"
          value={d.webhookConfigured ? "متصل" : "غير مضبوط"}
          tone={d.webhookConfigured ? "good" : "bad"}
        />
        <Stat label="آخر ويبهوك" value={fmt(d.lastWebhookAt)} />
        <Stat label="أخطاء المحرّك" value={d.errorCount} tone={d.errorCount > 0 ? "bad" : "good"} />
      </div>
      {d.lastError && <div className="text-[11px] text-destructive">آخر خطأ: {d.lastError}</div>}
      {d.movedFrom && <div className="text-[11px] text-muted-foreground">نُقلت من محرّك: {d.movedFrom}</div>}
      <div className="flex flex-wrap gap-1">
        {Object.entries(d.capabilities as Record<string, boolean>)
          .filter(([, v]) => v)
          .map(([k]) => (
            <Badge key={k} variant="secondary" className="text-[10px]">
              {CAP_LABELS[k] ?? k}
            </Badge>
          ))}
      </div>
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <ArrowLeftRight className="h-3 w-3" /> نقل الجلسة إلى:
          </span>
          {others.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              disabled={move.isPending}
              onClick={() => {
                if (confirm(`نقل الجلسة إلى ${p.label}؟ ستحتاج لإعادة مسح QR. بيانات العملاء والرسائل تبقى كما هي.`)) {
                  move.mutate(p.id);
                }
              }}
            >
              <Plug className="h-3.5 w-3.5 ml-1" /> {p.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminNumbers() {
  const qc = useQueryClient();
  const listFn = useServerFn(getNumbersActivity);

  const decisionsFn = useServerFn(getSendDecisions);
  const controlFn = useServerFn(setNumberRiskControls);
  const restrictFn = useServerFn(recordRestriction);
  const endRestrictFn = useServerFn(endRestriction);
  const [openDecisions, setOpenDecisions] = useState<string | null>(null);
  const [openDebug, setOpenDebug] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["admin-numbers"], queryFn: () => listFn(), refetchInterval: 60000 });
  const decisionsQ = useQuery({
    queryKey: ["admin-number-decisions", openDecisions],
    queryFn: () => decisionsFn({ data: { accountId: openDecisions! } }),
    enabled: Boolean(openDecisions),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-numbers"] });
    qc.invalidateQueries({ queryKey: ["admin-risk-comparison"] });
  };

  const control = useMutation({
    mutationFn: (input: { accountId: string; action: any; hours?: number }) => controlFn({ data: input }),
    onSuccess: () => {
      toast.success("تم التنفيذ");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const restrict = useMutation({
    mutationFn: (accountId: string) => restrictFn({ data: { accountId, reason: "manual" } }),
    onSuccess: () => {
      toast.success("تم تسجيل التقييد مع لقطة كاملة للحالة");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const recover = useMutation({
    mutationFn: (accountId: string) => endRestrictFn({ data: { accountId } }),
    onSuccess: () => {
      toast.success("تم إنهاء التقييد");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground">جاري التحميل...</div>;
  if (q.error) return <div className="text-sm text-destructive">{(q.error as Error).message}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">صحة أرقام واتساب ومعلومات التشغيل</h2>
      </div>

      <ProviderStatsSection />

      <ComparisonSection />

      {(q.data ?? []).length === 0 && <div className="text-sm text-muted-foreground">لا توجد أرقام مربوطة.</div>}

      {(q.data ?? []).map((n: any) => {
        const st = STATE[n.health_state] ?? STATE.stable;
        const Icon = st.icon;
        const fastFirst = n.first_outbound_delay_minutes !== null && n.first_outbound_delay_minutes < 30;
        return (
          <Card key={n.id} className={n.is_restricted_now ? "border-destructive" : undefined}>
            <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3 space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-base" dir="ltr">
                  {n.phone_number ? `+${n.phone_number}` : n.display_name}
                </CardTitle>
                <div className="text-xs text-muted-foreground">
                  {n.display_name} · {n.organization_name} · الحالة: {n.status}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1">
                  {n.is_restricted_now && (
                    <Badge variant="outline" className="gap-1 border-destructive text-destructive">
                      <Ban className="h-3 w-3" /> مقيّد حالياً
                    </Badge>
                  )}
                  <Badge variant="outline" className={`gap-1 ${st.className}`}>
                    <Icon className="h-3 w-3" /> {st.label}
                  </Badge>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  درجة الخطورة: {n.risk_score} · نقاط القواعد: {n.rule_points}
                </span>
                {n.health_state === "observation" && (
                  <span className="text-[11px] text-amber-600">متبقي {n.observation_remaining_hours} ساعة</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="تاريخ الربط" value={fmt(n.linked_at)} />
                <Stat label="مدة الاتصال" value={`${n.uptime_hours} ساعة`} />
                <Stat label="أول رسالة" value={fmt(n.first_message_at)} />
                <Stat label="آخر رسالة" value={fmt(n.last_message_at)} />
                <Stat label="إجمالي الصادر" value={n.outbound_total} />
                <Stat label="إجمالي الوارد" value={n.inbound_total} tone={n.inbound_total === 0 && n.outbound_total > 0 ? "bad" : undefined} />
                <Stat label="مُرسل من النظام" value={n.from_system_total} />
                <Stat label="مُرسل من الجوال" value={n.from_phone_total} />
                <Stat label="محادثات جديدة" value={n.new_conversations} />
                <Stat label="رسائل 24 ساعة" value={n.messages_24h} />
                <Stat label="رسائل 7 أيام" value={n.messages_7d} />
                <Stat label="أحداث الصحة" value={n.health_events_total} />
              </div>

              <div className="rounded-md border p-2 space-y-2">
                <div className="text-xs font-semibold">مؤشرات الخطورة المتقدمة</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat
                    label="تأخير أول رسالة صادرة"
                    value={delayLabel(n.first_outbound_delay_minutes)}
                    tone={fastFirst ? "bad" : "good"}
                  />
                  <Stat
                    label="نوع أول رسالة"
                    value={n.first_message_kind === "new_conversation" ? "بدء محادثة جديدة" : n.first_message_kind === "reply" ? "رد على عميل" : "—"}
                    tone={n.first_message_kind === "new_conversation" ? "bad" : n.first_message_kind ? "good" : undefined}
                  />
                  <Stat
                    label="مصدر أول رسالة"
                    value={
                      n.first_message_source === "phone" ? (
                        <span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3" /> من الجوال</span>
                      ) : n.first_message_source === "system" ? (
                        <span className="inline-flex items-center gap-1"><MonitorSmartphone className="h-3 w-3" /> من NovaSales</span>
                      ) : (
                        "—"
                      )
                    }
                    tone={n.first_message_source === "phone" ? "warn" : undefined}
                  />
                  <Stat label="نسبة الردود" value={`${n.reply_rate}%`} tone={n.reply_rate < 30 ? "bad" : "good"} />
                  <Stat
                    label="نسبة بدء المحادثات"
                    value={`${n.new_conversation_ratio}%`}
                    tone={n.new_conversation_ratio > 20 ? "bad" : "good"}
                  />
                  <Stat label="محادثات بدأناها / بدأها العميل" value={`${n.conversations_started_by_us} / ${n.conversations_started_by_peer}`} />
                  <Stat label="روابط / وسائط مُرسلة" value={`${n.links_sent} / ${n.media_sent}`} />
                  <Stat
                    label="آخر إعادة ربط"
                    value={fmt(n.last_relinked_at)}
                    tone={n.last_relinked_at && Date.now() - new Date(n.last_relinked_at).getTime() < 24 * 3600_000 ? "warn" : undefined}
                  />
                  <Stat label="مرات إعادة الربط" value={n.relink_count} />
                  <Stat
                    label="عدد القيود السابقة"
                    value={n.restriction_count}
                    tone={n.restriction_count > 0 ? "bad" : "good"}
                  />
                  <Stat label="آخر تقييد" value={fmt(n.last_restricted_at)} />
                  <Stat label="حملات المؤسسة" value={n.campaigns_count} />
                </div>
                {n.rule_reasons?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {n.rule_reasons.map((r: any) => (
                      <Badge key={r.key} variant="outline" className="border-amber-500 text-amber-700 text-[10px]">
                        {r.label} (+{r.weight})
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {n.restrictions?.length > 0 && (
                <div className="rounded-md border border-destructive/40 p-2 text-xs space-y-1">
                  <div className="font-semibold text-destructive">سجل القيود السابقة</div>
                  {n.restrictions.map((r: any) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <span>{fmt(r.detected_at)}</span>
                      <span>{REASON_LABEL[r.reason ?? "manual"] ?? r.reason}</span>
                      <span>{r.detection_source === "automatic" ? "رصد تلقائي" : "تسجيل يدوي"}</span>
                      <span>{r.ended_at ? `المدة: ${r.duration_minutes ?? 0} دقيقة` : "ما زال قائماً"}</span>
                    </div>
                  ))}
                </div>
              )}

              {n.recent_events?.length > 0 && (
                <div className="text-xs space-y-1">
                  <div className="font-semibold">آخر الأحداث:</div>
                  {n.recent_events.map((e: any, i: number) => (
                    <div key={i} className="text-muted-foreground">
                      {fmt(e.created_at)} — {e.event_type}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {n.health_state === "observation" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => control.mutate({ accountId: n.id, action: "end_observation" })}>
                      إنهاء المراقبة
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => control.mutate({ accountId: n.id, action: "extend_observation", hours: 24 })}>
                      تمديد 24 ساعة
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => control.mutate({ accountId: n.id, action: "start_observation", hours: 48 })}>
                    بدء مراقبة 48 ساعة
                  </Button>
                )}
                {n.send_paused ? (
                  <Button size="sm" variant="outline" onClick={() => control.mutate({ accountId: n.id, action: "resume_sending" })}>
                    <Play className="h-3.5 w-3.5 ml-1" /> استئناف الإرسال
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => control.mutate({ accountId: n.id, action: "pause_sending" })}>
                    <Pause className="h-3.5 w-3.5 ml-1" /> إيقاف الإرسال
                  </Button>
                )}
                {n.is_restricted_now ? (
                  <Button size="sm" variant="outline" onClick={() => recover.mutate(n.id)}>
                    تم رفع التقييد
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => restrict.mutate(n.id)}>
                    <Ban className="h-3.5 w-3.5 ml-1" /> تسجيل تقييد الآن
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => control.mutate({ accountId: n.id, action: "reset_score" })}>
                  تصفير الدرجة
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpenDecisions(openDecisions === n.id ? null : n.id)}>
                  سجل قرارات الإرسال
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpenDebug(openDebug === n.id ? null : n.id)}>
                  <Bug className="h-3.5 w-3.5 ml-1" /> تشخيص المحرّك
                </Button>
              </div>

              {openDebug === n.id && (
                <NumberDebugPanel
                  accountId={n.id}
                  onMoved={() => {
                    invalidate();
                    qc.invalidateQueries({ queryKey: ["admin-provider-stats"] });
                  }}
                />
              )}

              {openDecisions === n.id && (
                <div className="rounded-md border p-2 text-xs space-y-1 max-h-64 overflow-auto">
                  {decisionsQ.isLoading && <div className="text-muted-foreground">جاري التحميل...</div>}
                  {(decisionsQ.data ?? []).map((d: any) => (
                    <div key={d.id} className="flex flex-wrap items-center gap-2">
                      <span className={d.allowed ? "text-emerald-600" : "text-destructive"}>
                        {d.allowed ? "سُمح" : "رُفض"}
                      </span>
                      <span className="text-muted-foreground">{fmt(d.created_at)}</span>
                      <span>{d.source}</span>
                      {d.failed_rules?.length > 0 && <span className="text-destructive">{d.failed_rules.join(", ")}</span>}
                    </div>
                  ))}
                  {(decisionsQ.data ?? []).length === 0 && !decisionsQ.isLoading && (
                    <div className="text-muted-foreground">لا توجد قرارات مسجّلة.</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
