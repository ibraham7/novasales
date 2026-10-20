import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDateTime } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
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
  getPipelinePageMeta,
  moveOpportunityToStage,
} from "@/modules/crm";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StageDot, StageBadge } from "./stage-badge";
import { Mail, Phone, MapPin, User2, Building2, Tag, X, Plus, FileText, Activity, StickyNote, Upload, Download, Trash2 } from "lucide-react";
import { listFiles, createUploadUrl, registerFile, deleteFile } from "@/modules/crm/files.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
          <DetailsTab chatId={chatId} data={data} onChanged={invalidate} />
        </TabsContent>
        <TabsContent value="notes" className="mt-0">
          <NotesTab opportunityId={data.opportunity.id} onChanged={invalidate} />
        </TabsContent>
        <TabsContent value="activity" className="mt-0">
          <ActivityTab opportunityId={data.opportunity.id} />
        </TabsContent>
        <TabsContent value="files" className="mt-0">
          <FilesTab oppId={data.opportunity.id} />
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

function DetailsTab({ chatId, data, onChanged }: { chatId: string; data: Data; onChanged: () => void }) {
  const qc = useQueryClient();
  const upd = useServerFn(updateOpportunity);
  const moveToStage = useServerFn(moveOpportunityToStage);
  const fetchMeta = useServerFn(getPipelinePageMeta);
  const addTag = useServerFn(addOppTag);
  const rmTag = useServerFn(removeOppTag);

  const [tagInput, setTagInput] = useState("");

  // The organization's real pipeline stages (same cache as the pipeline board). An opportunity not
  // yet on a pipeline shows the default pipeline's stages; picking one places it there.
  const meta = useQuery({
    queryKey: ["pipeline-page-meta"],
    queryFn: () => fetchMeta(),
    staleTime: 5 * 60 * 1000,
  });
  const pipelines: any[] = meta.data?.pipelines ?? [];
  const pipeline =
    pipelines.find((p) => p.id === data.opportunity.pipeline_id) ??
    pipelines.find((p) => p.is_default) ??
    pipelines[0];
  const pipelineId = pipeline?.id ?? data.opportunity.pipeline_id;
  const stages: { id: string; name: string; color: string | null; ord: number; is_won?: boolean; is_lost?: boolean }[] = [
    ...(pipeline?.stages ?? []),
  ].sort((a, b) => a.ord - b.ord);
  // Older opportunities carry only the won/lost outcome, not a stage: show the matching stage.
  const currentStageId =
    data.opportunity.stage_id ??
    (data.opportunity.stage === "won"
      ? stages.find((s) => s.is_won)?.id
      : data.opportunity.stage === "lost"
        ? stages.find((s) => s.is_lost)?.id
        : undefined);

  // Edits show immediately and save in the background; a failed save restores the previous value.
  const cacheKey = ["opportunity-workspace", chatId];
  const saveOptimistically = async (cachePatch: Record<string, unknown>, save: () => Promise<unknown>) => {
    const previous = qc.getQueryData(cacheKey);
    qc.setQueryData(cacheKey, (old: any) =>
      old ? { ...old, opportunity: { ...old.opportunity, ...cachePatch } } : old,
    );
    try {
      await save();
      return true;
    } catch (e) {
      qc.setQueryData(cacheKey, previous);
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
      return false;
    }
  };

  const update = async (patch: Record<string, unknown>) => {
    const saved = await saveOptimistically(patch, () =>
      upd({ data: { opportunityId: data.opportunity.id, ...patch } as any }),
    );
    if (saved) void qc.invalidateQueries({ queryKey: ["chats-enriched"] });
  };

  const moveStage = async (stageId: string) => {
    const saved = await saveOptimistically({ stage_id: stageId, pipeline_id: pipelineId }, () =>
      moveToStage({ data: { opportunityId: data.opportunity.id, stageId } }),
    );
    if (saved) {
      void qc.invalidateQueries({ queryKey: ["pipeline-board"] });
      void qc.invalidateQueries({ queryKey: ["chats-enriched"] });
      void qc.invalidateQueries({ queryKey: ["opp-activity", data.opportunity.id] });
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
          {pipelineId || meta.isPending ? (
            <Select
              value={currentStageId ?? undefined}
              onValueChange={(v) => void moveStage(v)}
              disabled={meta.isPending}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder={meta.isPending ? "جارٍ التحميل..." : "اختر المرحلة"} />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color ?? "#94a3b8" }} />
                      <span>{s.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
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
          )}
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
            {formatDateTime(data.opportunity.opened_at)}
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
                <span>{formatDateTime(n.created_at)}</span>
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
              <div className="text-[11px] text-muted-foreground">{formatDateTime(e.created_at)}</div>
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

/* Same upload flow as the opportunity page: the browser uploads straight to private storage through
 * a one-time signed URL, then the server records the file. */
function FilesTab({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const doList = useServerFn(listFiles);
  const doUploadUrl = useServerFn(createUploadUrl);
  const doRegister = useServerFn(registerFile);
  const doDelete = useServerFn(deleteFile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<any | null>(null);

  const filesQ = useQuery({
    queryKey: ["opp-files", oppId],
    queryFn: () => doList({ data: { entityType: "opportunity", entityId: oppId } }),
  });

  async function handleUpload(files: File[]) {
    setUploading(true);
    try {
      for (const file of files) {
        const up: any = await doUploadUrl({
          data: { entityType: "opportunity", entityId: oppId, fileName: file.name },
        });
        if (!up?.path || !up?.token) throw new Error("فشل تجهيز رابط الرفع");
        const { error: upErr } = await supabase.storage
          .from("crm-files")
          .uploadToSignedUrl(up.path, up.token, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
        if (upErr) throw new Error(upErr.message || "فشل رفع الملف");
        await doRegister({
          data: {
            entityType: "opportunity",
            entityId: oppId,
            storagePath: up.path,
            fileName: file.name,
            mimeType: file.type || undefined,
            sizeBytes: file.size,
          },
        });
      }
      toast.success(files.length > 1 ? `تم رفع ${files.length} ملفات` : "تم رفع الملف");
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الرفع");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["opp-files", oppId] });
    }
  }

  const delMut = useMutation({
    mutationFn: (fileId: string) => doDelete({ data: { fileId } }),
    onSuccess: () => {
      toast.success("تم حذف الملف");
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ["opp-files", oppId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل الحذف"),
  });

  const files: any[] = filesQ.data ?? [];

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length) void handleUpload(picked);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-4 w-4 ml-1" />
        {uploading ? "جارٍ الرفع..." : "رفع ملف"}
      </Button>

      {filesQ.isLoading ? (
        <div className="text-xs text-muted-foreground text-center py-6">جارٍ التحميل...</div>
      ) : files.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-xs text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
          لا توجد ملفات لهذه الفرصة بعد.
        </div>
      ) : (
        <div className="space-y-1.5">
          {files.map((f) => {
            const isImage = (f.mime_type ?? "").startsWith("image/");
            return (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 text-xs">
                {isImage && f.signed_url ? (
                  <img src={f.signed_url} alt={f.file_name} className="h-10 w-10 rounded object-cover shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded bg-background border flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{f.file_name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {f.size_bytes ? `${Math.max(1, Math.round(f.size_bytes / 1024))} KB · ` : ""}
                    {formatDateTime(f.created_at)}
                  </div>
                </div>
                {f.signed_url && (
                  <a
                    href={f.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 hover:bg-background rounded"
                    title="فتح / تنزيل"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setRemoving(f)}
                  className="p-1.5 hover:bg-background rounded text-destructive"
                  title="حذف"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && !delMut.isPending && setRemoving(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الملف؟</AlertDialogTitle>
            <AlertDialogDescription>سيُحذف «{removing?.file_name}» نهائياً من ملفات الفرصة.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delMut.isPending}>تراجع</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={delMut.isPending}
              onClick={() => removing && delMut.mutate(removing.id)}
            >
              {delMut.isPending ? "جارٍ الحذف..." : "حذف"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
