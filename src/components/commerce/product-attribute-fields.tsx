import { Input } from "@/components/ui/input";
import type { AttributeDefinition, AttributeValue } from "@/modules/commerce/product-attributes";
const selectClass = "w-full border rounded-md bg-background px-3 py-2 text-sm";
export function ProductAttributeFields({
  definitions,
  values,
  onChange,
  currency,
}: {
  definitions: AttributeDefinition[];
  values: Record<string, AttributeValue>;
  onChange: (values: Record<string, AttributeValue>) => void;
  currency?: string;
}) {
  return (
    <div className="space-y-3">
      {definitions.map((def) => (
        <div key={def.id} className="space-y-1">
          <label className="flex gap-2 items-center text-sm">
            <input
              type="checkbox"
              checked={def.id in values}
              onChange={(e) => {
                const next = { ...values };
                if (e.target.checked)
                  next[def.id] =
                    def.kind === "boolean" ? false : def.kind === "multiselect"
                      ? []
                      : ["number", "money"].includes(def.kind)
                        ? 0
                        : "";
                else delete next[def.id];
                onChange(next);
              }}
            />
            {def.name}
            {def.kind === "money" ? ` (${currency ?? ""})` : ""}
            {def.is_price_floor ? " — حد أدنى للبيع" : ""}
          </label>
          {def.id in values &&
            (def.kind === "boolean" ? (
              <select aria-label={def.name} className={selectClass} value={String(values[def.id])} onChange={e => onChange({...values,[def.id]:e.target.value === "true"})}><option value="true">نعم</option><option value="false">لا</option></select>
            ) : def.kind === "select" ? (
              <select
                className={selectClass}
                aria-label={def.name}
                value={String(values[def.id])}
                onChange={(e) => onChange({ ...values, [def.id]: e.target.value })}
              >
                <option value="">اختر قيمة</option>
                {def.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : def.kind === "multiselect" ? (
              <div className="flex flex-wrap gap-3">
                {def.options.map((o) => (
                  <label key={o} className="flex gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={(values[def.id] as string[]).includes(o)}
                      onChange={(e) => {
                        const old = values[def.id] as string[];
                        onChange({
                          ...values,
                          [def.id]: e.target.checked ? [...old, o] : old.filter((v) => v !== o),
                        });
                      }}
                    />
                    {o}
                  </label>
                ))}
              </div>
            ) : (
              <Input
                aria-label={def.name}
                placeholder={def.kind === "file" ? "رابط مباشر للملف (HTTPS)" : undefined}
                type={
                  def.kind === "date"
                    ? "date"
                    : ["number", "money"].includes(def.kind)
                      ? "number"
                      : ["url", "file"].includes(def.kind) ? "url" : "text"
                }
                step={["number", "money"].includes(def.kind) ? "any" : undefined}
                min={def.kind === "money" ? 0 : undefined}
                value={values[def.id] as string | number}
                onChange={(e) =>
                  onChange({
                    ...values,
                    [def.id]: ["number", "money"].includes(def.kind)
                      ? e.target.value === ""
                        ? ""
                        : Number(e.target.value)
                      : e.target.value,
                  })
                }
              />
            ))}
        </div>
      ))}
    </div>
  );
}
