import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listMessageLog } from "@/modules/workflow";
import { CHANNEL_LABELS, KIND_LABELS, MESSAGE_STATUS_LABELS } from "@/modules/workflow/labels";

const STATUSES = ["sent", "skipped", "deferred", "failed"] as const;

/** The automatic messages with their result and the reason (skipped / deferred / failed). */
export function MessageLogTab() {
  const load = useServerFn(listMessageLog);
  const [status, setStatus] = useState<(typeof STATUSES)[number] | undefined>();
  const q = useQuery({ queryKey: ["automation-message-log", status], queryFn: () => load({ data: { limit: 50, status } }) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={status ? "outline" : "default"} onClick={() => setStatus(undefined)}>الكل</Button>
        {STATUSES.map((s) => <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{MESSAGE_STATUS_LABELS[s]}</Button>)}
      </div>
      {q.isLoading && <Card className="p-6 text-center">جارِ التحميل...</Card>}
      {q.isError && <Card role="alert" className="p-6 text-center">تعذر تحميل سجل الرسائل.</Card>}
      {q.data && !q.data.installed && <Card className="p-6 text-center text-sm">شغّل ملف SQL الخاص بسجل الرسائل في Supabase أولاً.</Card>}
      {q.data?.installed && q.data.messages.length === 0 && <Card className="p-6 text-center text-muted-foreground">لا توجد رسائل تلقائية بعد.</Card>}
      {q.data?.messages.map((m: any) => (
        <Card key={m.id} className="p-3 space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={m.status === "sent" ? "default" : m.status === "failed" ? "destructive" : "secondary"}>{MESSAGE_STATUS_LABELS[m.status] ?? m.status}</Badge>
            <Badge variant="outline">{CHANNEL_LABELS[m.channel] ?? m.channel}</Badge>
            <Badge variant="outline">{KIND_LABELS[m.kind] ?? m.kind}</Badge>
            <span className="font-medium">{m.contact_name || m.to_address || "—"}</span>
            {m.workflow_name && <span className="text-xs text-muted-foreground">· {m.workflow_name}</span>}
            <span className="text-xs text-muted-foreground ms-auto">{new Date(m.created_at).toLocaleString("ar")}</span>
          </div>
          {m.reason && <div className="text-xs text-muted-foreground">السبب: {m.reason}</div>}
          {m.body && <div className="text-xs line-clamp-2">{m.body}</div>}
        </Card>
      ))}
    </div>
  );
}
