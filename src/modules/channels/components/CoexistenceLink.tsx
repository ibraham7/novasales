/**
 * ربط رقم واتساب رسمي (Coexistence) عبر Embedded Signup من Meta.
 * الرقم يبقى يعمل في تطبيق WhatsApp Business على الجوال وفي NovaSales معاً.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgeCheck, ExternalLink, HelpCircle, Loader2, ShieldCheck } from "lucide-react";

import { getCoexistenceSetupFn, linkCoexistenceFn } from "../whatsapp/coexistence.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

function loadFbSdk(appId: string, version: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const init = () => {
      if (!window.FB) return false;
      window.FB.init({ appId, cookie: true, xfbml: false, version });
      resolve(window.FB);
      return true;
    };
    // يجب إعادة التهيئة بالقيم الحالية حتى لو كان SDK محمّلاً من شاشة سابقة.
    if (init()) return;
    const existing = document.getElementById("facebook-jssdk");
    if (existing) {
      const timer = setInterval(() => {
        if (init()) {
          clearInterval(timer);
          clearTimeout(timeout);
        }
      }, 120);
      const timeout = setTimeout(() => {
        clearInterval(timer);
        reject(new Error("انتهت مهلة تحميل مكتبة Meta — أعد تحميل الصفحة وحاول مجدداً."));
      }, 8000);
      return;
    }
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (!init()) reject(new Error("تم تحميل مكتبة Meta لكن تعذّرت تهيئتها."));
    };
    script.onerror = () => reject(new Error("تعذّر تحميل مكتبة Meta — تحقق من الاتصال أو حاجب الإعلانات."));
    document.body.appendChild(script);
  });
}

/** تعليمات الربط للمستخدم — بلا أي إعدادات أو أسرار منصة. */
export function CoexistenceInstructions() {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="how">
        <AccordionTrigger className="text-sm">كيف يعمل الربط الرسمي؟ (اقرأ قبل البدء)</AccordionTrigger>
        <AccordionContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pr-4">
            <li>
              حمّل تطبيق <strong>WhatsApp Business</strong> على جوال الرقم وسجّل الدخول به، وتأكد أن الرقم يعمل
              عليه الآن.
            </li>
            <li>
              من داخل التطبيق: <strong>الإعدادات ← الأدوات التجارية ← واتساب للأعمال API</strong>، وفعّل مشاركة
              الرقم (سيطلب رمز تحقق أثناء الربط).
            </li>
            <li>
              اضغط <strong>«ربط رقم رسمي»</strong> هنا، وستفتح نافذة Meta. اختر حساب الأعمال ثم الرقم نفسه.
            </li>
            <li>
              أكمل خطوة <strong>المزامنة</strong> في النافذة (تظهر كخيار Coexistence)، ثم انتظر إغلاق النافذة
              تلقائياً.
            </li>
            <li>
              بعد الربط: يصل سجل آخر ٦ أشهر من محادثاتك تدريجياً، وتظهر الرسائل الجديدة في NovaSales وعلى
              الجوال في نفس الوقت.
            </li>
          </ol>
          <div className="rounded-md border p-3 space-y-1">
            <p className="font-medium text-foreground">ملاحظتان مهمتان</p>
            <p>
              • الرقم الرسمي لا يدخل «فترة المراقبة» لأنه لا يستخدم اتصالاً غير رسمي — هذا هو الفرق الجذري عن
              الربط بـ QR.
            </p>
            <p>
              • لبدء محادثة مع رقم جديد بعد مرور ٢٤ ساعة من آخر رسالة للعميل، يشترط واتساب استخدام <strong>قالب
              معتمد</strong>؛ الرد داخل ٢٤ ساعة يكون نصاً حراً بلا قيود.
            </p>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}




