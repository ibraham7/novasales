import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDateTime } from "@/lib/utils";
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
  QUALITY_LEVELS,
  QUALITY_LEVEL_KEYS,
  validateQualityLevels,
  type ConversionKind,
  type ConversionGoal,
  type QualityLevel,
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
const DELIVERY_LABELS: Record<string, string> = {
  awaiting_connection: "بانتظار الإرسال للمنصة",
  sent: "أُرسل إلى ميتا",
  failed: "تعذّر الإرسال",
  skipped: "لم يُرسل (أقدم من 7 أيام)",
};
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
    [quality, setQuality] = useState<Record<string, QualityLevel | null>>({}),
    [dirty, setDirty] = useState(false);
  const [page, setPage] = useState(1),
    [kind, setKind] = useState<"all" | "quality_signal" | ConversionKind>("all");
  const log = useQuery({
    queryKey: ["conversion-events", page, kind],
    queryFn: () => events({ data: { page, kind } }),
  });
  useEffect(() => {
    if (q.data && !dirty) {
      setGoal(q.data.settings.primary_goal);
      setEnabled(q.data.settings.recording_enabled);
      setRules(Object.fromEntries(q.data.rules.map((r: any) => [r.stage_id, r.classification])));
      setQuality(
        Object.fromEntries(q.data.rules.map((r: any) => [r.stage_id, r.quality_level ?? null])),
      );
    }
  }, [q.data, dirty]);
  const pipelines = q.data?.pipelines ?? [];
  const pipelineOfStage = (stageId: string) =>
    pipelines.find((p: any) => (p.crm_pipeline_stages ?? []).some((s: any) => s.id === stageId))
      ?.id;
  const ruleList = () =>
    [...new Set([...Object.keys(rules), ...Object.keys(quality)])].map((stageId) => ({
      stageId,
      classification: rules[stageId] ?? ("none" as ConversionKind),
      qualityLevel: quality[stageId] ?? null,
    }));
  const pickQuality = (stageId: string, level: QualityLevel | null) => {
    // A level sits on one stage per pipeline: choosing it here moves it off the other stage.
    const pipe = pipelineOfStage(stageId);
    setQuality((old) =>
      Object.fromEntries(
        Object.entries({ ...old, [stageId]: level }).map(([id, l]) => [
          id,
          id !== stageId && level && l === level && pipelineOfStage(id) === pipe ? null : l,
        ]),
      ),
    );
    setDirty(true);
  };
  const mut = useMutation({
    mutationFn: () => {
      const list = ruleList();
      validateQualityLevels(list, pipelineOfStage);
      return save({ data: { primaryGoal: goal, recordingEnabled: enabled, rules: list } });
    },
    onSuccess: () => {
      qc.setQueryData(["conversion-settings"], (old: any) => ({
        ...old,
        configured: true,
        settings: { primary_goal: goal, recording_enabled: enabled },
        rules: ruleList().map((r) => ({
          stage_id: r.stageId,
          classification: r.classification,
          quality_level: r.qualityLevel,
        })),
      }));
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["conversion-settings"] });
      toast.success("تم حفظ إعدادات التحويلات؛ يبدأ التسجيل من الآن");
    },
    onError: (e: Error) => toast.error(e.message),
  });
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
        <Badge variant="secondary">الإرسال للمنصات من «ربط وسائل التواصل»</Badge>
        <p className="text-sm">
          تُسجل النتائج هنا، وتُرسل إلى بكسل ميتا الخاص بمؤسستك فقط بعد ربطه من صفحة{" "}
          <Link to="/settings/social" className="text-primary underline">
            ربط وسائل التواصل
          </Link>
          .
        </p>
        <p className="text-xs text-muted-foreground">
          تسجيل النقاط واحتمال الفوز يختلف عن تحديد هدف الإعلان.
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
          <p className="text-sm text-muted-foreground">
            تقييم الجودة: اختر حتى أربع مراحل في كل قمع وأعطِ كل واحدة تقييمًا (سيء جدًا 0، متوسط 3،
            جيد 6، ممتاز 10). يظهر التقييم فوق المرحلة في القمع، وعند نقل عميل إليها تُسجل إشارة
            فيها رقم الجوال والتقييم وقيمة الفرصة.
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
                    className="grid sm:grid-cols-3 items-center gap-2 border rounded-md p-3"
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
                    <select
                      disabled={mut.isPending}
                      aria-label={`تقييم جودة مرحلة ${s.name}`}
                      className={selectClass}
                      value={quality[s.id] ?? ""}
                      onChange={(e) =>
                        pickQuality(s.id, (e.target.value || null) as QualityLevel | null)
                      }
                    >
                      <option value="">بدون تقييم جودة</option>
                      {QUALITY_LEVEL_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {QUALITY_LEVELS[key].label} — {QUALITY_LEVELS[key].score}/10
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
          <option value="quality_signal">إشارات تقييم الجودة</option>
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
                        {formatDateTime(r.occurred_at)}
                      </span>
                    </div>
                    <p className="text-xs">
                      {r.is_first_for_goal
                        ? r.event_kind === r.primary_goal
                          ? "تحويل أول للهدف الأساسي"
                          : "تحويل أول لهدف ثانوي"
                        : "سجل داخلي — لا يحتسب تحويلًا جديدًا"}{" "}
                      ·{" "}
                      {DELIVERY_LABELS[r.delivery_state] ?? "غير مخصص للإرسال"}
                    </p>
                    {r.quality_level && (
                      <p className="text-xs">
                        تقييم الجودة: {QUALITY_LEVELS[r.quality_level as QualityLevel].label} ·{" "}
                        {r.quality_score}/10 ·{" "}
                        {r.is_quality_signal ? "إشارة جديدة" : "دخول متكرر — لا يحتسب إشارة جديدة"}
                        {r.value != null && (
                          <>
                            {" "}
                            · القيمة: {r.value} {r.currency}
                          </>
                        )}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      الجوال: <span dir="ltr">{r.contact_phone ?? "غير مسجل"}</span> · مرجع الفرصة:{" "}
                      <span dir="ltr">{r.opportunity_id}</span>
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
