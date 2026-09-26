import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getCampaign } from "@/modules/campaigns";

export const Route = createFileRoute("/_authenticated/campaigns/$id")({
  head: () => ({ meta: [{ title: "تفاصيل الحملة - NovaSales" }] }),
  component: DetailPage,
});

const STATUS_COLOR: Record<string, string> = {
  queued: "bg-slate-500", sending: "bg-blue-500", sent: "bg-blue-500",
  delivered: "bg-emerald-500", read: "bg-emerald-600", failed: "bg-red-500", skipped: "bg-slate-400",
};

function DetailPage() {
  const { id } = Route.useParams();
  const get = useServerFn(getCampaign);
  const q = useQuery({ queryKey: ["campaign", id], queryFn: () => get({ data: { id } }), refetchInterval: 5000 });
  const [filter, setFilter] = useState("");

  const c = q.data?.campaign;
  const s = c?.stats ?? {};
  const recipients = (q.data?.recipients ?? []).filter((r: any) =>
    !filter || r.phone.includes(filter) || (r.variables?.name ?? "").includes(filter)
  );

  return (
    <div className="p-8 space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <Link to="/campaigns"><Button size="sm" variant="ghost"><ArrowRight className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-bold">{c?.name ?? "..."}</h1>
        {c && <Badge>{c.status}</Badge>}
      </div>

      <div className="grid grid-cols-6 gap-3">
        {[
          { l: "الإجمالي", v: s.total ?? 0 },
          { l: "في الطابور", v: s.queued ?? 0 },
          { l: "مُرسل", v: s.sent ?? 0 },
          { l: "مُسلّم", v: s.delivered ?? 0 },
          { l: "مقروء", v: s.read ?? 0 },
          { l: "فاشل", v: s.failed ?? 0 },
        ].map((k) => (
          <Card key={k.l} className="p-4">
            <div className="text-xs text-muted-foreground">{k.l}</div>
            <div className="text-2xl font-bold mt-1">{k.v}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">المستلمون</h2>
          <Input placeholder="بحث..." value={filter} onChange={(e) => setFilter(e.target.value)} className="w-64" />
        </div>
        <div className="space-y-1 max-h-[500px] overflow-auto">
          {recipients.map((r: any) => (
            <div key={r.id} className="flex items-center gap-3 py-2 border-b last:border-0">
              <Badge className={STATUS_COLOR[r.status]}>{r.status}</Badge>
              <span className="font-mono text-sm">{r.phone}</span>
              <span className="text-sm text-muted-foreground">{r.variables?.name ?? ""}</span>
              {r.error && <span className="text-xs text-red-500 mr-auto">{r.error}</span>}
              {r.sent_at && <span className="text-xs text-muted-foreground mr-auto">{new Date(r.sent_at).toLocaleString()}</span>}
            </div>
          ))}
          {recipients.length === 0 && <div className="text-center text-muted-foreground py-8">لا مستلمون بعد.</div>}
        </div>
      </Card>
    </div>
  );
}
