import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getConversionConfiguration,
  saveConversionConfiguration,
  listConversionEvents,
} from "@/modules/integrations/conversions.functions";
import {
  CONVERSION_LABELS,
  PRIMARY_GOALS,
  type ConversionKind,
  type ConversionGoal,
} from "@/modules/integrations/conversion-model";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/toast";
export const Route = createFileRoute("/_authenticated/settings/conversions")({
  head: () => ({ meta: [{ title: "تحويلات الإعلانات - NovaSales" }] }),
  component: ConversionsPage,
});
const selectClass = "w-full rounded-md border bg-background p-2 text-sm";
function ConversionsPage() {
  const qc = useQueryClient();
  const fetch = useServerFn(getConversionConfiguration),
    save = useServerFn(saveConversionConfiguration),
    events = useServerFn(listConversionEvents);
  const q = useQuery({ queryKey: ["conversion-settings"], queryFn: () => fetch() });
  const [goal, setGoal] = useState<ConversionGoal>("qualified_lead"),
    [enabled, setEnabled] = useState(true),
    [rules, setRules] = useState<Record<string, ConversionKind>>({}),
    [dirty, setDirty] = useState(false);
  const [page, setPage] = useState(1),
    [kind, setKind] = useState<"all" | ConversionKind>("all");
  const log = useQuery({
    queryKey: ["conversion-events", page, kind],
    queryFn: () => events({ data: { page, kind } }),
  });
  useEffect(() => {
    if (q.data && !dirty) {
      setGoal(q.data.settings.primary_goal);
      setEnabled(q.data.settings.recording_enabled);
      setRules(Object.fromEntries(q.data.rules.map((r: any) => [r.stage_id, r.classification])));
    }
  }, [q.data, dirty]);
  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          primaryGoal: goal,
          recordingEnabled: enabled,
          rules: Object.entries(rules).map(([stageId, classification]) => ({
            stageId,
            classification,
          })),
        },
      }),
    onSuccess: () => {
      qc.setQueryData(["conversion-settings"], (old: any) => ({
        ...old,
        configured: true,
        settings: { primary_goal: goal, recording_enabled: enabled },
        rules: Object.entries(rules).map(([stage_id, classification]) => ({
          stage_id,
          classification,
        })),
      }));
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["conversion-settings"] });
      toast.success("تم حفظ إعدادات التحويلات؛ يبدأ التسجيل من الآن");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pipelines = q.data?.pipelines ?? [];
  const hasGoal = pipelines.some((p: any) =>
    (p.crm_pipeline_stages ?? []).some((s: any) => rules[s.id] === goal),
  );
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">تحويلات الإعلانات</h2>
        <p className="text-sm text-muted-foreground mt-2">
          صنّف نتائج العملاء داخل قمع المبيعات لتجهيز ربط الحملات الإعلانية لاحقًا.
        </p>
      </div>
      <Card className="p-4 space-y-2">
        <Badge variant="secondary">المنصات غير مربوطة</Badge>
        <p className="text-sm">
          يُسجل النظام النتائج داخليًا فقط. لم يتم إرسال أي تحويل إلى Google أو Meta أو غيرهما.
        </p>
        <p className="text-xs text-muted-foreground">
          لا تحتاج Pixel أو مفتاح API الآن. تسجيل النقاط واحتمال الفوز يختلف عن تحديد هدف الإعلان.
        </p>
      </Card>
      {q.isPending ? (
        <p>جارٍ تحميل الإعدادات...</p>
      ) : q.isError ? (
        <Card className="p-4" role="alert">
          <p className="text-destructive">تعذر تحميل إعدادات التحويلات</p>
          <Button variant="outline" onClick={() => q.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : (
        <Card className="p-4 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="conversion-goal">الهدف الأساسي — إلزامي</Label>
              <select
                disabled={mut.isPending}
                id="conversion-goal"
                className={selectClass}
                value={goal}
                onChange={(e) => {
                  setGoal(e.target.value as ConversionGoal);
                  setDirty(true);
                }}
              >
                {PRIMARY_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {CONVERSION_LABELS[g]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                disabled={mut.isPending}
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  setDirty(true);
                }}
              />
              تسجيل انتقالات العملاء الجديدة
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            نقترح البدء بـ«عميل مؤهل». اختر تصنيفًا لكل مرحلة حسب نشاط مؤسستك. بيع ناجح يعني بيعًا
            فعليًا، وليس مجرد اهتمام.
          </p>
          {!pipelines.length && <p>لا توجد أقماع بعد. أنشئ قمعًا من «قنوات المبيعات» أولًا.</p>}
          {pipelines.map((p: any) => (
            <section key={p.id} className="space-y-2">
              <h3 className="font-semibold">{p.name}</h3>
              {[...(p.crm_pipeline_stages ?? [])]
                .sort((a: any, b: any) => a.ord - b.ord)
                .map((s: any) => (
                  <div
                    key={s.id}
                    className="grid sm:grid-cols-2 items-center gap-2 border rounded-md p-3"
                  >
                    <span>
                      {s.name}
                      {s.is_won && (
                        <Badge variant="outline" className="mr-2">
                          فوز
                        </Badge>
                      )}
                      {s.is_lost && (
                        <Badge variant="outline" className="mr-2">
                          خسارة
                        </Badge>
                      )}
                    </span>
                    <select
                      disabled={mut.isPending}
                      aria-label={`تصنيف مرحلة ${s.name}`}
                      className={selectClass}
                      value={rules[s.id] ?? "none"}
                      onChange={(e) => {
                        setRules((old) => ({ ...old, [s.id]: e.target.value as ConversionKind }));
                        setDirty(true);
                      }}
                    >
                      {Object.entries(CONVERSION_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </section>
          ))}
          {enabled && !hasGoal && (
            <p className="text-sm text-amber-700" role="status">
              لم تصنّف أي مرحلة كـ«{CONVERSION_LABELS[goal]}». سيُحفظ السجل، لكن لن توجد تحويلات
              لهذا الهدف حتى تصنّف مرحلة مناسبة.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            لا يُعاد احتساب دخول الفرصة إلى التصنيف نفسه كتحويل جديد. تعديل التصنيفات لا يغيّر
            السجلات السابقة ولا ينشئ تحويلات بأثر رجعي.
          </p>
          <Button
            disabled={mut.isPending || (!dirty && !!q.data?.configured)}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
          </Button>
          {!dirty && !q.data?.configured && (
            <p className="text-xs text-muted-foreground">
              لتفعيل التسجيل لأول مرة، اختر تصنيفًا لمرحلة واحفظ الإعدادات.
            </p>
          )}
        </Card>
      )}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">سجل التحويلات</h3>
          <Button variant="outline" disabled={log.isFetching} onClick={() => log.refetch()}>
            تحديث السجل
          </Button>
        </div>
        <select
          aria-label="فلترة سجل التحويلات"
          className={`${selectClass} sm:max-w-xs`}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setPage(1);
          }}
        >
          <option value="all">كل التصنيفات</option>
          {Object.entries(CONVERSION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        {log.isPending ? (
          <p>جارٍ تحميل السجل...</p>
        ) : log.isError ? (
          <div role="alert">
            <p className="text-destructive">تعذر تحميل السجل</p>
            <Button variant="outline" onClick={() => log.refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <>
            {!log.data?.rows.length ? (
              <p className="text-sm text-muted-foreground">
                لا توجد سجلات مطابقة. احفظ التصنيفات ثم انقل عميلًا إلى مرحلة أخرى في القمع.
              </p>
            ) : (
              <div className="space-y-2">
                {log.data.rows.map((r: any) => (
                  <div key={r.id} className="border rounded-md p-3 space-y-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong className="text-sm">
                        {r.stage_name} — {CONVERSION_LABELS[r.event_kind as ConversionKind]}
                      </strong>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.occurred_at).toLocaleString("ar")}
                      </span>
                    </div>
                    <p className="text-xs">
                      {r.is_first_for_goal
                        ? r.event_kind === r.primary_goal
                          ? "تحويل أول للهدف الأساسي"
                          : "تحويل أول لهدف ثانوي"
                        : "سجل داخلي — لا يحتسب تحويلًا جديدًا"}{" "}
                      ·{" "}
                      {r.delivery_state === "awaiting_connection"
                        ? "بانتظار ربط المنصة"
                        : "غير مخصص للإرسال"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      مرجع الفرصة: <span dir="ltr">{r.opportunity_id}</span>
                    </p>
                    {r.event_kind === "purchase" && r.value != null && (
                      <p className="text-xs">
                        قيمة الفرصة المسجلة: {r.value} {r.currency} — ليست إثبات دفع تلقائيًا
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 text-sm">
              <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
                السابق
              </Button>
              <span>
                صفحة {page} · {log.data?.total ?? 0} سجل
              </span>
              <Button
                variant="outline"
                disabled={page * 25 >= (log.data?.total ?? 0)}
                onClick={() => setPage(page + 1)}
              >
                التالي
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
