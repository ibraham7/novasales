import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TicketLabel = { id: string; name: string; color: string };

/** Trello's palette. */
export const LABEL_COLORS = ["#61bd4f", "#f2d600", "#ff9f1a", "#eb5a46", "#c377e0", "#0079bf", "#00c2e0", "#51e898", "#ff78cb", "#344563"];
const DARK_TEXT = new Set(["#f2d600", "#51e898", "#00c2e0", "#ff9f1a"]);

export function LabelChip({ label, selected = true, onClick, small = false }: { label: TicketLabel; selected?: boolean; onClick?: () => void; small?: boolean }) {
  const dark = DARK_TEXT.has(label.color.toLowerCase());
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={label.name}
      style={{ backgroundColor: label.color }}
      className={cn(
        "inline-flex max-w-full items-center truncate rounded font-medium",
        dark ? "text-black/80" : "text-white",
        small ? "h-4 px-1.5 text-[9px]" : "h-6 px-2.5 text-xs",
        onClick && "transition-opacity hover:opacity-100",
        !selected && "opacity-40",
        selected && onClick && "ring-2 ring-offset-1 ring-foreground/40",
      )}
    >
      {label.name}
    </Tag>
  );
}

/** Pick any number of the organization's labels, or make a new one on the spot. */
export function LabelPicker({ labels, value, onChange, onCreate, creating }: {
  labels: TicketLabel[];
  value: string[];
  onChange: (ids: string[]) => void;
  onCreate: (input: { name: string; color: string }) => Promise<TicketLabel | void>;
  creating?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]!);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const create = async () => {
    if (!name.trim()) return;
    const made = await onCreate({ name: name.trim(), color });
    if (made) onChange([...value, made.id]);
    setName("");
    setAdding(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((l) => (
          <LabelChip key={l.id} label={l} selected={value.includes(l.id)} onClick={() => toggle(l.id)} />
        ))}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-6 items-center gap-1 rounded border border-dashed px-2 text-xs text-muted-foreground hover:bg-muted">
            <Plus className="h-3 w-3" /> ليبل
          </button>
        )}
      </div>
      {adding && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <Input aria-label="اسم الليبل" placeholder="اسم الليبل" className="h-8" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } }} />
            <button type="button" aria-label="إلغاء" onClick={() => setAdding(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LABEL_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`لون ${c}`} onClick={() => setColor(c)} style={{ backgroundColor: c }} className={cn("h-5 w-8 rounded", color === c && "ring-2 ring-offset-1 ring-foreground/60")} />
            ))}
          </div>
          <Button type="button" size="sm" disabled={!name.trim() || creating} onClick={() => void create()}>إنشاء الليبل</Button>
        </div>
      )}
    </div>
  );
}
