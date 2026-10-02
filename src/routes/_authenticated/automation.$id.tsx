import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { toast } from "@/lib/toast";
import { ArrowRight, Save, Plus, Trash2, ChevronUp, ChevronDown, Filter, Clock, Send, Hourglass, GitBranch } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getWorkflow, saveWorkflow, listActionsCatalog } from "@/modules/workflow";

export const Route = createFileRoute("/_authenticated/automation/$id")({
  head: () => ({ meta: [{ title: "تعديل الأتمتة - NovaSales" }] }),
  component: EditPage,
});

const STEP_ICONS: Record<string, any> = { action: Send, delay: Clock, wait_for_event: Hourglass, condition: Filter, branch: GitBranch };
const STEP_TYPES = [
  { v: "action", l: "إجراء" },
  { v: "delay", l: "انتظار زمني" },
  { v: "wait_for_event", l: "انتظار حدث" },
  { v: "condition", l: "شرط" },
  { v: "end", l: "نهاية" },
];

function newStep(type: string): any {
  const id = `s_${Math.random().toString(36).slice(2, 8)}`;
  if (type === "action") return { id, type, label: "إجراء", icon: "send", action: "messaging.send", config: {} };
  if (type === "delay") return { id, type, label: "انتظار", icon: "clock", duration_minutes: 30 };
  if (type === "wait_for_event") return { id, type, label: "انتظار حدث", icon: "hourglass", event: "messaging.message.received", match: {}, timeout_minutes: 1440 };
  if (type === "condition") return { id, type, label: "شرط", icon: "filter", expr: { truthy: true } };
  return { id, type: "end", label: "نهاية", icon: "check" };
}

function EditPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getWorkflow);
  const saveFn = useServerFn(saveWorkflow);
  const actionsFn = useServerFn(listActionsCatalog);
  const q = useQuery({ queryKey: ["workflow", id], queryFn: () => getFn({ data: { id } }) });
  const actionsQ = useQuery({ queryKey: ["actions"], queryFn: () => actionsFn() });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [triggerType, setTriggerType] = useState<"event" | "manual" | "schedule">("event");
  const [triggerEvent, setTriggerEvent] = useState("crm.lead.assigned");
  const [steps, setSteps] = useState<any[]>([]);

  useEffect(() => {
    if (q.data?.workflow) {
      const w = q.data.workflow;
      setName(w.name);
      setDesc(w.description ?? "");
      setTriggerType(w.trigger_type);
      setTriggerEvent(w.trigger_config?.event ?? "");
      setSteps(w.definition?.steps ?? []);
    }
  }, [q.data]);

  const saveMut = useMutation({
    mutationFn: () => {
      // Wire next-step: linear chain by default
      const linked = steps.map((s, i) => ({ ...s, next: s.next ?? steps[i + 1]?.id }));
      return saveFn({
        data: {
          id, name, description: desc, is_active: q.data?.workflow?.is_active ?? false,
          trigger_type: triggerType,
          trigger_config: triggerType === "event" ? { event: triggerEvent } : {},
          definition: {
            version: (q.data?.workflow?.definition?.version ?? 1) + 1,
            engine: "v1",
            metadata: { ...(q.data?.workflow?.definition?.metadata ?? {}), updatedAt: new Date().toISOString() },
            steps: linked,
          },
        },
      });
    },
    onSuccess: () => { toast.success("تم الحفظ"); qc.invalidateQueries({ queryKey: ["workflow", id] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStep = (i: number, patch: any) => setSteps((s) => s.map((st, idx) => idx === i ? { ...st, ...patch } : st));
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) => setSteps((s) => {
    const n = [...s]; const j = i + dir; if (j < 0 || j >= n.length) return s;
    [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  if (q.isLoading) return <div className="p-8">جاري التحميل...</div>;

  return (
    <div className="p-8 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/automation"><Button size="sm" variant="ghost"><ArrowRight className="h-4 w-4" /></Button></Link>
          <h1 className="text-2xl font-bold">تعديل الأتمتة</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/automation/$id/runs" params={{ id }}><Button variant="outline">سجل التشغيل</Button></Link>
          <Button validate onClick={() => saveMut.mutate()} disabled={saveMut.isPending}><Save className="h-4 w-4 ml-1" /> حفظ</Button>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>الاسم</Label><Input required aria-label="اسم الأتمتة" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>نوع المُشغّل</Label>
            <Select value={triggerType} onValueChange={(v) => setTriggerType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="event">حدث</SelectItem>
                <SelectItem value="manual">يدوي</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {triggerType === "event" && (
          <div>
            <Label>الحدث</Label>
            <Select value={triggerEvent} onValueChange={setTriggerEvent}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="crm.lead.created">crm.lead.created</SelectItem>
                <SelectItem value="crm.lead.assigned">crm.lead.assigned</SelectItem>
                <SelectItem value="crm.opportunity.created">crm.opportunity.created</SelectItem>
                <SelectItem value="crm.opportunity.stage_changed">crm.opportunity.stage_changed</SelectItem>
                <SelectItem value="messaging.message.received">messaging.message.received</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div><Label>الوصف</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">الخطوات ({steps.length})</h2>
          <Select value="" onValueChange={(v) => v && setSteps((s) => [...s, newStep(v)])}>
            <SelectTrigger className="w-48"><SelectValue placeholder="إضافة خطوة" /></SelectTrigger>
            <SelectContent>
              {STEP_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {steps.map((s, i) => {
            const Icon = STEP_ICONS[s.type] ?? Send;
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Icon className="h-5 w-5 text-primary mt-1" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input className="w-64" value={s.label ?? ""} onChange={(e) => updateStep(i, { label: e.target.value })} placeholder="اسم الخطوة" />
                      <Badge variant="outline">{s.type}</Badge>
                      <code className="text-xs text-muted-foreground">{s.id}</code>
                    </div>
                    {s.type === "action" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">الإجراء</Label>
                          <Select value={s.action} onValueChange={(v) => updateStep(i, { action: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(actionsQ.data?.actions ?? []).map((a: string) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">الإعدادات (JSON)</Label>
                          <Textarea
                            className="font-mono text-xs"
                            rows={3}
                            value={JSON.stringify(s.config ?? {}, null, 2)}
                            onChange={(e) => {
                              try { updateStep(i, { config: JSON.parse(e.target.value) }); } catch {}
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {s.type === "delay" && (
                      <div><Label className="text-xs">الدقائق</Label>
                        <Input type="number" value={s.duration_minutes} onChange={(e) => updateStep(i, { duration_minutes: Number(e.target.value) })} />
                      </div>
                    )}
                    {s.type === "wait_for_event" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div><Label className="text-xs">اسم الحدث</Label>
                          <Input value={s.event} onChange={(e) => updateStep(i, { event: e.target.value })} /></div>
                        <div><Label className="text-xs">مهلة (دقائق)</Label>
                          <Input type="number" value={s.timeout_minutes} onChange={(e) => updateStep(i, { timeout_minutes: Number(e.target.value) })} /></div>
                        <div className="col-span-2">
                          <Label className="text-xs">شرط المطابقة (JSON)</Label>
                          <Textarea
                            className="font-mono text-xs" rows={2}
                            value={JSON.stringify(s.match ?? {}, null, 2)}
                            onChange={(e) => { try { updateStep(i, { match: JSON.parse(e.target.value) }); } catch {} }}
                          />
                        </div>
                      </div>
                    )}
                    {s.type === "condition" && (
                      <div>
                        <Label className="text-xs">الشرط (JSON)</Label>
                        <Textarea
                          className="font-mono text-xs" rows={2}
                          value={JSON.stringify(s.expr ?? {}, null, 2)}
                          onChange={(e) => { try { updateStep(i, { expr: JSON.parse(e.target.value) }); } catch {} }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button size="icon" variant="ghost" onClick={() => moveStep(i, -1)}><ChevronUp className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => moveStep(i, 1)}><ChevronDown className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => removeStep(i)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              </Card>
            );
          })}
          {steps.length === 0 && <Card className="p-6 text-center text-muted-foreground">أضف الخطوة الأولى.</Card>}
        </div>
      </div>
    </div>
  );
}
