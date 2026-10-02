import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "@/lib/toast";
import {
  getOpportunityByChat,
  updateOpportunity,
  listOppNotes,
  addOppNote,
  listOppActivity,
  addOppTag,
  removeOppTag,
  OPP_STAGES,
  STAGE_LABEL_AR,
} from "@/modules/crm";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StageDot, StageBadge } from "./stage-badge";
import { Mail, Phone, MapPin, User2, Building2, Tag, X, Plus, FileText, Activity, StickyNote } from "lucide-react";

type Data = NonNullable<Awaited<ReturnType<typeof getOpportunityByChat>>>;

export function OpportunityPanel({ chatId, data }: { chatId: string; data: Data }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["opportunity-workspace", chatId] });
    qc.invalidateQueries({ queryKey: ["opp-notes", data.opportunity.id] });
    qc.invalidateQueries({ queryKey: ["opp-activity", data.opportunity.id] });
    qc.invalidateQueries({ queryKey: ["chats-enriched"] });
  };

  return (
    <Tabs defaultValue="details" className="h-full flex flex-col">
      <div className="px-3 pt-3">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="details" className="gap-1.5"><User2 className="h-3.5 w-3.5" /> التفاصيل</TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5"><StickyNote className="h-3.5 w-3.5" /> ملاحظات</TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> النشاط</TabsTrigger>
          <TabsTrigger value="files" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> ملفات</TabsTrigger>
        </TabsList>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <TabsContent value="details" className="mt-0 space-y-4">
          <DetailsTab data={data} onChanged={invalidate} />
        </TabsContent>
        <TabsContent value="notes" className="mt-0">
          <NotesTab opportunityId={data.opportunity.id} onChanged={invalidate} />
        </TabsContent>
        <TabsContent value="activity" className="mt-0">
          <ActivityTab opportunityId={data.opportunity.id} />
        </TabsContent>
        <TabsContent value="files" className="mt-0">
          <FilesTab />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</div>
      <div className="rounded-xl border bg-card divide-y">{children}</div>
    </section>
  );
}

