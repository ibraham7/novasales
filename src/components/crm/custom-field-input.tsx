import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { FieldDef } from "@/modules/crm/custom-fields.server";

interface Props {
  def: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}

export function CustomFieldInput({ def, value, onChange, disabled }: Props) {
  const readOnly = disabled || def.read_only;
  const commonId = `cf-${def.key}`;

  const label = (
    <Label htmlFor={commonId} className="text-xs font-medium flex items-center gap-1">
      {def.label}
      {def.is_required && <span className="text-red-500">*</span>}
    </Label>
  );

  switch (def.field_type) {
    case "text":
    case "email":
    case "phone":
      return (
        <div className="space-y-1">
          {label}
          <Input
            id={commonId}
            type={def.field_type === "email" ? "email" : def.field_type === "phone" ? "tel" : "text"}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={readOnly}
          />
        </div>
      );
    case "number":
      return (
        <div className="space-y-1">
          {label}
          <Input
            id={commonId}
            type="number"
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            disabled={readOnly}
          />
        </div>
      );
    case "date":
      return (
        <div className="space-y-1">
          {label}
          <Input
            id={commonId}
            type="date"
            value={typeof value === "string" ? value.slice(0, 10) : ""}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={readOnly}
          />
        </div>
      );
    case "boolean":
      return (
        <div className="flex items-center justify-between gap-2 py-1">
          {label}
          <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={readOnly} />
        </div>
      );
    case "select":
      return (
        <div className="space-y-1">
          {label}
          <Select
            value={(value as string) ?? ""}
            onValueChange={(v) => onChange(v || null)}
            disabled={readOnly}
          >
            <SelectTrigger id={commonId}>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {def.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1">
          {label}
          <div className="flex flex-wrap gap-1 min-h-9 border rounded-md p-2">
            {selected.map((v) => {
              const opt = def.options.find((o) => o.value === v);
              return (
                <Badge key={v} variant="secondary" className="gap-1">
                  {opt?.label ?? v}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onChange(selected.filter((x) => x !== v))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              );
            })}
          </div>
          {!readOnly && (
            <Select
              value=""
              onValueChange={(v) => {
                if (v && !selected.includes(v)) onChange([...selected, v]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="أضف خياراً..." />
              </SelectTrigger>
              <SelectContent>
                {def.options
                  .filter((o) => !selected.includes(o.value))
                  .map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

interface SectionProps {
  defs: FieldDef[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

export function CustomFieldsSection({ defs, values, onChange, disabled }: SectionProps) {
  if (!defs.length) return null;
  const groups = new Map<string, FieldDef[]>();
  for (const d of defs) {
    if (!d.is_active) continue;
    const g = d.field_group || "General";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(d);
  }
  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([group, list]) => (
        <div key={group} className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase">{group}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {list.map((def) => (
              <CustomFieldInput
                key={def.id}
                def={def}
                value={values[def.key]}
                onChange={(v) => onChange({ ...values, [def.key]: v })}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
