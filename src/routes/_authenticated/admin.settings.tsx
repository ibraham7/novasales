import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllSettings, updateSetting } from "@/modules/superadmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(getAllSettings);
  const saveFn = useServerFn(updateSetting);
  const q = useQuery({ queryKey: ["sa-settings"], queryFn: () => listFn() });

  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (q.data) {
      const map: Record<string, string> = {};
      q.data.forEach((s: any) => { map[s.key] = JSON.stringify(s.value, null, 2); });
      setValues(map);
    }
  }, [q.data]);

  const save = async (key: string) => {
    try {
      const parsed = JSON.parse(values[key] || "null");
      await saveFn({ data: { key, value: parsed } });
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["sa-settings"] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-3">
      {(q.data ?? []).map((s: any) => (
        <Card key={s.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{s.key}</CardTitle>
            {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
          </CardHeader>
          <CardContent>
            <Label className="text-xs">JSON</Label>
            <Textarea
              value={values[s.key] ?? ""}
              onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
              className="font-mono text-xs"
              rows={4}
            />
            <div className="flex justify-end mt-2">
              <Button size="sm" onClick={() => save(s.key)}>حفظ</Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {(q.data ?? []).length === 0 && <div className="text-muted-foreground text-sm">لا توجد إعدادات.</div>}
    </div>
  );
}
