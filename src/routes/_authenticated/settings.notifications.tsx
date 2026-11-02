import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, BellRing, Loader2, Send, Share, Smartphone, Trash2 } from "lucide-react";
import {
  getMyNotificationSettings,
  getPushStatus,
  registerPushSubscription,
  removePushDevice,
  saveNotificationPreferences,
  sendTestNotification,
  unregisterPushSubscription,
} from "@/modules/notifications/notifications.functions";
import {
  currentSubscription,
  deviceLabel,
  isIos,
  isInstalledApp,
  permissionState,
  pushSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PermissionState,
} from "@/lib/push-client";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  head: () => ({ meta: [{ title: "الإشعارات - NovaSales" }] }),
  component: NotificationSettingsPage,
});

type DeviceState = { permission: PermissionState; subscribed: boolean; endpoint: string | null; ready: boolean };

function NotificationSettingsPage() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getPushStatus);
  const settingsFn = useServerFn(getMyNotificationSettings);
  const registerFn = useServerFn(registerPushSubscription);
  const unregisterFn = useServerFn(unregisterPushSubscription);
  const removeFn = useServerFn(removePushDevice);
  const saveFn = useServerFn(saveNotificationPreferences);
  const testFn = useServerFn(sendTestNotification);

  const status = useQuery({ queryKey: ["push-status"], queryFn: () => statusFn(), staleTime: 60_000 });
  const settings = useQuery({ queryKey: ["notification-settings"], queryFn: () => settingsFn() });
  const support = pushSupport();
  const [device, setDevice] = useState<DeviceState>({ permission: "default", subscribed: false, endpoint: null, ready: false });

  const readDevice = useCallback(async () => {
    const subscription = support.ok ? await currentSubscription().catch(() => null) : null;
    setDevice({ permission: permissionState(), subscribed: !!subscription, endpoint: subscription?.endpoint ?? null, ready: true });
  }, [support.ok]);
  useEffect(() => {
    void readDevice();
  }, [readDevice]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["notification-settings"] });

  const enable = useMutation({
    mutationFn: async () => {
      if (!status.data?.publicKey) throw new Error("الإشعارات غير مُعدّة على الخادم بعد");
      const keys = await subscribeThisDevice(status.data.publicKey);
      await registerFn({ data: { ...keys, userAgent: navigator.userAgent.slice(0, 300), deviceLabel: deviceLabel() } });
    },
    onSuccess: async () => {
      toast.success("تم تفعيل الإشعارات على هذا الجهاز");
      await readDevice();
      refresh();
    },
    onError: async (error: Error) => {
      await readDevice();
      if (error.message === "denied") toast.error("حظر المتصفح الإشعارات لهذا الموقع. فعّلها من إعدادات الموقع ثم أعد المحاولة");
      else if (error.message === "dismissed") toast.info("لم يُمنح الإذن. يمكنك المحاولة مرة أخرى متى أردت");
      else toast.error(error.message);
    },
  });

  const disable = useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await unregisterFn({ data: { endpoint } });
    },
    onSuccess: async () => {
      toast.success("تم إيقاف الإشعارات على هذا الجهاز");
      await readDevice();
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: () => toast.success("أُرسل إشعار تجريبي. إن لم يظهر خلال لحظات فتحقق من إعدادات الإشعارات في جهازك"),
    onError: (error: Error) => toast.error(error.message),
  });

  const removeDevice = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: async () => {
      toast.success("تم حذف الجهاز");
      await readDevice();
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const [pending, setPending] = useState<Set<string>>(new Set());
  const toggleType = async (key: string, enabled: boolean) => {
    if (!settings.data) return;
    const disabled = settings.data.types.filter((t) => (t.key === key ? !enabled : !t.enabled)).map((t) => t.key);
    setPending((old) => new Set(old).add(key));
    qc.setQueryData(["notification-settings"], {
      ...settings.data,
      types: settings.data.types.map((t) => (t.key === key ? { ...t, enabled } : t)),
    });
    try {
      await saveFn({ data: { disabledTypes: disabled as any } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذّر حفظ الاختيار");
    } finally {
      setPending((old) => {
        const next = new Set(old);
        next.delete(key);
        return next;
      });
      refresh();
    }
  };

  const groups = new Map<string, NonNullable<typeof settings.data>["types"]>();
  for (const type of settings.data?.types ?? []) groups.set(type.group, [...(groups.get(type.group) ?? []), type]);
  const active = device.permission === "granted" && device.subscribed;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">إعدادات الإشعارات</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          استقبل تنبيهات العملاء والمبيعات والمهام على جهازك، حتى لو كان الموقع مغلقاً.
        </p>
      </div>

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
            {active ? <BellRing className="h-5 w-5" /> : device.permission === "denied" ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">إشعارات هذا الجهاز</h3>
            <p className="text-xs text-muted-foreground">{deviceLabel()}</p>
          </div>
          {device.ready && (
            <Badge variant={active ? "default" : "secondary"}>
              {active ? "مفعّلة" : device.permission === "denied" ? "محظورة" : "غير مفعّلة"}
            </Badge>
          )}
        </div>

        {status.isSuccess && !status.data.configured && (
          <Alert variant="destructive">
            <AlertTitle>الإشعارات غير مُعدّة على الخادم</AlertTitle>
            <AlertDescription>لم تُضبط مفاتيح الإشعارات (VAPID) بعد. تواصل مع مدير النظام لإكمال الإعداد.</AlertDescription>
          </Alert>
        )}

        {!support.ok && support.reason === "ios-needs-install" && (
          <Alert>
            <Share className="h-4 w-4" />
            <AlertTitle>على آيفون وآيباد ثبّت الموقع أولاً</AlertTitle>
            <AlertDescription>
              اضغط زر المشاركة في Safari ثم «إضافة إلى الشاشة الرئيسية»، وافتح NovaSales من الأيقونة الجديدة، ثم عُد إلى هذه الصفحة وفعّل الإشعارات. (يتطلب iOS 16.4 أو أحدث)
            </AlertDescription>
          </Alert>
        )}
        {!support.ok && support.reason === "insecure" && (
          <Alert variant="destructive">
            <AlertTitle>الاتصال غير آمن</AlertTitle>
            <AlertDescription>الإشعارات تعمل فقط على اتصال HTTPS.</AlertDescription>
          </Alert>
        )}
        {!support.ok && support.reason === "unsupported" && (
          <Alert>
            <AlertTitle>المتصفح لا يدعم الإشعارات</AlertTitle>
            <AlertDescription>جرّب Chrome أو Edge أو Firefox أو Safari حديث{isIos() ? "، وثبّت الموقع على الشاشة الرئيسية" : ""}.</AlertDescription>
          </Alert>
        )}

        {support.ok && device.permission === "denied" && (
          <Alert variant="destructive">
            <AlertTitle>حظر المتصفح الإشعارات لهذا الموقع</AlertTitle>
            <AlertDescription>
              لا يمكن للموقع طلب الإذن مرة أخرى. افتح إعدادات الموقع من شريط العنوان (أيقونة القفل) أو إعدادات المتصفح، واسمح بالإشعارات لهذا الموقع، ثم حدّث الصفحة وفعّل الإشعارات.
            </AlertDescription>
          </Alert>
        )}

        {support.ok && device.permission !== "denied" && isIos() && !isInstalledApp() && (
          <p className="text-xs text-muted-foreground">نصيحة: على آيفون تعمل الإشعارات من التطبيق المثبّت على الشاشة الرئيسية.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {support.ok && !active && device.permission !== "denied" && (
            <Button onClick={() => enable.mutate()} disabled={enable.isPending || !status.data?.configured}>
              {enable.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Bell className="ml-1 h-4 w-4" />}
              {enable.isPending ? "جارٍ التفعيل..." : "تفعيل إشعارات هذا الجهاز"}
            </Button>
          )}
          {active && (
            <>
              <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
                {test.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Send className="ml-1 h-4 w-4" />}
                إرسال إشعار تجريبي
              </Button>
              <Button
                variant="ghost"
                disabled={disable.isPending}
                onClick={async () => {
                  if (await askConfirm({ title: "إيقاف الإشعارات على هذا الجهاز؟", description: "لن تصلك تنبيهات على هذا الجهاز حتى تفعّلها من جديد.", confirmLabel: "إيقاف", destructive: true }))
                    disable.mutate();
                }}
              >
                {disable.isPending ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <BellOff className="ml-1 h-4 w-4" />}
                إيقاف على هذا الجهاز
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          «إرسال إشعار تجريبي» يؤكد أن خدمة الإشعارات قبلت الرسالة. إن لم يظهر الإشعار على الشاشة فراجع إعدادات الإشعارات في هاتفك أو وضع عدم الإزعاج.
        </p>
      </Card>

      <Card className="space-y-4 p-4 sm:p-5">
        <div>
          <h3 className="font-semibold">أنواع الإشعارات</h3>
          <p className="text-xs text-muted-foreground">اختر ما تريد استقباله. ينطبق الاختيار على كل أجهزتك.</p>
        </div>
        {settings.isPending ? (
          <p className="text-sm">جارٍ التحميل...</p>
        ) : settings.isError ? (
          <p className="text-sm text-destructive">{(settings.error as Error).message}</p>
        ) : (
          [...groups.entries()].map(([group, types]) => (
            <div key={group} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{group}</p>
              {types.map((type) => (
                <label key={type.key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{type.label}</span>
                    <span className="block text-xs text-muted-foreground">{type.description}</span>
                  </span>
                  <Switch checked={type.enabled} disabled={pending.has(type.key)} onCheckedChange={(value) => toggleType(type.key, value)} aria-label={type.label} />
                </label>
              ))}
            </div>
          ))
        )}
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <div>
          <h3 className="font-semibold">أجهزتي</h3>
          <p className="text-xs text-muted-foreground">الأجهزة التي تستقبل إشعارات حسابك.</p>
        </div>
        {settings.data && settings.data.devices.length === 0 && <p className="text-sm text-muted-foreground">لا توجد أجهزة مفعّلة.</p>}
        {settings.data?.devices.map((d: any) => (
          <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3">
            <Smartphone className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {d.device_label || "جهاز"}
                {d.endpoint === device.endpoint && <Badge variant="secondary">هذا الجهاز</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {d.last_success_at ? `آخر إرسال ناجح: ${formatDateTime(d.last_success_at)}` : `أُضيف ${formatDateTime(d.created_at)}`}
                {d.failure_count > 0 && <span className="text-destructive"> · فشل الإرسال {d.failure_count} مرة</span>}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="حذف الجهاز"
              disabled={removeDevice.isPending}
              onClick={async () => {
                if (await askConfirm({ title: "حذف هذا الجهاز؟", description: "لن تصله إشعارات حسابك بعد الآن.", confirmLabel: "حذف", destructive: true })) {
                  if (d.endpoint === device.endpoint) await unsubscribeThisDevice().catch(() => undefined);
                  removeDevice.mutate(d.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </Card>
    </div>
  );
}
