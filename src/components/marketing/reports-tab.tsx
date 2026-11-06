import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOutboundReport } from "@/modules/marketing/outbound.functions";
import { PROSPECT_STATUS_LABELS } from "@/modules/marketing/statuses";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const RANGES = [7, 30, 90] as const;
const STATUS: Record<string, string> = { draft: "مسودة", scheduled: "مجدولة", running: "قيد الإرسال", paused: "موقوفة", completed: "مكتملة", cancelled: "ملغاة", failed: "فشلت" };
const FUNNEL_ORDER = ["new", "review", "qualified", "approved", "contacted", "replied", "interested", "converted", "not_interested", "opted_out", "excluded", "invalid"];

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

/** What the outbound campaigns achieved: stages, rates, answers, stop requests and the pipeline of businesses. */
export function ReportsTab() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const fn = useServerFn(getOutboundReport);
  const q = useQuery({ queryKey: ["outbound-report", days], queryFn: () => fn({ data: { days } }), refetchInterval: 60_000 });
  const r = q.data;
  const peak = Math.max(1, ...(r?.daily.map((d) => d.sent) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">أداء حملات Outbound (واتساب) للفترة المختارة.</p>
        <div className="flex gap-1" role="group" aria-label="الفترة">
          {RANGES.map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-md border px-3 py-1 text-sm ${days === d ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>
              آخر {d} يوماً
            </button>
          ))}
        </div>
      </div>

      {q.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : r ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="مستلمون" value={r.totals.recipients} hint={r.totals.pending ? `${r.totals.pending} بالانتظار` : undefined} />
            <Kpi label="أُرسلت" value={r.totals.sent} />
            <Kpi label="سُلّمت" value={r.totals.delivered} hint={`${r.totals.deliveredRate}% من المُرسَل`} />
            <Kpi label="قُرئت" value={r.totals.read} hint={`${r.totals.readRate}% من المُرسَل`} />
            <Kpi label="ردّوا" value={r.totals.replied} hint={`${r.totals.replyRate}% من المُرسَل`} />
            <Kpi label="طلبوا الإيقاف" value={r.totals.optOuts} />
            <Kpi label="فشلت" value={r.totals.failed} hint={`${r.totals.failedRate}% من المستلمين`} />
            <Kpi label="تُخطّيت" value={r.totals.skipped} />
          </div>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">الرسائل المُرسَلة يومياً</h3>
            <div className="flex h-32 items-end gap-0.5" role="img" aria-label="رسائل مُرسَلة يومياً">
              {r.daily.map((d) => (
                <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${d.sent}`}>
                  <div className="w-full rounded-sm bg-primary/70" style={{ height: `${(d.sent / peak) * 100}%`, minHeight: d.sent ? 2 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{r.daily[0]?.date}</span>
              <span>أعلى يوم: {peak === 1 && r.totals.sent === 0 ? 0 : peak}</span>
              <span>{r.daily.at(-1)?.date}</span>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-muted-foreground">
                    {["الحملة", "الحالة", "أُرسلت", "سُلّمت", "ردّوا", "فشلت"].map((h) => (
                      <th key={h} className="p-3 text-start font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.campaigns.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{formatDateTime(c.created_at)}</div>
                      </td>
                      <td className="p-3"><Badge variant="secondary">{STATUS[c.status] ?? c.status}</Badge></td>
                      <td className="p-3 tabular-nums">{c.sent}/{c.recipients}</td>
                      <td className="p-3 tabular-nums">{c.delivered}</td>
                      <td className="p-3 tabular-nums">{c.replied} <span className="text-xs text-muted-foreground">({c.replyRate}%)</span></td>
                      <td className="p-3 tabular-nums">{c.failed}</td>
                    </tr>
                  ))}
                  {r.campaigns.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد حملات في هذه الفترة.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>

            <Card className="space-y-1.5 p-4">
              <h3 className="mb-2 text-sm font-semibold">الجهات حسب المرحلة</h3>
              {FUNNEL_ORDER.filter((s) => r.funnel[s]).map((s) => (
                <div key={s} className="flex items-center justify-between text-sm">
                  <span>{PROSPECT_STATUS_LABELS[s as keyof typeof PROSPECT_STATUS_LABELS]}</span>
                  <span className="tabular-nums text-muted-foreground">{r.funnel[s]}</span>
                </div>
              ))}
              {Object.keys(r.funnel).length === 0 && <p className="text-sm text-muted-foreground">لا توجد جهات بعد.</p>}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
