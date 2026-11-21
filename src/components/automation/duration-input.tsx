import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DURATION_UNITS, joinDuration, splitDuration, type DurationUnit } from "@/modules/workflow/labels";

/** A length of time as «a number + a unit» (minutes, hours, days); the value is kept in minutes. */
export function DurationInput({ minutes, onChange, label }: { minutes: number; onChange: (minutes: number) => void; label?: string }) {
  const { amount, unit } = splitDuration(Number(minutes) || 0);
  const set = (nextAmount: number, nextUnit: DurationUnit) => onChange(joinDuration(Number.isFinite(nextAmount) ? nextAmount : 0, nextUnit));
  return (
    <div className="flex gap-2" role="group" aria-label={label}>
      <Input type="number" min={1} className="w-28" value={amount || ""} onChange={(e) => set(Number(e.target.value), unit)} />
      <Select value={unit} onValueChange={(u) => set(amount, u as DurationUnit)}>
        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
        <SelectContent>{DURATION_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
