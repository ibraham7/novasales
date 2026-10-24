import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Clock, Facebook, Ghost, Instagram, KeyRound, Linkedin, Loader2, Music2, Send, ShieldCheck, Trash2, Youtube } from "lucide-react";
import {
  deliverConversionsNow,
  finishMetaSocialLink,
  getSocialConnections,
  removeSocialPixel,
  saveSocialPixel,
  sendMetaTestEvent,
  startMetaSocialLink,
} from "@/modules/integrations/social-connections.functions";
import { DELIVERING_PLATFORMS, SOCIAL_PLATFORMS, SOCIAL_PLATFORM_KEYS, type SocialPlatform } from "@/modules/integrations/social-platforms";
import { loadFbSdk } from "@/modules/channels/components/CoexistenceLink";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/settings/social")({
  head: () => ({ meta: [{ title: "ربط وسائل التواصل - NovaSales" }] }),
  component: SocialConnectionsPage,
});

type Connection = {
  platform: SocialPlatform;
  pixel_id: string;
  has_token: boolean;
  test_event_code: string | null;
  connected_via: "manual" | "oauth";
  connected_at: string;
};

/** Full connections through each platform's own login window. Only Meta is wired; the rest wait for platform approval. */
const LOGIN_PLATFORMS = [
  { key: "meta", label: "الربط بواسطة ميتا (فيسبوك + إنستغرام)" },
  { key: "tiktok", label: "الربط بواسطة تيك توك" },
  { key: "snapchat", label: "الربط بواسطة سناب شات" },
  { key: "x", label: "الربط بواسطة تويتر (X)" },
  { key: "linkedin", label: "الربط بواسطة لينكد إن" },
] as const;

const LOGO_STYLE: Record<string, { background: string; color: string }> = {
  facebook: { background: "#1877F2", color: "#fff" },
  meta: { background: "#1877F2", color: "#fff" },
  instagram: { background: "linear-gradient(45deg,#f9ce34,#ee2a7b 55%,#6228d7)", color: "#fff" },
  tiktok: { background: "#010101", color: "#fff" },
  snapchat: { background: "#FFFC00", color: "#111" },
  x: { background: "#000", color: "#fff" },
  linkedin: { background: "#0A66C2", color: "#fff" },
  google: { background: "#FF0000", color: "#fff" },
};

