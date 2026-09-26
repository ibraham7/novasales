import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Plus, Trash2, Phone, Mail, MessageSquare, Calendar, CheckSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listPipelines,
  moveOpportunityToStage,
  listTimeline,
  listActivities,
  createActivity,
  listTasks,
  createTask,
  updateTask,
} from "@/modules/crm";
import { OwnershipCard } from "@/components/ownership-card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/opportunities/$oppId")({
  head: ({ params }) => ({
    meta: [
      { title: `فرصة ${params.oppId.slice(0, 8)} - NovaSales` },
      { name: "description", content: "تفاصيل الفرصة والأنشطة والمهام." },
    ],
  }),
  component: OpportunityDetailPage,
});

function OpportunityDetailPage() {
  const { oppId } = Route.useParams();
  const qc = useQueryClient();

  const oppQ = useQuery({
    queryKey: ["opp", oppId],
    queryFn: async () => {
      const { data, error } = await supabase.from("opp_opportunities").select("*").eq("id", oppId).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const contactQ = useQuery({
    queryKey: ["opp-contact", oppQ.data?.contact_id],
    enabled: !!oppQ.data?.contact_id,
    queryFn: async () => {
      const cid = oppQ.data?.contact_id;
      if (!cid) return null;
      const { data } = await supabase.from("crm_contacts").select("*").eq("id", cid).maybeSingle();
      return data;
    },
  });

  const listPipesFn = useServerFn(listPipelines);
  const pipesQ = useQuery({ queryKey: ["pipelines"], queryFn: () => listPipesFn() });
  const moveFn = useServerFn(moveOpportunityToStage);
  const moveMut = useMutation({
    mutationFn: (stageId: string) => moveFn({ data: { opportunityId: oppId, stageId } }),
    onSuccess: () => {
      toast.success("تم النقل");
      qc.invalidateQueries({ queryKey: ["opp", oppId] });
      qc.invalidateQueries({ queryKey: ["timeline", "opportunity", oppId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentPipe = pipesQ.data?.find((p: any) => p.id === oppQ.data?.pipeline_id) ?? pipesQ.data?.find((p: any) => p.is_default);
  const stages: any[] = currentPipe?.stages ?? [];
  const currentStage = stages.find((s: any) => s.id === oppQ.data?.stage_id);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4" dir="rtl">
      <Link to="/pipeline" className="text-sm text-primary flex items-center gap-1">
        <ArrowRight className="h-4 w-4" /> عودة للقمع
      </Link>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">
              {oppQ.data?.title || contactQ.data?.display_name || contactQ.data?.full_name || "فرصة"}
            </h1>
            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
              <span>الفتح: {oppQ.data?.opened_at ? new Date(oppQ.data.opened_at).toLocaleDateString("ar-EG") : "—"}</span>
              {oppQ.data?.value != null && (
                <span>القيمة: {Number(oppQ.data.value).toLocaleString()} {oppQ.data?.currency ?? ""}</span>
              )}
              {oppQ.data?.probability != null && <span>احتمالية: {oppQ.data.probability}%</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentStage && (
              <Badge style={{ background: currentStage.color }} className="text-white">
                {currentStage.name}
              </Badge>
            )}
            <Select
              value={oppQ.data?.stage_id ?? ""}
              onValueChange={(v) => moveMut.mutate(v)}
            >
              <SelectTrigger className="w-56"><SelectValue placeholder="غيّر المرحلة" /></SelectTrigger>
              <SelectContent>
                {stages.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {oppQ.data?.lead_id && (
        <OwnershipCard
          leadId={oppQ.data.lead_id}
          currentOwnerId={oppQ.data.owner_agent_id ?? null}
          departmentId={oppQ.data.department_id ?? null}
        />
      )}

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">الجدول الزمني</TabsTrigger>
          <TabsTrigger value="activities">الأنشطة</TabsTrigger>
          <TabsTrigger value="tasks">المهام</TabsTrigger>
          <TabsTrigger value="details">التفاصيل</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline"><TimelineTab entityId={oppId} /></TabsContent>
        <TabsContent value="activities"><ActivitiesTab entityId={oppId} /></TabsContent>
        <TabsContent value="tasks"><TasksTab entityId={oppId} /></TabsContent>
        <TabsContent value="details">
          <Card className="p-5 space-y-2 text-sm">
            <Row label="جهة الاتصال" value={contactQ.data?.display_name ?? contactQ.data?.full_name ?? "—"} />
            <Row label="المصدر" value={oppQ.data?.source ?? "—"} />
            <Row label="القسم" value={oppQ.data?.department_id ?? "—"} />
            <Row label="تاريخ الإغلاق المتوقع" value={oppQ.data?.expected_close_date ?? "—"} />
            <Row label="النتيجة" value={oppQ.data?.outcome ?? "—"} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

const KIND_ICON: Record<string, any> = {
  "activity.call": Phone,
  "activity.meeting": Calendar,
  "activity.message": MessageSquare,
  "activity.email": Mail,
  "activity.note": MessageSquare,
  "stage.changed": ArrowRight,
};

function TimelineTab({ entityId }: { entityId: string }) {
  const fn = useServerFn(listTimeline);
  const q = useQuery({
    queryKey: ["timeline", "opportunity", entityId],
    queryFn: () => fn({ data: { entityType: "opportunity", entityId } }),
  });
  return (
    <div className="space-y-3 py-3">
      {(q.data ?? []).map((e: any) => {
        const Icon = KIND_ICON[e.event_kind] ?? MessageSquare;
        return (
          <Card key={e.id} className="p-3 flex gap-3">
            <div className="p-2 rounded bg-muted h-fit"><Icon className="h-4 w-4" /></div>
            <div className="flex-1">
              <div className="font-medium text-sm">{e.title}</div>
              {e.description && <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{e.description}</div>}
              <div className="text-[11px] text-muted-foreground mt-1">
                {new Date(e.occurred_at).toLocaleString("ar-EG")}
              </div>
            </div>
          </Card>
        );
      })}
      {(q.data?.length ?? 0) === 0 && <div className="text-center text-muted-foreground py-8 text-sm">لا يوجد أحداث بعد</div>}
    </div>
  );
}

function ActivitiesTab({ entityId }: { entityId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listActivities);
  const create = useServerFn(createActivity);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ activityType: "note", subject: "", body: "" });

  const q = useQuery({
    queryKey: ["activities", "opportunity", entityId],
    queryFn: () => list({ data: { entityType: "opportunity", entityId } }),
  });

  const mut = useMutation({
    mutationFn: () =>
      create({
        data: {
          entityType: "opportunity",
          entityId,
          activityType: form.activityType as any,
          subject: form.subject || undefined,
          body: form.body || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("تمت الإضافة");
      setOpen(false);
      setForm({ activityType: "note", subject: "", body: "" });
      qc.invalidateQueries({ queryKey: ["activities", "opportunity", entityId] });
      qc.invalidateQueries({ queryKey: ["timeline", "opportunity", entityId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 py-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-3 w-3 ml-1" /> نشاط</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>إضافة نشاط</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>النوع</Label>
                <Select value={form.activityType} onValueChange={(v) => setForm({ ...form, activityType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">مكالمة</SelectItem>
                    <SelectItem value="meeting">اجتماع</SelectItem>
                    <SelectItem value="message">رسالة</SelectItem>
                    <SelectItem value="email">بريد</SelectItem>
                    <SelectItem value="note">ملاحظة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الموضوع</Label>
                <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div>
                <Label>التفاصيل</Label>
                <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => mut.mutate()} disabled={mut.isPending}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {(q.data ?? []).map((a: any) => (
        <Card key={a.id} className="p-3">
          <div className="flex items-center justify-between">
            <div className="font-medium text-sm">{a.subject ?? a.activity_type}</div>
            <Badge variant="outline">{a.activity_type}</Badge>
          </div>
          {a.body && <div className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{a.body}</div>}
          <div className="text-[11px] text-muted-foreground mt-2">
            {new Date(a.occurred_at).toLocaleString("ar-EG")}
          </div>
        </Card>
      ))}
      {(q.data?.length ?? 0) === 0 && <div className="text-center text-muted-foreground py-8 text-sm">لا يوجد أنشطة</div>}
    </div>
  );
}

function TasksTab({ entityId }: { entityId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listTasks);
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);

  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");

  const q = useQuery({
    queryKey: ["tasks", "opportunity", entityId],
    queryFn: () => list({ data: { entityType: "opportunity", entityId } }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          entityType: "opportunity",
          entityId,
          title,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        },
      }),
    onSuccess: () => {
      setTitle("");
      setDueAt("");
      qc.invalidateQueries({ queryKey: ["tasks", "opportunity", entityId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (t: any) =>
      update({ data: { taskId: t.id, status: t.status === "done" ? "open" : "done" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", "opportunity", entityId] }),
  });

  return (
    <div className="space-y-3 py-3">
      <Card className="p-3 flex gap-2 items-end">
        <div className="flex-1">
          <Label>عنوان المهمة</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: اتصل بالعميل" />
        </div>
        <div>
          <Label>الاستحقاق</Label>
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
        <Button disabled={!title || createMut.isPending} onClick={() => createMut.mutate()}>
          <Plus className="h-4 w-4" />
        </Button>
      </Card>
      {(q.data ?? []).map((t: any) => (
        <Card key={t.id} className="p-3 flex items-center gap-3">
          <button
            onClick={() => toggle.mutate(t)}
            className={"h-5 w-5 rounded border flex items-center justify-center " + (t.status === "done" ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/50")}
          >
            {t.status === "done" && <CheckSquare className="h-3 w-3 text-white" />}
          </button>
          <div className="flex-1">
            <div className={"font-medium text-sm " + (t.status === "done" ? "line-through text-muted-foreground" : "")}>
              {t.title}
            </div>
            {t.due_at && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                استحقاق: {new Date(t.due_at).toLocaleString("ar-EG")}
              </div>
            )}
          </div>
          <Badge variant="outline">{t.priority}</Badge>
        </Card>
      ))}
      {(q.data?.length ?? 0) === 0 && <div className="text-center text-muted-foreground py-8 text-sm">لا توجد مهام</div>}
    </div>
  );
}
