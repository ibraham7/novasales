import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Instagram, Link2, Unlink, AlertTriangle } from "lucide-react";
import { z } from "zod";
import { ChannelTabs } from "@/components/channels/channel-tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/lib/toast";
import { disconnectInstagramFn, finishInstagramLinkFn, getInstagramSetupFn, startInstagramLinkFn } from "@/modules/channels/instagram/instagram.functions";

// Instagram sends the person back to this page with ?code=…&state=… (or ?error=…).
const search = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_reason: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/channels")({
  head: () => ({ meta: [{ title: "قنوات التواصل - NovaSales" }] }),
  validateSearch: (raw) => search.parse(raw),
  component: ChannelsPage,
});

const STATUS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  connected: { label: "متصل", tone: "default" },
  needs_reconnect: { label: "يحتاج إعادة ربط", tone: "destructive" },
  disconnected: { label: "مفصول", tone: "secondary" },
};

function ChannelsPage() {
  const params = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setupFn = useServerFn(getInstagramSetupFn);
  const startFn = useServerFn(startInstagramLinkFn);
  const finishFn = useServerFn(finishInstagramLinkFn);
  const disconnectFn = useServerFn(disconnectInstagramFn);
  const setup = useQuery({ queryKey: ["instagram-setup"], queryFn: () => setupFn() });
  const [toDisconnect, setToDisconnect] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => startFn(),
    // The person signs in on Instagram's own page; this app never sees the password.
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "تعذر بدء الربط"),
  });

  const finish = useMutation({
    mutationFn: (input: { code: string; state: string }) => finishFn({ data: input }),
    onSuccess: (result) => {
      if (result.warning) toast.warning(result.warning);
      else toast.success(result.username ? `تم ربط @${result.username}` : "تم ربط الحساب");
      qc.invalidateQueries({ queryKey: ["instagram-setup"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "تعذر إكمال الربط"),
    onSettled: () => navigate({ to: "/channels", search: {}, replace: true }),
  });

  const disconnect = useMutation({
    mutationFn: (accountId: string) => disconnectFn({ data: { accountId } }),
    onSuccess: () => {
      toast.success("تم فصل الحساب");
      qc.invalidateQueries({ queryKey: ["instagram-setup"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "تعذر الفصل"),
  });

  // Finish the link once when the person returns from Instagram.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    if (params.error) {
      handled.current = true;
      toast.error(params.error_reason === "user_denied" ? "ألغيت الربط في إنستغرام" : "رفض إنستغرام الربط");
      navigate({ to: "/channels", search: {}, replace: true });
    } else if (params.code && params.state) {
      handled.current = true;
      finish.mutate({ code: params.code, state: params.state });
    }
  }, [params.code, params.state, params.error]);

  const accounts = setup.data?.accounts ?? [];
  const linking = start.isPending || finish.isPending;

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-5xl" dir="rtl">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">الجلسات</h1>
        <p className="text-muted-foreground mt-1">اربط حسابات التواصل التي تستقبل عليها رسائل العملاء. كل حساب تربطه تصل رسائله إليك أنت.</p>
      </header>
      <ChannelTabs active="instagram" />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Instagram className="h-5 w-5" />
          <h2 className="text-lg font-semibold">حسابات إنستغرام</h2>
        </div>
        <Button onClick={() => start.mutate()} disabled={linking || setup.data?.configured === false}>
          <Link2 className="h-4 w-4 ml-1.5" />
          {linking ? "جارٍ الربط..." : "ربط حساب إنستغرام"}
        </Button>
      </div>

      {setup.data?.configured === false && (
        <Card className="mb-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>ربط إنستغرام غير مفعّل بعد على الخادم. تواصل مع إدارة المنصة لإكمال الإعداد.</span>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="p-4 text-sm text-muted-foreground space-y-1">
          <p>عند الضغط على «ربط» تفتح <b>صفحة إنستغرام الرسمية</b> لتسجّل الدخول وتوافق. المنصة لا ترى كلمة السر أبداً.</p>
          <p>يجب أن يكون الحساب <b>احترافياً</b> (Business أو Creator). يمكنك ربط أي عدد من الحسابات.</p>
          <p>يمكن الرد على العميل خلال <b>24 ساعة</b> من آخر رسالة منه، وهذه قاعدة إنستغرام.</p>
        </CardContent>
      </Card>

      {setup.isLoading ? (
        <p className="text-muted-foreground py-8 text-center">جارٍ التحميل...</p>
      ) : setup.isError ? (
        <p className="text-destructive py-8 text-center">تعذر تحميل الحسابات. أعد المحاولة.</p>
      ) : accounts.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center">لم تربط أي حساب إنستغرام بعد.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => {
            const status = STATUS[a.status] ?? STATUS.disconnected;
            return (
              <Card key={a.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate" dir="ltr">{a.username ? `@${a.username}` : a.displayName}</div>
                      <div className="text-xs text-muted-foreground">{a.isMine ? "حسابك" : "حساب زميل"}</div>
                    </div>
                    <Badge variant={status.tone}>{status.label}</Badge>
                  </div>
                  {a.status === "needs_reconnect" && <p className="text-xs text-destructive">انتهى الربط. اضغط «ربط حساب إنستغرام» وسجّل الدخول من جديد.</p>}
                  <div className="flex justify-end">
                    {a.status !== "disconnected" && (
                      <Button variant="outline" size="sm" disabled={disconnect.isPending} onClick={() => setToDisconnect(a.id)}>
                        <Unlink className="h-4 w-4 ml-1.5" />
                        فصل
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!toDisconnect} onOpenChange={(open) => !open && setToDisconnect(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>فصل هذا الحساب؟</AlertDialogTitle>
            <AlertDialogDescription>لن تصلك رسائله بعد الآن. تبقى المحادثات القديمة كما هي، ويمكنك ربطه من جديد في أي وقت.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDisconnect) disconnect.mutate(toDisconnect);
                setToDisconnect(null);
              }}
            >
              فصل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
