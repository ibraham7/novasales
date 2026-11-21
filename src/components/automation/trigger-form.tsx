import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EVENT_OPTIONS, DURATION_UNITS, joinDuration, splitDuration, type DurationUnit } from "@/modules/workflow/labels";
import { STOP_REASONS, isTimeEvent } from "@/modules/workflow/trigger-config";

export type StageOption = { id: string; name: string; pipeline: string };

const GROUPS = ["عملاء وتذاكر", "رسائل", "زمنية"] as const;
const ANY = "__any__";

/** The trigger of a workflow: which event, how long (for the time ones), which stage, and when to stop. */
export function TriggerForm({ triggerType, onTriggerType, config, onConfig, stages }: {
  triggerType: "event" | "manual" | "schedule";
  onTriggerType: (t: "event" | "manual") => void;
  config: Record<string, any>;
  onConfig: (next: Record<string, any>) => void;
  stages: StageOption[];
}) {
  const set = (patch: Record<string, any>) => onConfig({ ...config, ...patch });
  const event = String(config.event ?? "");
  const time = isTimeEvent(event);
  const { amount, unit } = splitDuration(Number(config.after_minutes ?? 0));
  const stops: string[] = Array.isArray(config.stop_on) ? config.stop_on : [];
  const toggleStop = (reason: string, on: boolean) => {
    const next = on ? [...new Set([...stops, reason])] : stops.filter((r) => r !== reason);
    const { stop_on: _drop, ...rest } = config;
    onConfig(next.length ? { ...rest, stop_on: next } : rest);
  };
  const setDuration = (nextAmount: number, nextUnit: DurationUnit) => set({ after_minutes: joinDuration(Number.isFinite(nextAmount) ? nextAmount : 0, nextUnit) });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>متى تعمل الأتمتة</Label>
          <Select value={triggerType === "manual" ? "manual" : "event"} onValueChange={(v) => onTriggerType(v as "event" | "manual")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="event">عند حدوث شيء (حدث)</SelectItem>
              <SelectItem value="manual">يدوياً فقط</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {triggerType === "event" && (
          <div>
            <Label>الحدث</Label>
            <Select value={event} onValueChange={(v) => { const { after_minutes: _a, stage_id: _s, ...rest } = config; onConfig({ ...rest, event: v, ...(v === "time.daily_digest" ? { hour: 9 } : {}) }); }}>
              <SelectTrigger><SelectValue placeholder="اختر الحدث" /></SelectTrigger>
              <SelectContent>
                {GROUPS.map((group) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {EVENT_OPTIONS.filter((e) => e.group === group).map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {triggerType === "event" && time && (
        <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-3">
          {event === "time.daily_digest" ? (
            <div>
              <Label className="text-xs">ساعة الإرسال (0–23، بتوقيت المؤسسة)</Label>
              <Input type="number" min={0} max={23} value={config.hour ?? 9} onChange={(e) => onConfig({ ...config, hour: Number(e.target.value) })} />
            </div>
          ) : (<>
          <div>
            <Label className="text-xs">{event === "time.task_overdue" ? "بعد التأخير بـ (اختياري)" : "بعد مدة"}</Label>
            <Input type="number" min={0} value={amount || ""} onChange={(e) => setDuration(Number(e.target.value), unit)} />
          </div>
          <div>
            <Label className="text-xs">الوحدة</Label>
            <Select value={unit} onValueChange={(u) => setDuration(amount, u as DurationUnit)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DURATION_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {["time.stage_timeout", "time.no_reply", "time.stale"].includes(event) && (
            <div>
              <Label className="text-xs">في مرحلة</Label>
              <Select value={config.stage_id ?? ANY} onValueChange={(v) => { const { stage_id: _drop, ...rest } = config; onConfig(v === ANY ? rest : { ...rest, stage_id: v }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>أي مرحلة</SelectItem>
                  {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.pipeline} ← {s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          </>)}
        </div>
      )}

      {triggerType === "event" && (
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="mb-1 text-xs font-medium">أوقف المسار (وهو منتظر) إذا:</div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(STOP_REASONS).map(([reason, label]) => (
              <label key={reason} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={stops.includes(reason)} onChange={(e) => toggleStop(reason, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
