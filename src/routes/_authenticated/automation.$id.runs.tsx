import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowRight, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listRuns, getRunDetail } from "@/modules/workflow";

export const Route = createFileRoute("/_authenticated/automation/$id/runs")({
  head: () => ({ meta: [{ title: "سجل تشغيل الأتمتة - NovaSales" }] }),
  component: RunsPage,
});

const STATUS_ICON: Record<string, any> = { completed: CheckCircle2, failed: XCircle, running: Loader2, waiting: Clock, cancelled: XCircle };
const STATUS_COLOR: Record<string, string> = { completed: "text-emerald-500", failed: "text-red-500", running: "text-blue-500", waiting: "text-amber-500", cancelled: "text-slate-400" };

function RunsPage() {
  const { id } = Route.useParams();
  const list = useServerFn(listRuns);
  const detail = useServerFn(getRunDetail);
  const q = useQuery({ queryKey: ["runs", id], queryFn: () => list({ data: { workflowId: id, limit: 50 } }), refetchInterval: 5000 });
  const [selected, setSelected] = useState<string | null>(null);
  const d = useQuery({ queryKey: ["run", selected], queryFn: () => detail({ data: { runId: selected! } }), enabled: !!selected });

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 min-w-0" dir="rtl">
      <div className="flex items-center gap-3">
        <Link to="/automation/$id" params={{ id }}><Button size="sm" variant="ghost"><ArrowRight className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-bold">سجل التشغيل</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="min-w-0 lg:col-span-1 space-y-2">
          {(q.data?.runs ?? []).map((r: any) => {
            const Icon = STATUS_ICON[r.status] ?? Clock;
            return (
              <Card key={r.id} className={`p-3 cursor-pointer ${selected === r.id ? "ring-2 ring-primary" : ""}`} onClick={() => setSelected(r.id)}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${STATUS_COLOR[r.status]}`} />
                  <Badge variant="outline">{r.status}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(r.started_at).toLocaleString()}</span>
                </div>
                {r.error && <div className="text-xs text-red-500 mt-1">{r.error}</div>}
                <div className="text-xs text-muted-foreground mt-1">خطوات: {r.step_count}</div>
              </Card>
            );
          })}
          {q.data?.runs.length === 0 && <Card className="p-6 text-center text-muted-foreground">لا توجد تشغيلات بعد.</Card>}
        </div>
        <div className="min-w-0 lg:col-span-2">
          {selected ? (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">تفاصيل الخطوات</h3>
              <div className="space-y-2">
                {(d.data?.steps ?? []).map((s: any) => (
                  <div key={s.id} className="border-l-2 pr-3" style={{ borderColor: s.status === "ok" ? "#10b981" : s.status === "failed" ? "#ef4444" : "#f59e0b" }}>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">#{s.step_index}</Badge>
                      <code className="text-xs">{s.step_type}</code>
                      {s.action && <Badge>{s.action}</Badge>}
                      <Badge variant={s.status === "ok" ? "default" : s.status === "failed" ? "destructive" : "secondary"}>{s.status}</Badge>
                    </div>
                    {s.error && <div className="text-xs text-red-500 mt-1">{s.error}</div>}
                    {s.output && Object.keys(s.output).length > 0 && (
                      <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-auto">{JSON.stringify(s.output, null, 2)}</pre>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="p-8 text-center text-muted-foreground">اختر تشغيلاً لعرض التفاصيل.</Card>
          )}
        </div>
      </div>
    </div>
  );
}