function Row({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5 flex items-start gap-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground w-24 shrink-0 pt-1.5">
        {icon}
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function DetailsTab({ data, onChanged }: { data: Data; onChanged: () => void }) {
  const upd = useServerFn(updateOpportunity);
  const addTag = useServerFn(addOppTag);
  const rmTag = useServerFn(removeOppTag);

  const [tagInput, setTagInput] = useState("");

  const update = async (patch: Record<string, unknown>) => {
    try {
      await upd({ data: { opportunityId: data.opportunity.id, ...patch } as any });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ");
    }
  };

  const PRIORITY_LABEL: Record<number, string> = { 0: "عادية", 1: "متوسطة", 2: "عالية", 3: "عاجلة" };

  return (
    <div className="space-y-4">
      <Section title="جهة الاتصال">
        <Row icon={<User2 className="h-3.5 w-3.5" />} label="الاسم">
          <div className="text-sm font-medium">{data.contact?.name ?? "—"}</div>
        </Row>
        <Row icon={<Phone className="h-3.5 w-3.5" />} label="الهاتف">
          <div className="text-sm font-mono" dir="ltr">+{data.contact?.phone ?? "—"}</div>
        </Row>
        <Row icon={<Mail className="h-3.5 w-3.5" />} label="الإيميل">
          <div className="text-sm text-muted-foreground">{data.contact?.email ?? "—"}</div>
        </Row>
        <Row icon={<MapPin className="h-3.5 w-3.5" />} label="الدولة">
          <div className="text-sm">{data.contact?.country ?? data.contact?.city ?? "—"}</div>
        </Row>
      </Section>

      <Section title="الفرصة">
        <Row label="المرحلة">
          <Select value={data.opportunity.stage} onValueChange={(v) => update({ stage: v })}>
            <SelectTrigger className="h-8">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <StageDot stage={data.opportunity.stage} />
                  <span>{STAGE_LABEL_AR[data.opportunity.stage]}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OPP_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  <div className="flex items-center gap-2">
                    <StageDot stage={s} />
                    <span>{STAGE_LABEL_AR[s]}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row icon={<User2 className="h-3.5 w-3.5" />} label="المندوب">
          <div className="text-sm">{data.owner?.name ?? "غير موزّع"}</div>
        </Row>
        <Row icon={<Building2 className="h-3.5 w-3.5" />} label="القسم">
          <div className="text-sm">{data.department?.name ?? "—"}</div>
        </Row>
        <Row label="المصدر">
          <Input
            className="h-8"
            defaultValue={data.opportunity.source ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== (data.opportunity.source ?? null)) update({ source: v });
            }}
            placeholder="مثال: Meta Ads"
          />
        </Row>
        <Row label="المنتج">
          <Input
            className="h-8"
            defaultValue={data.opportunity.product_interest ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== (data.opportunity.product_interest ?? null)) update({ product_interest: v });
            }}
            placeholder="—"
          />
        </Row>
        <Row label="الأولوية">
          <Select value={String(data.opportunity.priority)} onValueChange={(v) => update({ priority: Number(v) })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3].map((p) => (
                <SelectItem key={p} value={String(p)}>{PRIORITY_LABEL[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="التاريخ">
          <div className="text-sm text-muted-foreground">
            {new Date(data.opportunity.opened_at).toLocaleString("ar")}
          </div>
        </Row>
      </Section>

      <Section title="الوسوم">
        <div className="p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5 min-h-6">
            {data.tags.length === 0 ? (
              <div className="text-xs text-muted-foreground">لا توجد وسوم بعد</div>
            ) : (
              data.tags.map((t: { id: string; name: string; color: string | null }) => (
                <Badge key={t.id} variant="secondary" className="gap-1 pl-1">
                  <Tag className="h-3 w-3" />
                  {t.name}
                  <button
                    onClick={async () => {
                      try {
                        await rmTag({ data: { opportunityId: data.opportunity.id, tagId: t.id } });
                        onChanged();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "خطأ");
                      }
                    }}
                    className="hover:bg-background/50 rounded p-0.5"
                    aria-label="إزالة"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!tagInput.trim()) return;
              try {
                await addTag({ data: { opportunityId: data.opportunity.id, name: tagInput.trim() } });
                setTagInput("");
                onChanged();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "خطأ");
              }
            }}
          >
            <Input
              className="h-8"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="أضف وسماً..."
            />
            <Button type="submit" size="sm" variant="secondary" className="h-8">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </form>
        </div>
      </Section>
    </div>
  );
}

function NotesTab({ opportunityId, onChanged }: { opportunityId: string; onChanged: () => void }) {
  const list = useServerFn(listOppNotes);
  const add = useServerFn(addOppNote);
  const q = useQuery({
    queryKey: ["opp-notes", opportunityId],
    queryFn: () => list({ data: { opportunityId } }),
  });
  const [body, setBody] = useState("");
  const mut = useMutation({
    mutationFn: () => add({ data: { opportunityId, body } }),
    onSuccess: () => {
      setBody("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) mut.mutate();
        }}
        className="space-y-2 rounded-xl border bg-card p-3"
      >
        <Textarea
          required aria-label="الملاحظة"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="أضف ملاحظة للفريق..."
          className="resize-none"
        />
        <div className="flex justify-end">
          <Button validate size="sm" type="submit" disabled={mut.isPending}>
            إضافة
          </Button>
        </div>
      </form>
      <div className="space-y-2">
        {(q.data ?? []).length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">لا توجد ملاحظات بعد</div>
        ) : (
          q.data!.map((n: { id: string; body: string; author_name: string | null; created_at: string }) => (
            <div key={n.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>{n.author_name ?? "مستخدم"}</span>
                <span>{new Date(n.created_at).toLocaleString("ar")}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{n.body}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  "crm.opportunity.assigned": "تم توزيع الفرصة",
  "crm.opportunity.stage_changed": "تغيير المرحلة",
  "crm.opportunity.created": "فرصة جديدة",
};

function ActivityTab({ opportunityId }: { opportunityId: string }) {
  const list = useServerFn(listOppActivity);
  const q = useQuery({
    queryKey: ["opp-activity", opportunityId],
    queryFn: () => list({ data: { opportunityId } }),
  });
  return (
    <div className="space-y-2">
      {(q.data ?? []).length === 0 ? (
        <div className="text-center text-xs text-muted-foreground py-8">لا يوجد نشاط بعد</div>
      ) : (
        (q.data ?? []).map((e: any) => (
          <div key={e.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-medium">{EVENT_LABEL[e.event_type] ?? e.event_type}</div>
              <div className="text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString("ar")}</div>
            </div>
            {e.payload && Object.keys(e.payload).length ? (
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {e.event_type === "crm.opportunity.stage_changed" && e.payload.stage ? (
                  <StageBadge stage={e.payload.stage} />
                ) : (
                  JSON.stringify(e.payload)
                )}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function FilesTab() {
  return (
    <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-xs text-muted-foreground">
      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
      رفع الملفات سيتوفر قريباً.
    </div>
  );
}
