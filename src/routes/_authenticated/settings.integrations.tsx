import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Copy, KeyRound, Plug, Trash2, Webhook, RefreshCw, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listApiKeys, createApiKey, revokeApiKey, deleteApiKey,
  listWebhooks, createWebhook, updateWebhook, deleteWebhook, listAvailableEvents,
  listMarketplaceApps, installApp, uninstallApp,
} from "@/modules/integrations";

export const Route = createFileRoute("/_authenticated/settings/integrations")({
  head: () => ({
    meta: [
      { title: "التكاملات - NovaSales" },
      { name: "description", content: "إدارة مفاتيح API والـ Webhooks ومتجر التطبيقات." },
    ],
  }),
  component: IntegrationsPage,
});

const AVAILABLE_SCOPES = [
  { key: "leads:read", label: "قراءة العملاء المحتملين" },
  { key: "leads:write", label: "إنشاء/تعديل العملاء" },
  { key: "opportunities:read", label: "قراءة الفرص" },
  { key: "opportunities:write", label: "تعديل الفرص" },
  { key: "contacts:read", label: "قراءة جهات الاتصال" },
  { key: "contacts:write", label: "تعديل جهات الاتصال" },
];

function IntegrationsPage() {
  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center gap-3">
        <Plug className="h-6 w-6" />
        <h2 className="text-xl font-bold">التكاملات والمطورين</h2>
      </div>
      <Tabs defaultValue="api-keys" className="w-full">
        <TabsList>
          <TabsTrigger value="api-keys">مفاتيح API</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="marketplace">متجر التطبيقات</TabsTrigger>
          <TabsTrigger value="docs">توثيق المطورين</TabsTrigger>
        </TabsList>
        <TabsContent value="api-keys" className="mt-4"><ApiKeysTab /></TabsContent>
        <TabsContent value="webhooks" className="mt-4"><WebhooksTab /></TabsContent>
        <TabsContent value="marketplace" className="mt-4"><MarketplaceTab /></TabsContent>
        <TabsContent value="docs" className="mt-4"><DocsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ApiKeysTab() {
  const qc = useQueryClient();
  const list = useServerFn(listApiKeys);
  const create = useServerFn(createApiKey);
  const revoke = useServerFn(revokeApiKey);
  const del = useServerFn(deleteApiKey);

  const q = useQuery({ queryKey: ["api-keys"], queryFn: () => list() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["leads:read", "opportunities:read", "contacts:read"]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => create({ data: { name, scopes, expiresInDays: null } }),
    onSuccess: (row: any) => {
      setCreatedKey(row.key);
      setName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> مفاتيح API</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">استخدم هذه المفاتيح للوصول إلى REST API الخاصة بمؤسستك.</p>
        </div>
        <Button onClick={() => { setOpen(true); setCreatedKey(null); }}>+ مفتاح جديد</Button>
      </CardHeader>
      <CardContent>
        {q.data && q.data.length > 0 ? (
          <div className="space-y-2">
            {q.data.map((k: any) => (
              <div key={k.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="min-w-0">
                  <div className="font-medium">{k.name} {k.revoked_at && <Badge variant="destructive" className="mr-2">ملغى</Badge>}</div>
                  <div className="text-xs text-muted-foreground font-mono">{k.key_prefix}••••</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    الصلاحيات: {(k.scopes ?? []).join("، ") || "لا يوجد"} · آخر استخدام: {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString("ar") : "لم يُستخدم"}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!k.revoked_at && (
                    <Button variant="outline" size="sm" onClick={() => revoke({ data: { id: k.id } }).then(() => qc.invalidateQueries({ queryKey: ["api-keys"] }))}>إلغاء</Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => del({ data: { id: k.id } }).then(() => qc.invalidateQueries({ queryKey: ["api-keys"] }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">لا توجد مفاتيح بعد.</div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{createdKey ? "احفظ هذا المفتاح — لن يظهر مرة أخرى" : "إنشاء مفتاح API"}</DialogTitle>
          </DialogHeader>
          {createdKey ? (
            <div className="space-y-3">
              <div className="p-3 bg-muted rounded-lg font-mono text-sm break-all">{createdKey}</div>
              <Button className="w-full" onClick={() => { navigator.clipboard.writeText(createdKey); toast.success("تم النسخ"); }}>
                <Copy className="h-4 w-4 ml-2" /> نسخ
              </Button>
              <p className="text-xs text-muted-foreground">استخدمه في header: <code className="font-mono">Authorization: Bearer {createdKey.slice(0, 12)}...</code></p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>الاسم</Label>
                <Input required aria-label="الاسم" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: Zapier Integration" />
              </div>
              <div>
                <Label>الصلاحيات — إلزامي *</Label>
                <div data-required-group aria-label="الصلاحيات" className="grid grid-cols-2 gap-2 mt-2">
                  {AVAILABLE_SCOPES.map((s) => (
                    <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={scopes.includes(s.key)}
                        onCheckedChange={(v) => setScopes(v ? [...scopes, s.key] : scopes.filter((x) => x !== s.key))}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {createdKey ? (
              <Button onClick={() => { setOpen(false); setCreatedKey(null); }}>تم</Button>
            ) : (
              <Button validate onClick={() => createMut.mutate()} disabled={createMut.isPending}>إنشاء</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function WebhooksTab() {
  const qc = useQueryClient();
  const list = useServerFn(listWebhooks);
  const create = useServerFn(createWebhook);
  const update = useServerFn(updateWebhook);
  const del = useServerFn(deleteWebhook);
  const listEvents = useServerFn(listAvailableEvents);

  const q = useQuery({ queryKey: ["webhooks"], queryFn: () => list() });
  const eventsQ = useQuery({ queryKey: ["webhook-events"], queryFn: () => listEvents() });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);

  const createMut = useMutation({
    mutationFn: () => create({ data: { name, url, events } }),
    onSuccess: () => { setOpen(false); setName(""); setUrl(""); setEvents([]); qc.invalidateQueries({ queryKey: ["webhooks"] }); toast.success("تم إنشاء Webhook"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Webhook className="h-5 w-5" /> Webhooks الصادرة</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">أرسل الأحداث إلى أي URL خارجي (Zapier, Make, n8n...)</p>
        </div>
        <Button onClick={() => setOpen(true)}>+ Webhook جديد</Button>
      </CardHeader>
      <CardContent>
        {q.data && q.data.length > 0 ? (
          <div className="space-y-2">
            {q.data.map((w: any) => (
              <div key={w.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="font-medium flex items-center gap-2">
                    {w.name}
                    {w.is_active ? <Badge variant="default" className="text-[10px]">مفعل</Badge> : <Badge variant="secondary" className="text-[10px]">معطل</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{w.url}</div>
                  <div className="text-xs text-muted-foreground mt-1">الأحداث: {(w.events ?? []).join("، ")}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => update({ data: { id: w.id, is_active: !w.is_active } }).then(() => qc.invalidateQueries({ queryKey: ["webhooks"] }))}>
                    <Power className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => del({ data: { id: w.id } }).then(() => qc.invalidateQueries({ queryKey: ["webhooks"] }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">لا يوجد Webhooks بعد.</div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader><DialogTitle>Webhook جديد</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>الاسم</Label>
              <Input required aria-label="الاسم" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: Slack Notifier" />
            </div>
            <div>
              <Label>URL</Label>
              <Input required aria-label="رابط Webhook" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/..." />
            </div>
            <div>
              <Label>الأحداث — إلزامي *</Label>
              <div data-required-group aria-label="الأحداث" className="grid grid-cols-2 gap-2 mt-2 max-h-64 overflow-y-auto">
                {(eventsQ.data ?? []).map((ev: string) => (
                  <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={events.includes(ev)}
                      onCheckedChange={(v) => setEvents(v ? [...events, ev] : events.filter((x) => x !== ev))}
                    />
                    <code className="text-xs">{ev}</code>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button validate onClick={() => createMut.mutate()} disabled={createMut.isPending}>إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function MarketplaceTab() {
  const qc = useQueryClient();
  const list = useServerFn(listMarketplaceApps);
  const install = useServerFn(installApp);
  const uninstall = useServerFn(uninstallApp);
  const q = useQuery({ queryKey: ["marketplace-apps"], queryFn: () => list() });

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {(q.data ?? []).map((app: any) => (
        <Card key={app.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{app.name}</h3>
                  {app.is_featured && <Badge variant="default" className="text-[10px]">مميّز</Badge>}
                  {app.is_official && <Badge variant="secondary" className="text-[10px]">رسمي</Badge>}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{app.description_ar}</p>
                <div className="text-xs text-muted-foreground mt-2">
                  الفئة: {app.category} · التركيب: {app.install_type === "webhook" ? "Webhook" : "API Key"}
                </div>
              </div>
              {app.installed ? (
                <Button variant="outline" size="sm" onClick={() => uninstall({ data: { appId: app.id } }).then(() => qc.invalidateQueries({ queryKey: ["marketplace-apps"] }))}>إلغاء التثبيت</Button>
              ) : (
                <Button size="sm" onClick={() => install({ data: { appId: app.id } }).then(() => qc.invalidateQueries({ queryKey: ["marketplace-apps"] }))}>تثبيت</Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DocsTab() {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>نظرة عامة على REST API</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>الـ REST API يعتمد على HTTPS ويرجع JSON. المصادقة عبر Bearer token في header <code className="bg-muted px-1 rounded">Authorization</code>.</p>
          <div className="p-3 bg-muted rounded-lg font-mono text-xs" dir="ltr">
            GET {baseUrl}/api/v1/leads<br />
            Authorization: Bearer wsk_...
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Endpoints المتاحة</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm" dir="ltr">
          <EndpointRow method="GET" path="/api/v1/me" desc="بيانات المفتاح الحالي" scope="—" />
          <EndpointRow method="GET" path="/api/v1/leads" desc="قائمة العملاء المحتملين" scope="leads:read" />
          <EndpointRow method="POST" path="/api/v1/leads" desc="إنشاء عميل محتمل جديد" scope="leads:write" />
          <EndpointRow method="GET" path="/api/v1/opportunities" desc="قائمة الفرص" scope="opportunities:read" />
          <EndpointRow method="GET" path="/api/v1/contacts" desc="قائمة جهات الاتصال" scope="contacts:read" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>مثال: إنشاء Lead</CardTitle></CardHeader>
        <CardContent>
          <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto" dir="ltr">{`curl -X POST ${baseUrl}/api/v1/leads \\
  -H "Authorization: Bearer wsk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "contactName": "أحمد محمد",
    "phone": "+971501234567",
    "source": "landing_page"
  }'`}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Webhooks — التحقق من التوقيع</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>كل webhook يحمل header <code className="bg-muted px-1 rounded">X-NovaSales-Signature: sha256=&lt;hash&gt;</code>. تحقق منه بمقارنة HMAC-SHA256 على body مع الـ secret الخاص بالـ webhook.</p>
          <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto" dir="ltr">{`import { createHmac } from "crypto";
const sig = req.headers["x-novasales-signature"].split("=")[1];
const expected = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
if (sig !== expected) return res.status(401).end();`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

function EndpointRow({ method, path, desc, scope }: { method: string; path: string; desc: string; scope: string }) {
  const colors: Record<string, string> = { GET: "bg-blue-500", POST: "bg-green-500", PATCH: "bg-amber-500", DELETE: "bg-red-500" };
  return (
    <div className="flex items-center gap-3 p-2 border rounded">
      <span className={`text-white text-xs font-bold px-2 py-1 rounded ${colors[method] ?? "bg-gray-500"}`}>{method}</span>
      <code className="text-xs flex-1">{path}</code>
      <span className="text-xs text-muted-foreground" dir="rtl">{desc}</span>
      <code className="text-[10px] bg-muted px-1 rounded">{scope}</code>
    </div>
  );
}
