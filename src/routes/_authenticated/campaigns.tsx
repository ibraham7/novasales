import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Megaphone, Plus, Play, Pause, XCircle, Trash2, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listCampaigns, launchCampaign, controlCampaign, deleteCampaign } from "@/modules/campaigns";

export const Route = createFileRoute("/_authenticated/campaigns")({
  head: () => ({
    meta: [
      { title: "الحملات - NovaSales" },
      { name: "description", content: "إدارة وإطلاق حملات البث على واتساب." },
    ],
  }),
  component: CampaignsPage,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة", scheduled: "مجدولة", running: "قيد التشغيل", paused: "متوقفة", completed: "منتهية", cancelled: "ملغاة", failed: "فشلت",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-500", scheduled: "bg-amber-500", running: "bg-blue-500",
  paused: "bg-orange-500", completed: "bg-emerald-500", cancelled: "bg-slate-400", failed: "bg-red-500",
};

function CampaignsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const list = useServerFn(listCampaigns);
  const launch = useServerFn(launchCampaign);
  const control = useServerFn(controlCampaign);
  const del = useServerFn(deleteCampaign);
  const q = useQuery({ queryKey: ["campaigns"], queryFn: () => list(), refetchInterval: 10000 });

  const launchMut = useMutation({
    mutationFn: (id: string) => launch({ data: { id, sendNow: true } }),
    onSuccess: () => { toast.success("تم الإطلاق"); qc.invalidateQueries({ queryKey: ["campaigns"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const ctlMut = useMutation({
    mutationFn: (v: { id: string; action: "pause" | "resume" | "cancel" }) => control({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["campaigns"] }); },
  });

  return (
    <div className="p-8 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">الحملات</h1>
            <p className="text-sm text-muted-foreground">بث رسائل واتساب لجمهور محدد.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/campaigns/templates"><Button variant="outline"><FileText className="h-4 w-4 ml-1" /> القوالب</Button></Link>
          <Button onClick={() => nav({ to: "/campaigns/new" })}><Plus className="h-4 w-4 ml-1" /> حملة جديدة</Button>
        </div>
      </div>

      <div className="grid gap-3">
        {(q.data?.campaigns ?? []).map((c: any) => {
          const s = c.stats ?? {};
          return (
            <Card key={c.id} className="p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Link to="/campaigns/$id" params={{ id: c.id }} className="font-semibold hover:underline">{c.name}</Link>
                    <Badge className={STATUS_COLOR[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    <span className="text-xs text-muted-foreground">إيقاع: {c.throttle_per_minute}/دقيقة</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                    <span>الإجمالي: {s.total ?? 0}</span>
                    <span>مُرسل: {s.sent ?? 0}</span>
                    <span>مُسلّم: {s.delivered ?? 0}</span>
                    <span>مقروء: {s.read ?? 0}</span>
                    <span className="text-red-500">فاشل: {s.failed ?? 0}</span>
                  </div>
                </div>
                {c.status === "draft" && <Button size="sm" onClick={() => launchMut.mutate(c.id)}><Play className="h-3 w-3 ml-1" /> إطلاق</Button>}
                {c.status === "running" && <Button size="sm" variant="outline" onClick={() => ctlMut.mutate({ id: c.id, action: "pause" })}><Pause className="h-3 w-3 ml-1" /> إيقاف مؤقت</Button>}
                {c.status === "paused" && <Button size="sm" onClick={() => ctlMut.mutate({ id: c.id, action: "resume" })}><Play className="h-3 w-3 ml-1" /> استئناف</Button>}
                {(c.status === "running" || c.status === "paused" || c.status === "scheduled") && <Button size="sm" variant="ghost" onClick={() => ctlMut.mutate({ id: c.id, action: "cancel" })}><XCircle className="h-3 w-3" /></Button>}
                <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف؟")) delMut.mutate(c.id); }}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </Card>
          );
        })}
        {q.data && q.data.campaigns.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">لا توجد حملات بعد.</Card>
        )}
      </div>
    </div>
  );
}
