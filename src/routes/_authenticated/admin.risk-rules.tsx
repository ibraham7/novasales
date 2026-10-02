import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { listRiskRules, updateRiskRule } from "@/modules/risk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { SlidersHorizontal } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/risk-rules")({
  head: () => ({
    meta: [
      { title: "قواعد الخطورة - NovaSales" },
      { name: "description", content: "ضبط أوزان وحدود قواعد اكتشاف خطورة أرقام واتساب." },
      { property: "og:title", content: "قواعد الخطورة - NovaSales" },
      { property: "og:description", content: "ضبط أوزان وحدود قواعد اكتشاف خطورة أرقام واتساب." },
    ],
  }),
  component: AdminRiskRules,
});

function AdminRiskRules() {
  const qc = useQueryClient();
  const listFn = useServerFn(listRiskRules);
  const updateFn = useServerFn(updateRiskRule);
  const q = useQuery({ queryKey: ["admin-risk-rules"], queryFn: () => listFn() });

  const save = useMutation({
    mutationFn: (input: { key: string; threshold?: number | null; weight?: number; is_enabled?: boolean }) =>
      updateFn({ data: input }),
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["admin-risk-rules"] });
      qc.invalidateQueries({ queryKey: ["admin-numbers"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground">جاري التحميل...</div>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" /> قواعد الخطورة (Risk Rules)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">
          تُحتسب نقاط الخطورة لكل رقم بجمع أوزان القواعد المُفعّلة التي ينطبق شرطها.
        </div>
        {(q.data ?? []).map((r: any) => (
          <div key={r.key} className="flex flex-wrap items-center gap-3 rounded-md border p-2">
            <div className="flex-1 min-w-[220px] text-sm">{r.label}</div>
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              الحد
              <Input
                type="number"
                defaultValue={r.threshold ?? ""}
                disabled={r.threshold === null}
                className="h-8 w-24"
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== r.threshold) save.mutate({ key: r.key, threshold: v });
                }}
              />
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              الوزن
              <Input
                type="number"
                defaultValue={r.weight}
                className="h-8 w-20"
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v !== r.weight) save.mutate({ key: r.key, weight: v });
                }}
              />
            </label>
            <Switch
              checked={r.is_enabled}
              onCheckedChange={(v) => save.mutate({ key: r.key, is_enabled: v })}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
