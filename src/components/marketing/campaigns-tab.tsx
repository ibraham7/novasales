import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Megaphone, Pause, Play, Plus, Trash2, XCircle } from "lucide-react";
import { deleteOutboundCampaignFn, listOutboundCampaigns } from "@/modules/marketing/outbound.functions";
import { controlCampaign } from "@/modules/campaigns";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const STATUS: Record<string, string> = { draft: "مسودة", scheduled: "مجدولة", running: "قيد الإرسال", paused: "موقوفة", completed: "مكتملة", cancelled: "ملغاة", failed: "فشلت" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-2 py-1 text-center">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Outbound campaigns: how far each is, and what came back. Sending is slow on purpose. */
export function CampaignsTab({ onNew }: { onNew: () => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listOutboundCampaigns);
  const controlFn = useServerFn(controlCampaign);
  const deleteFn = useServerFn(deleteOutboundCampaignFn);
  const q = useQuery({ queryKey: ["outbound-campaigns"], queryFn: () => listFn(), refetchInterval: 20_000 });
  const control = useMutation({
    mutationFn: (v: { id: string; action: "pause" | "resume" | "cancel" }) => controlFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outbound-campaigns"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("حُذفت الحملة");
      qc.invalidateQueries({ queryKey: ["outbound-campaigns"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">حملات Outbound المعتمدة وحالة رسائلها.</p>
        <Button onClick={onNew}>
          <Plus className="ml-1 h-4 w-4" /> حملة جديدة
        </Button>
      </div>
      {q.isPending ? (
        <p className="text-sm">جارٍ التحميل...</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : q.data.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
          <Megaphone className="h-8 w-8" />
          <p className="text-sm">لا توجد حملات بعد. اعتمد جهات من «اكتشاف العملاء» ثم أنشئ حملة.</p>
        </Card>
      ) : (
        q.data.map((c: any) => {
          const done = c.stats.sent + c.stats.delivered + c.stats.read + c.stats.failed + c.stats.skipped;
          const percent = c.stats.total ? Math.round((done / c.stats.total) * 100) : 0;
          const active = ["scheduled", "running"].includes(c.status);
          return (
            <Card key={c.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{c.name}</h3>
                <Badge variant={c.status === "running" ? "default" : "secondary"}>{STATUS[c.status] ?? c.status}</Badge>
                <span className="mr-auto text-xs text-muted-foreground">{c.approved_at ? `اعتُمدت ${formatDateTime(c.approved_at)}` : ""}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
                <Stat label="مستلمون" value={c.stats.total} />
                <Stat label="أُرسلت" value={c.stats.sent + c.stats.delivered + c.stats.read} />
                <Stat label="سُلّمت" value={c.stats.delivered + c.stats.read} />
                <Stat label="قُرئت" value={c.stats.read} />
                <Stat label="ردّوا" value={c.stats.replied} />
                <Stat label="فشلت" value={c.stats.failed} />
                <Stat label="تخطّي" value={c.stats.skipped} />
              </div>
              {c.error && <p className="text-xs text-amber-700">{c.error}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {active && (
                  <Button size="sm" variant="outline" disabled={control.isPending} onClick={() => control.mutate({ id: c.id, action: "pause" })}>
                    <Pause className="ml-1 h-3.5 w-3.5" /> إيقاف مؤقت
                  </Button>
                )}
                {c.status === "paused" && (
                  <Button size="sm" variant="outline" disabled={control.isPending} onClick={() => control.mutate({ id: c.id, action: "resume" })}>
                    <Play className="ml-1 h-3.5 w-3.5" /> استئناف
                  </Button>
                )}
                {["scheduled", "running", "paused"].includes(c.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={control.isPending}
                    onClick={async () => {
                      if (await askConfirm({ title: "إلغاء الحملة؟", description: "لن تُرسل الرسائل المتبقية. ما أُرسل لا يمكن سحبه.", confirmLabel: "إلغاء الحملة", destructive: true })) control.mutate({ id: c.id, action: "cancel" });
                    }}
                  >
                    <XCircle className="ml-1 h-3.5 w-3.5" /> إلغاء
                  </Button>
                )}
                {["draft", "completed", "cancelled", "failed"].includes(c.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={remove.isPending}
                    onClick={async () => {
                      if (await askConfirm({ title: "حذف الحملة نهائياً؟", description: "تُحذف الحملة وقائمة مستلميها وسجل ردودهم. أرقام «لا ترسل» تبقى. لا يمكن التراجع.", confirmLabel: "حذف", destructive: true })) remove.mutate(c.id);
                    }}
                  >
                    <Trash2 className="ml-1 h-3.5 w-3.5" /> حذف
                  </Button>
                )}
                <Link to="/campaigns/$id" params={{ id: c.id }} className="mr-auto text-xs text-primary hover:underline">
                  التفاصيل
                </Link>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