/** The platform's mark on its own color. */
function PlatformLogo({ platform, className = "h-9 w-9" }: { platform: string; className?: string }) {
  const icon = "h-[55%] w-[55%]";
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-lg ${className}`} style={LOGO_STYLE[platform]}>
      {platform === "facebook" || platform === "meta" ? (
        <Facebook className={icon} />
      ) : platform === "instagram" ? (
        <Instagram className={icon} />
      ) : platform === "tiktok" ? (
        <Music2 className={icon} />
      ) : platform === "snapchat" ? (
        <Ghost className={icon} />
      ) : platform === "linkedin" ? (
        <Linkedin className={icon} />
      ) : platform === "google" ? (
        <Youtube className={icon} />
      ) : (
        <svg viewBox="0 0 24 24" className={icon} fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )}
    </span>
  );
}

function SocialConnectionsPage() {
  const fetchFn = useServerFn(getSocialConnections);
  const q = useQuery({ queryKey: ["social-connections"], queryFn: () => fetchFn() });
  const connections = (q.data?.connections ?? []) as Connection[];
  const byPlatform = (platform: SocialPlatform) => connections.find((c) => c.platform === platform);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">ربط وسائل التواصل</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          كل ما يُربط هنا خاص بمؤسستك فقط: البكسل يستقبل نتائج مراحل قمع مبيعاتك أنت، ولا يصل لأي مؤسسة أخرى.
        </p>
      </div>

      <Card className="space-y-3 p-4">
        <div>
          <h3 className="font-semibold">الربط المباشر</h3>
          <p className="text-xs text-muted-foreground">
            تسجيل دخول من نافذة المنصة نفسها، يجلب البكسل تلقائيًا. مستقبلًا يُستخدم أيضًا للنشر والجدولة وقراءة الرسائل.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {LOGIN_PLATFORMS.map((p) =>
            p.key === "meta" ? (
              <MetaLoginButton key={p.key} label={p.label} setup={q.data?.metaLogin} />
            ) : (
              <div key={p.key} className="flex items-center gap-3 rounded-lg border p-3 opacity-70">
                <PlatformLogo platform={p.key} />
                <span className="flex-1 text-sm font-medium">{p.label}</span>
                <Badge variant="secondary">بانتظار موافقة المنصة</Badge>
              </div>
            ),
          )}
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h3 className="font-semibold">الربط اليدوي (Pixel / ID)</h3>
          <p className="text-xs text-muted-foreground">
            لمن لا يريد مشاركة تسجيل الدخول: أدخل معرّف البكسل لكل منصة. يُستخدم لإرجاع نتائج العملاء القادمين من الإعلانات إلى المنصة.
          </p>
        </div>
        {q.isPending ? (
          <p className="text-sm">جارٍ التحميل...</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (
          <div className="space-y-3">
            {SOCIAL_PLATFORM_KEYS.map((platform) => (
              <PixelRow key={platform} platform={platform} connection={byPlatform(platform)} />
            ))}
          </div>
        )}
      </Card>

      {q.data && byPlatform("facebook")?.has_token && <MetaDelivery delivery={q.data.delivery} />}
    </div>
  );
}

function PixelRow({ platform, connection }: { platform: SocialPlatform; connection?: Connection }) {
  const qc = useQueryClient();
  const spec = SOCIAL_PLATFORMS[platform];
  const isMeta = platform === "facebook";
  const saveFn = useServerFn(saveSocialPixel);
  const removeFn = useServerFn(removeSocialPixel);
  const [pixelId, setPixelId] = useState(connection?.pixel_id ?? "");
  const [token, setToken] = useState("");
  const [testCode, setTestCode] = useState(connection?.test_event_code ?? "");
  useEffect(() => {
    setPixelId(connection?.pixel_id ?? "");
    setTestCode(connection?.test_event_code ?? "");
  }, [connection?.pixel_id, connection?.test_event_code]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["social-connections"] });

  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { platform, pixelId, ...(isMeta ? { accessToken: token || undefined, testEventCode: testCode } : {}) } }),
    onSuccess: (r) => {
      setToken("");
      toast.success(
        r.pixelName
          ? `تم الربط بالبكسل «${r.pixelName}»`
          : r.verified
            ? "تم الحفظ"
            : "تم الحفظ. لم تسمح Meta بقراءة البكسل بهذا الرمز، فتأكد منه بـ «إرسال حدث تجريبي»",
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => removeFn({ data: { platform } }),
    onSuccess: () => {
      toast.success("تم إلغاء الربط");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const changed = pixelId.trim() !== (connection?.pixel_id ?? "") || !!token.trim() || (isMeta && testCode.trim() !== (connection?.test_event_code ?? ""));

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformLogo platform={platform} className="h-8 w-8" />
        <span className="flex-1 text-sm font-semibold">{spec.label}</span>
        {connection ? (
          isMeta && !connection.has_token ? (
            <Badge variant="secondary">محفوظ — بدون رمز إرسال</Badge>
          ) : (
            <Badge className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> مربوط{connection.connected_via === "oauth" ? " عبر ميتا" : ""}
            </Badge>
          )
        ) : (
          <Badge variant="outline">غير مربوط</Badge>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input dir="ltr" name={`pixel-${platform}`} autoComplete="off" data-lpignore="true" data-1p-ignore aria-label={`${spec.idLabel} ${spec.label}`} placeholder={`${spec.idLabel} — ${spec.example}`} value={pixelId} onChange={(e) => setPixelId(e.target.value)} />
        <div className="flex gap-2">
          <Button type="button" disabled={!pixelId.trim() || !changed || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
          </Button>
          {connection && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`إلغاء ربط ${spec.label}`}
              disabled={remove.isPending}
              onClick={async () => {
                if (await askConfirm({ title: `إلغاء ربط ${spec.label}؟`, description: "تتوقف إرسال النتائج لهذا البكسل.", confirmLabel: "إلغاء الربط", destructive: true }))
                  remove.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {isMeta && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="flex items-center gap-1 text-xs">
              <KeyRound className="h-3 w-3" /> رمز Conversions API (Access Token)
            </Label>
            <Input
              // Not type=password: browsers would fill saved logins into it. The dots come from CSS.
              type="text"
              name="meta-capi-token"
              style={{ WebkitTextSecurity: "disc" } as CSSProperties}
              data-lpignore="true"
              data-1p-ignore
              spellCheck={false}
              dir="ltr"
              autoComplete="off"
              placeholder={connection?.has_token ? "محفوظ ومشفّر — اتركه فارغًا للإبقاء عليه" : "من Events Manager ← الإعدادات ← Generate access token"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Test Event Code (اختياري، للتجربة فقط)</Label>
            <Input dir="ltr" placeholder="TEST12345" value={testCode} onChange={(e) => setTestCode(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            الرمز لا يظهر مرة أخرى بعد الحفظ ولا يُرسل للمتصفح. طالما Test Event Code موجود تذهب الأحداث لصفحة الاختبار فقط؛ احذفه بعد التجربة.
          </p>
        </div>
      )}
      {!isMeta && !DELIVERING_PLATFORMS.includes(platform) && connection && (
        <p className="text-xs text-muted-foreground">محفوظ. إرسال النتائج تلقائيًا لهذه المنصة يُفعّل بعد موافقتها.</p>
      )}
    </div>
  );
}

function MetaDelivery({ delivery }: { delivery: { waiting: number; sent: number; failed: number; lastError: string | null } }) {
  const qc = useQueryClient();
  const testFn = useServerFn(sendMetaTestEvent);
  const deliverFn = useServerFn(deliverConversionsNow);
  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => toast.success(`استلمت Meta ${r.received} حدث تجريبي — افتح Test events في Events Manager`),
    onError: (e: Error) => toast.error(e.message),
  });
  const deliver = useMutation({
    mutationFn: () => deliverFn(),
    onSuccess: (r) => {
      toast.success(r.failed ? `أُرسل ${r.sent}، وتعذّر ${r.failed}` : `أُرسل ${r.sent} حدث`);
      qc.invalidateQueries({ queryKey: ["social-connections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-semibold">إرسال النتائج إلى ميتا</h3>
      <p className="text-xs text-muted-foreground">
        كل دقيقة يُرسل الخادم مراحل القمع المصنّفة في «تحويلات الإعلانات» (عميل مؤهل، حجز، بيع، وتقييم الجودة) إلى بكسل مؤسستك فقط. رقم العميل يُرسل مشفّرًا (SHA-256).
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat icon={<CheckCircle2 className="h-4 w-4 text-primary" />} label="أُرسل" value={delivery.sent} />
        <Stat icon={<Clock className="h-4 w-4" />} label="بالانتظار" value={delivery.waiting} />
        <Stat icon={<ShieldCheck className="h-4 w-4 text-destructive" />} label="فشل" value={delivery.failed} />
      </div>
      {delivery.lastError && <p className="text-xs text-destructive">آخر خطأ: {delivery.lastError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Send className="ml-1 h-4 w-4" />}
          إرسال حدث تجريبي
        </Button>
        <Button type="button" variant="outline" disabled={deliver.isPending || !delivery.waiting} onClick={() => deliver.mutate()}>
          إرسال المنتظر الآن
        </Button>
      </div>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

type MetaSetup = { available: boolean; appId: string | null; configId: string | null; graphVersion: string };

function MetaLoginButton({ label, setup }: { label: string; setup?: MetaSetup }) {
  const qc = useQueryClient();
  const startFn = useServerFn(startMetaSocialLink);
  const finishFn = useServerFn(finishMetaSocialLink);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<{ pixels: { id: string; name: string; account: string }[]; sealed: string } | null>(null);

  if (!setup?.available)
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3 opacity-70">
        <PlatformLogo platform="meta" />
        <span className="flex-1 text-sm font-medium">{label}</span>
        <Badge variant="secondary">بانتظار موافقة Meta</Badge>
      </div>
    );

  const launch = async () => {
    setBusy(true);
    try {
      const FB = await loadFbSdk(setup.appId!, setup.graphVersion);
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      FB.login(
        (response: any) => {
          const code = response?.authResponse?.code;
          if (!code) {
            setBusy(false);
            toast.info("تم إلغاء الربط قبل إكماله.");
            return;
          }
          startFn({ data: { code, redirectUri } })
            .then((r) => {
              if (!r.pixels.length) toast.error("لم أجد أي بكسل في حسابات الإعلانات التي سمحت بها");
              else setChoice(r);
            })
            .catch((e: Error) => toast.error(e.message))
            .finally(() => setBusy(false));
        },
        { config_id: setup.configId, response_type: "code", override_default_response_type: true, redirect_uri: redirectUri },
      );
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "تعذّر بدء الربط");
    }
  };

  const pick = async (pixelId: string) => {
    setBusy(true);
    try {
      await finishFn({ data: { pixelId, sealed: choice!.sealed } });
      toast.success("تم ربط ميتا");
      setChoice(null);
      qc.invalidateQueries({ queryKey: ["social-connections"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-primary/40 p-3 sm:col-span-2">
      <Button type="button" className="w-full gap-2" disabled={busy} onClick={launch}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlatformLogo platform="meta" className="h-6 w-6" />}
        {label}
      </Button>
      {choice && (
        <div className="space-y-1">
          <p className="text-xs font-medium">اختر بكسل مؤسستك:</p>
          {choice.pixels.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              className="flex w-full items-center justify-between rounded-md border p-2 text-sm hover:bg-accent"
              onClick={() => pick(p.id)}
            >
              <span>
                {p.name} {p.account && <span className="text-xs text-muted-foreground">· {p.account}</span>}
              </span>
              <span dir="ltr" className="text-xs text-muted-foreground">
                {p.id}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
