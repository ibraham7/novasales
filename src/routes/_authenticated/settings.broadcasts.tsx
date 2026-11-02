import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, Loader2, Megaphone, Send } from "lucide-react";
import { getBroadcastOptions, getPushStatus, listBroadcasts, sendBroadcast } from "@/modules/notifications/notifications.functions";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/settings/broadcasts")({
  head: () => ({ meta: [{ title: "إرسال إشعارات - NovaSales" }] }),
  component: BroadcastsPage,
});

const PAGES: [string, string][] = [
  ["/", "الصفحة الرئيسية"],
  ["/leads", "العملاء المحتملون"],
  ["/pipeline", "قمع المبيعات"],
  ["/sales", "المبيعات والطلبات"],
  ["/inbox", "صندوق الوارد"],
  ["/campaigns", "الحملات"],
];

type Kind = "all" | "departments" | "users";
const KINDS: [Kind, string][] = [
  ["all", "جميع الموظفين"],
  ["departments", "قسم محدد"],
  ["users", "موظفون محددون"],
];

function BroadcastsPage() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getPushStatus);
  const optionsFn = useServerFn(getBroadcastOptions);
  const listFn = useServerFn(listBroadcasts);
  const sendFn = useServerFn(sendBroadcast);

  const status = useQuery({ queryKey: ["push-status"], queryFn: () => statusFn(), staleTime: 60_000 });
  const options = useQuery({ queryKey: ["broadcast-options"], queryFn: () => optionsFn() });
  const history = useQuery({ queryKey: ["broadcast-history"], queryFn: () => listFn(), refetchInterval: 30_000 });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [kind, setKind] = useState<Kind>("all");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const users = useMemo(() => (options.data?.users ?? []).filter((u) => !search.trim() || u.name.includes(search.trim())), [options.data, search]);

  const audience =
    kind === "all" ? ({ kind: "all" } as const) : kind === "departments" ? ({ kind: "departments", departmentIds } as const) : ({ kind: "users", userIds } as const);
  const audienceReady = kind === "all" || (kind === "departments" ? departmentIds.length > 0 : userIds.length > 0);
  const urlOk = url.trim() === "" || (url.trim().startsWith("/") && !url.trim().startsWith("//"));

  const send = useMutation({
    mutationFn: () => sendFn({ data: { title: title.trim(), body: body.trim(), url: url.trim() || "/", audience } }),
    onSuccess: (r) => {
      toast.success(
        r.accepted
          ? `قُبل الإشعار لدى خدمة الإشعارات لـ ${r.accepted} من ${r.recipients}${r.noDevice ? `، و${r.noDevice} بلا جهاز مفعّل` : ""}`
          : `لم يصل الإشعار لأي جهاز${r.noDevice ? ` (${r.noDevice} بلا جهاز مفعّل)` : ""}`,
      );
      setTitle("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canSend = title.trim() && body.trim() && urlOk && audienceReady && !send.isPending && status.data?.configured;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">إرسال إشعارات</h2>
        <p className="mt-2 text-sm text-muted-foreground">أرسل تنبيهاً إلى أجهزة الموظفين الذين فعّلوا الإشعارات.</p>
      </div>

      {status.isSuccess && !status.data.configured && (
        <Alert variant="destructive">
          <AlertTitle>الإشعارات غير مُعدّة على الخادم</AlertTitle>
          <AlertDescription>أضف مفاتيح VAPID إلى إعدادات الخادم ثم أعد تشغيله قبل الإرسال.</AlertDescription>
        </Alert>
      )}

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="space-y-1">
          <Label htmlFor="bc-title">عنوان الإشعار</Label>
          <Input id="bc-title" maxLength={120} placeholder="مثال: اجتماع الفريق" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bc-body">المحتوى</Label>
          <Textarea id="bc-body" rows={3} maxLength={500} placeholder="نص الإشعار" value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="text-xs text-muted-foreground">{body.length}/500 · الأفضل أن يكون قصيراً لأنه يظهر على شاشة القفل.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bc-url">الصفحة التي تُفتح عند الضغط</Label>
          <div className="flex flex-wrap gap-1.5">
            {PAGES.map(([path, label]) => (
              <button
                key={path}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${url === path ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}
                onClick={() => setUrl(path)}
              >
                {label}
              </button>
            ))}
          </div>
          <Input id="bc-url" dir="ltr" placeholder="/leads" value={url} onChange={(e) => setUrl(e.target.value)} />
          {!urlOk && <p className="text-xs text-destructive">اكتب مساراً داخل الموقع يبدأ بـ / فقط.</p>}
        </div>

        <div className="space-y-2">
          <Label>المستلمون</Label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="المستلمون">
            {KINDS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                className={`rounded-lg border p-2 text-sm font-medium ${kind === value ? "border-primary bg-primary/5 text-primary" : "hover:bg-accent"}`}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {options.data && (
            <p className="text-xs text-muted-foreground">
              {options.data.totalMembers} موظف في المؤسسة، منهم {options.data.devicesCount} فعّل الإشعارات على جهاز واحد على الأقل.
            </p>
          )}
          {kind === "departments" && (
            <div className="space-y-1 rounded-lg border p-3">
              {(options.data?.departments ?? []).map((d: any) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={departmentIds.includes(d.id)} onCheckedChange={() => toggle(departmentIds, setDepartmentIds, d.id)} />
                  {d.name}
                </label>
              ))}
              {options.data?.departments.length === 0 && <p className="text-sm text-muted-foreground">لا توجد أقسام.</p>}
            </div>
          )}
          {kind === "users" && (
            <div className="space-y-2 rounded-lg border p-3">
              <Input placeholder="ابحث بالاسم" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={userIds.includes(u.id)} onCheckedChange={() => toggle(userIds, setUserIds, u.id)} />
                    <span className="flex-1">{u.name}</span>
                    {!u.hasDevice && <span className="text-xs text-muted-foreground">بلا جهاز مفعّل</span>}
                  </label>
                ))}
              </div>
              {userIds.length > 0 && <p className="text-xs">{userIds.length} محدد</p>}
            </div>
          )}
        </div>

        <Button
          disabled={!canSend}
          onClick={async () => {
            if (await askConfirm({ title: "إرسال الإشعار؟", description: `«${title.trim()}» إلى ${KINDS.find(([k]) => k === kind)?.[1]}. لا يمكن التراجع بعد الإرسال.`, confirmLabel: "إرسال" })) send.mutate();
          }}
        >
          {send.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Send className="ml-1 h-4 w-4" />}
          {send.isPending ? "جارٍ الإرسال..." : "إرسال الإشعار"}
        </Button>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">سجل الإشعارات المرسلة</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          «قُبل» يعني أن خدمة الإشعارات استلمت الرسالة، وهذا لا يضمن ظهورها. «ظهر» و«نُقر» يصلان من الجهاز نفسه ويُحدَّثان تلقائياً.
        </p>
        {history.isPending ? (
          <p className="text-sm">جارٍ التحميل...</p>
        ) : history.isError ? (
          <p className="text-sm text-destructive">{(history.error as Error).message}</p>
        ) : history.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">لم يُرسل أي إشعار بعد.</p>
        ) : (
          history.data.map((b: any) => (
            <div key={b.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{b.title}</div>
                  <p className="text-sm text-muted-foreground">{b.body}</p>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(b.created_at)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="secondary">{b.recipients_count} مستلم</Badge>
                <Badge variant="secondary">قُبل: {b.stats.accepted}</Badge>
                <Badge variant="secondary" className="gap-1">
                  <CheckCheck className="h-3 w-3" /> ظهر: {b.stats.shown}
                </Badge>
                <Badge variant="secondary">نُقر: {b.stats.clicked}</Badge>
                {b.stats.noDevice > 0 && <Badge variant="outline">بلا جهاز: {b.stats.noDevice}</Badge>}
                {b.stats.failed > 0 && <Badge variant="destructive">فشل: {b.stats.failed}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {b.created_by_name ? `بواسطة ${b.created_by_name} · ` : ""}
                يفتح: <bdi dir="ltr">{b.url}</bdi>
              </p>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
