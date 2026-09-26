import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Zap, Plus, Play, Trash2, Power } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listWorkflows, saveWorkflow, toggleWorkflow, deleteWorkflow, runWorkflowManually } from "@/modules/workflow";

export const Route = createFileRoute("/_authenticated/automation")({
  head: () => ({
    meta: [
      { title: "الأتمتة - NovaSales" },
      { name: "description", content: "بناء وإدارة سير عمل الأتمتة." },
    ],
  }),
  component: AutomationPage,
});

function AutomationPage() {
  const qc = useQueryClient();
  const list = useServerFn(listWorkflows);
  const save = useServerFn(saveWorkflow);
  const toggle = useServerFn(toggleWorkflow);
  const del = useServerFn(deleteWorkflow);
  const run = useServerFn(runWorkflowManually);
  const q = useQuery({ queryKey: ["workflows"], queryFn: () => list() });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [triggerType, setTriggerType] = useState<"event" | "manual">("event");
  const [triggerEvent, setTriggerEvent] = useState("crm.lead.assigned");

  const createMut = useMutation({
    mutationFn: () => save({
      data: {
        name,
        description: desc,
        is_active: false,
        trigger_type: triggerType,
        trigger_config: triggerType === "event" ? { event: triggerEvent } : {},
        definition: { version: 1, engine: "v1", metadata: { createdAt: new Date().toISOString() }, steps: [] },
      },
    }),
    onSuccess: () => {
      toast.success("تم إنشاء الأتمتة");
      setOpen(false); setName(""); setDesc("");
      qc.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => toggle({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["workflows"] }); },
  });
  const runMut = useMutation({
    mutationFn: (id: string) => run({ data: { id, payload: {} } }),
    onSuccess: () => toast.success("تم التشغيل"),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-8 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">الأتمتة</h1>
            <p className="text-sm text-muted-foreground">قواعد تسير تلقائياً بناءً على أحداث النظام.</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 ml-1" /> أتمتة جديدة</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>إنشاء أتمتة</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>الوصف</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
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
              {triggerType === "event" && (
                <div>
                  <Label>اسم الحدث</Label>
                  <Select value={triggerEvent} onValueChange={setTriggerEvent}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="crm.lead.created">Lead جديد</SelectItem>
                      <SelectItem value="crm.lead.assigned">Lead تم توزيعه</SelectItem>
                      <SelectItem value="crm.opportunity.created">فرصة جديدة</SelectItem>
                      <SelectItem value="crm.opportunity.stage_changed">تغيير مرحلة</SelectItem>
                      <SelectItem value="messaging.message.received">رسالة واردة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => createMut.mutate()} disabled={!name || createMut.isPending}>إنشاء</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {q.data?.workflows.map((w: any) => (
          <Card key={w.id} className="p-4 flex items-center gap-4">
            <Zap className={`h-5 w-5 ${w.is_active ? "text-emerald-500" : "text-muted-foreground"}`} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Link to="/automation/$id" params={{ id: w.id }} className="font-semibold hover:underline">{w.name}</Link>
                <Badge variant="outline">{w.trigger_type === "event" ? `حدث: ${w.trigger_config?.event ?? "-"}` : w.trigger_type}</Badge>
                <Badge variant={w.is_active ? "default" : "secondary"}>{w.is_active ? "مفعّل" : "معطّل"}</Badge>
              </div>
              {w.description && <div className="text-xs text-muted-foreground mt-1">{w.description}</div>}
            </div>
            <Button size="sm" variant="outline" onClick={() => runMut.mutate(w.id)}><Play className="h-3 w-3 ml-1" /> تشغيل يدوي</Button>
            <Button size="sm" variant={w.is_active ? "secondary" : "default"} onClick={() => toggleMut.mutate({ id: w.id, is_active: !w.is_active })}>
              <Power className="h-3 w-3 ml-1" /> {w.is_active ? "إيقاف" : "تفعيل"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف؟")) delMut.mutate(w.id); }}><Trash2 className="h-3 w-3" /></Button>
          </Card>
        ))}
        {q.data && q.data.workflows.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">لا توجد أتمتة بعد.</Card>
        )}
      </div>
    </div>
  );
}