export function CoexistenceLinkDialog() {
  const qc = useQueryClient();
  const fetchSetup = useServerFn(getCoexistenceSetupFn);
  const link = useServerFn(linkCoexistenceFn);
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [launching, setLaunching] = useState(false);
  const [linkKind, setLinkKind] = useState<"coexistence" | "new">("coexistence");
  const [linkError, setLinkError] = useState<string | null>(null);
  const signupInfo = useRef<{ wabaId?: string; phoneNumberId?: string }>({});
  // رمز التفويض صالح لمرة واحدة — نمنع إرساله مرتين.
  const usedCodes = useRef<Set<string>>(new Set());
  // رابط الصفحة الفعلي لحظة فتح نافذة Meta — نفس القيمة المطلوبة عند تبادل الرمز.
  const redirectUriRef = useRef<string>("");

  const { data: setup } = useQuery({
    queryKey: ["coexistence-setup"],
    queryFn: () => fetchSetup(),
    staleTime: 5 * 60 * 1000,
  });

  const linkMut = useMutation({
    // رمز التفويض أحادي الاستخدام: أي إعادة إرسال آلي تستهلكه وتُنتج خطأ مضلّلاً.
    retry: 0,
    mutationFn: ({ code, codeReceivedAt }: { code: string; codeReceivedAt: number }) =>
      link({
        data: {
          code,
          redirectUri: redirectUriRef.current,
          codeReceivedAt,
          browserAppId: setup?.appId,


          ...(signupInfo.current.wabaId ? { wabaId: signupInfo.current.wabaId } : {}),
          ...(signupInfo.current.phoneNumberId ? { phoneNumberId: signupInfo.current.phoneNumberId } : {}),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        },
      }),
    onSuccess: (res) => {
      toast.success(`تم ربط الرقم الرسمي ${res.phoneNumber ? `+${res.phoneNumber}` : ""} بنجاح`);
      setOpen(false);
      setDisplayName("");
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e) => {
      // نعرض نص Meta الحرفي كما ورد حتى يظهر السبب الحقيقي بلا حاجة لقراءة السجلات.
      const msg = e instanceof Error ? e.message : "فشل إكمال الربط";
      setLinkError(msg);
      toast.error(msg, { duration: 10000 });
    },
  });



  // نافذة Meta ترسل معرّفات الحساب والرقم عبر postMessage
  useEffect(() => {
    if (!open) return;
    const onMessage = (event: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
        const d = payload.data ?? {};
        if (d.waba_id) signupInfo.current.wabaId = String(d.waba_id);
        if (d.phone_number_id) signupInfo.current.phoneNumberId = String(d.phone_number_id);
      } catch {
        /* رسائل غير متعلقة بالربط */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open]);

  const launch = useCallback(async () => {
    if (!setup?.configured || !setup.appId || !setup.configId) {
      toast.error("خدمة الربط الرسمي غير متاحة حالياً — تواصل مع إدارة NovaSales.");
      return;
    }
    setLaunching(true);
    setLinkError(null);
    signupInfo.current = {};
    // جلسة ربط جديدة: نبدأ بحراسة أكواد فارغة حتى لا تمنع محاولة كاملة جديدة.
    usedCodes.current.clear();
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    redirectUriRef.current = redirectUri;
    console.log(`[META_OAUTH] start (browser) redirect_uri=${redirectUri} flow=js-sdk-popup`);

    try {
      const FB = await loadFbSdk(setup.appId, setup.graphVersion);
      FB.login(
        (response: any) => {
          setLaunching(false);
          const code = response?.authResponse?.code;
          if (!code) {
            toast.info("تم إلغاء الربط قبل إكماله.");
            return;
          }
          if (usedCodes.current.has(code)) {
            console.warn("[META_OAUTH] duplicate code ignored");
            return;
          }
          usedCodes.current.add(code);
          console.log(`[META_OAUTH] code received codeLength=${String(code).length}`);
          linkMut.mutate({ code, codeReceivedAt: Date.now() });
        },

        {
          config_id: setup.configId,
          response_type: "code",
          override_default_response_type: true,
          redirect_uri: redirectUri,
          extras: {
            setup: {},
            sessionInfoVersion: "3",
            // Coexistence: الرقم يبقى يعمل على تطبيق WhatsApp Business بالتوازي.
            ...(linkKind === "coexistence" ? { featureType: "whatsapp_business_app_onboarding" } : {}),
          },
        },

      );
    } catch (e) {
      setLaunching(false);
      toast.error(e instanceof Error ? e.message : "تعذّر بدء الربط");
    }
  }, [setup, linkMut, linkKind]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <BadgeCheck className="h-4 w-4 ml-1" /> ربط رقم رسمي
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> ربط واتساب الرسمي (Coexistence)
          </DialogTitle>
          <DialogDescription>
            ربط معتمد من Meta: الرقم يبقى يعمل على تطبيق WhatsApp Business وفي NovaSales في نفس الوقت.
          </DialogDescription>
        </DialogHeader>

        {setup && !setup.configured ? (
          <Alert variant="destructive">
            <HelpCircle className="h-4 w-4" />
            <AlertTitle>الربط الرسمي غير متاح حالياً</AlertTitle>
            <AlertDescription>
              خدمة الربط الرسمي معطّلة مؤقتاً على مستوى المنصة — تواصل مع إدارة NovaSales.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>اسم الجلسة (للعرض)</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="مثال: المبيعات الرسمي"
            />
          </div>

          <div className="space-y-2">
            <Label>حالة الرقم</Label>
            <div className="grid gap-2">
              {(
                [
                  {
                    id: "coexistence" as const,
                    title: "رقم يعمل الآن على تطبيق WhatsApp Business",
                    hint: "يبقى على جوال الموظف للمكالمات والاستخدام اليومي، ويعمل مع NovaSales بالتوازي.",
                  },
                  {
                    id: "new" as const,
                    title: "رقم جديد غير مستخدم على التطبيق",
                    hint: "سيُسجّل مباشرة على واتساب الرسمي داخل حساب مؤسستك.",
                  },
                ]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLinkKind(opt.id)}
                  className={`rounded-lg border p-3 text-right transition ${
                    linkKind === opt.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="text-sm font-medium">{opt.title}</div>
                  <div className="text-xs text-muted-foreground">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <CoexistenceInstructions />

          {linkError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <div className="mb-1 font-medium">تعذّر إكمال الربط — رسالة Meta:</div>
              <div className="break-words font-mono leading-relaxed">{linkError}</div>
              <div className="mt-1 text-muted-foreground">أعد فتح نافذة Meta للمحاولة من جديد.</div>
            </div>
          ) : null}

          <Button

            className="w-full"
            disabled={!setup?.configured || launching || linkMut.isPending}
            onClick={launch}
          >
            {launching || linkMut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 ml-1 animate-spin" /> جاري الربط…
              </>
            ) : (
              <>
                <ExternalLink className="h-4 w-4 ml-1" /> ابدأ الربط عبر Meta
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
