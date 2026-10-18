import { useState } from "react";
import { Plus, Settings2, X } from "lucide-react";
import type { AttributeDefinition, AttributeValue } from "@/modules/commerce/product-attributes";
import {
  MAX_OPTION_GROUPS,
  activeGroups,
  combinations,
  comboKey,
  comboLabel,
  emptyComboStock,
  type ComboStock,
  type OptionGroup,
  type OptionsDraft,
  type SpecDraft,
} from "@/modules/commerce/product-options";
import { ProductAttributeFields } from "./product-attribute-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Kind = AttributeDefinition["kind"];
const OTHER_TYPES: [Kind, string][] = [
  ["text", "نص"],
  ["number", "رقم"],
  ["money", "مبلغ / سعر"],
  ["date", "تاريخ"],
  ["boolean", "نعم / لا"],
  ["url", "رابط"],
  ["file", "رابط ملف"],
];
const isList = (kind: Kind) => kind === "select" || kind === "multiselect";

function displayValue(value: AttributeValue) {
  if (Array.isArray(value)) return value.join("، ");
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  return String(value);
}

/**
 * The product's properties in one place: one «إضافة خاصية» button opens a small dialog. A property with
 * «كمية لكل قيمة» (اللون، المقاس) becomes stock combinations with their own quantities; otherwise it is
 * a specification of the product (الخامة: قطن). Batch number, expiry date and extra batches stay
 * under ⚙ on each quantity row.
 */
export function ProductPropertiesSection({
  isNew,
  options,
  onOptionsChange,
  specs,
  onSpecsChange,
  attributes,
  onAttributesChange,
  definitions,
  currency,
  canStock,
  disabled,
}: {
  isNew: boolean;
  options: OptionsDraft;
  onOptionsChange: (draft: OptionsDraft) => void;
  specs: SpecDraft[];
  onSpecsChange: (specs: SpecDraft[]) => void;
  attributes: Record<string, AttributeValue>;
  onAttributesChange: (values: Record<string, AttributeValue>) => void;
  definitions: AttributeDefinition[];
  currency: string;
  canStock: boolean;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState<{ key?: string } | null>(null);
  const groups = activeGroups(options.groups);
  const combos = combinations(options.groups);
  // Other stock properties (e.g. a number) are still filled per quantity row under ⚙.
  const extraDefinitions = definitions.filter((d) => d.scope === "variant" && !isList(d.kind));
  const usedNames = [
    ...groups.map((g) => g.name),
    ...specs.map((s) => s.name.trim()),
    ...Object.keys(attributes).map((id) => definitions.find((d) => d.id === id)?.name ?? ""),
  ];
  const editingGroup = options.groups.find((g) => g.key === editing?.key);
  const editingSpec = specs.find((s) => s.key === editing?.key);

  const setStock = (key: string, patch: Partial<ComboStock>) =>
    onOptionsChange({ ...options, stock: { ...options.stock, [key]: { ...(options.stock[key] ?? emptyComboStock()), ...patch } } });

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-semibold">الخصائص</Label>
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={disabled} onClick={() => setEditing({})}>
          <Plus className="h-3.5 w-3.5" />
          إضافة خاصية
        </Button>
      </div>

      {(options.groups.length > 0 || specs.length > 0 || Object.keys(attributes).length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {options.groups.map((g) => (
            <PropertyChip
              key={g.key}
              label={`${g.name}: ${g.values.join("، ")}`}
              stock
              onEdit={() => setEditing({ key: g.key })}
              onRemove={() => onOptionsChange({ ...options, groups: options.groups.filter((x) => x.key !== g.key) })}
            />
          ))}
          {specs.map((s) => (
            <PropertyChip
              key={s.key}
              label={`${s.name}: ${isList(s.kind) ? s.values.join("، ") : s.kind === "boolean" ? (s.scalar === "true" ? "نعم" : "لا") : s.scalar}`}
              onEdit={() => setEditing({ key: s.key })}
              onRemove={() => onSpecsChange(specs.filter((x) => x.key !== s.key))}
            />
          ))}
          {Object.entries(attributes).map(([id, value]) => (
            <PropertyChip
              key={id}
              label={`${definitions.find((d) => d.id === id)?.name ?? "خاصية"}: ${displayValue(value)}`}
              onRemove={() => {
                const next = { ...attributes };
                delete next[id];
                onAttributesChange(next);
              }}
            />
          ))}
        </div>
      )}

      {isNew && canStock && (
        <div className="space-y-1.5">
          {combos.map((values) => {
            const key = comboKey(values);
            return (
              <ComboRow
                key={key}
                label={groups.length ? comboLabel(values) : "الكمية"}
                showInclude={groups.length > 0}
                stock={options.stock[key] ?? emptyComboStock()}
                onChange={(patch) => setStock(key, patch)}
                extraDefinitions={extraDefinitions}
                currency={currency}
                canStock={canStock}
              />
            );
          })}
        </div>
      )}

      {editing && (
        <PropertyDialog
          allowStock={isNew}
          stockFull={!editingGroup && options.groups.length >= MAX_OPTION_GROUPS}
          definitions={definitions}
          takenNames={usedNames.filter((n) => n && n !== (editingGroup?.name ?? editingSpec?.name ?? "").trim())}
          initialGroup={editingGroup}
          initialSpec={editingSpec}
          onClose={() => setEditing(null)}
          onSaveGroup={(group) => {
            const exists = options.groups.some((g) => g.key === group.key);
            onOptionsChange({ ...options, groups: exists ? options.groups.map((g) => (g.key === group.key ? group : g)) : [...options.groups, group] });
            if (editingSpec) onSpecsChange(specs.filter((s) => s.key !== group.key));
            setEditing(null);
          }}
          onSaveSpec={(spec) => {
            const exists = specs.some((s) => s.key === spec.key);
            onSpecsChange(exists ? specs.map((s) => (s.key === spec.key ? spec : s)) : [...specs, spec]);
            if (editingGroup) onOptionsChange({ ...options, groups: options.groups.filter((g) => g.key !== spec.key) });
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function PropertyChip({ label, stock, onEdit, onRemove }: { label: string; stock?: boolean; onEdit?: () => void; onRemove: () => void }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${stock ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted"}`}>
      {onEdit ? (
        <button type="button" className="truncate hover:underline" onClick={onEdit}>
          {label}
        </button>
      ) : (
        <span className="truncate">{label}</span>
      )}
      <button type="button" aria-label={`إزالة ${label}`} className="rounded-full p-0.5 hover:bg-background/60" onClick={onRemove}>
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function PropertyDialog({
  allowStock,
  stockFull,
  definitions,
  takenNames,
  initialGroup,
  initialSpec,
  onClose,
  onSaveGroup,
  onSaveSpec,
}: {
  allowStock: boolean;
  stockFull: boolean;
  definitions: AttributeDefinition[];
  takenNames: string[];
  initialGroup?: OptionGroup;
  initialSpec?: SpecDraft;
  onClose: () => void;
  onSaveGroup: (group: OptionGroup) => void;
  onSaveSpec: (spec: SpecDraft) => void;
}) {
  const key = initialGroup?.key ?? initialSpec?.key ?? crypto.randomUUID();
  const [name, setName] = useState(initialGroup?.name ?? initialSpec?.name ?? "");
  const [values, setValues] = useState<string[]>(initialGroup?.values ?? initialSpec?.values ?? []);
  const [input, setInput] = useState("");
  const [perValueStock, setPerValueStock] = useState(allowStock && !stockFull && !initialSpec);
  const [kind, setKind] = useState<Kind>(initialSpec?.kind ?? "select");
  const [scalar, setScalar] = useState(initialSpec?.scalar ?? "");
  const [isPriceFloor, setIsPriceFloor] = useState(initialSpec?.isPriceFloor ?? false);
  const [error, setError] = useState("");

  const existing = definitions.find((d) => d.name.trim() === name.trim());
  // An existing property decides the type; a stock option is always a choice list.
  const effectiveKind: Kind = existing ? existing.kind : perValueStock ? "select" : kind;
  const listKind = isList(effectiveKind);
  const suggestions = (existing?.options ?? []).filter((o) => !values.includes(o));
  const nameSuggestions = definitions.filter((d) => !takenNames.includes(d.name.trim()) && (allowStock || d.scope === "product"));

  const addValues = (text: string) => {
    const added = text.split(/[،,]/).map((v) => v.trim()).filter(Boolean);
    if (!added.length) return;
    setValues((old) => [...new Set([...old, ...added])]);
    setInput("");
  };

  const submit = () => {
    const pending = input.trim() ? [...new Set([...values, ...input.split(/[،,]/).map((v) => v.trim()).filter(Boolean)])] : values;
    const trimmed = name.trim();
    if (!trimmed) return setError("اكتب اسم الخاصية");
    if (takenNames.includes(trimmed)) return setError("هذه الخاصية مضافة للمنتج");
    const stock = existing ? existing.scope === "variant" : perValueStock;
    if (stock && !allowStock) return setError("الخيارات ذات الكمية تُضاف عند إنشاء المنتج؛ استخدم إدارة المخزون للمنتجات الموجودة");
    if (listKind && !pending.length) return setError("أضف قيمة واحدة على الأقل");
    if (!listKind && effectiveKind !== "boolean" && !scalar.trim()) return setError("أدخل القيمة");
    if (stock) onSaveGroup({ key, name: trimmed, values: pending });
    else onSaveSpec({ key, name: trimmed, kind: effectiveKind, values: listKind ? pending : [], scalar, isPriceFloor });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{initialGroup || initialSpec ? "تعديل خاصية" : "إضافة خاصية"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" data-validation-scope>
          <div className="space-y-1">
            <Label htmlFor="property-name">الاسم</Label>
            <Input
              id="property-name"
              list="property-name-options"
              autoFocus
              placeholder="مثال: اللون، المقاس، الخامة"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  document.getElementById("property-values")?.focus();
                }
              }}
            />
            <datalist id="property-name-options">
              {nameSuggestions.map((d) => (
                <option key={d.id} value={d.name} />
              ))}
            </datalist>
          </div>

          {listKind ? (
            <div className="space-y-1.5">
              <Label htmlFor="property-values">القيم</Label>
              {values.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {values.map((value) => (
                    <span key={value} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium">
                      {value}
                      <button type="button" aria-label={`إزالة ${value}`} onClick={() => setValues(values.filter((v) => v !== value))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                id="property-values"
                value={input}
                placeholder="اكتب قيمة واضغط Enter"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    if (!input.trim() && values.length) submit();
                    else addValues(input);
                  }
                }}
              />
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((value) => (
                    <button key={value} type="button" className="rounded-full border border-dashed px-2.5 py-0.5 text-xs hover:bg-accent" onClick={() => setValues([...values, value])}>
                      + {value}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ScalarInput kind={effectiveKind} value={scalar} onChange={setScalar} />
          )}

          {allowStock && !existing && (
            <label className={`flex items-center gap-2 text-sm ${stockFull ? "opacity-50" : ""}`}>
              <input type="checkbox" checked={perValueStock} disabled={stockFull} onChange={(e) => setPerValueStock(e.target.checked)} />
              كمية مستقلة لكل قيمة (مثل اللون والمقاس)
            </label>
          )}

          {!perValueStock && !existing && (
            <details open={!isList(kind)}>
              <summary className="cursor-pointer text-xs text-muted-foreground">نوع قيمة آخر (رقم، تاريخ، سعر…)</summary>
              <select
                aria-label="نوع القيمة"
                className="mt-2 w-full rounded-md border bg-background p-2 text-sm"
                value={isList(kind) ? "select" : kind}
                onChange={(e) => {
                  setKind(e.target.value as Kind);
                  setScalar("");
                }}
              >
                <option value="select">قائمة قيم</option>
                {OTHER_TYPES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              {kind === "money" && (
                <label className="mt-2 flex gap-2 text-sm">
                  <input type="checkbox" checked={isPriceFloor} onChange={(e) => setIsPriceFloor(e.target.checked)} />
                  حد أدنى للبيع (سعر التكلفة)
                </label>
              )}
            </details>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" onClick={submit}>
            {initialGroup || initialSpec ? "حفظ" : "إضافة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScalarInput({ kind, value, onChange }: { kind: Kind; value: string; onChange: (value: string) => void }) {
  if (kind === "boolean")
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
        نعم
      </label>
    );
  return (
    <div className="space-y-1">
      <Label htmlFor="property-scalar">القيمة</Label>
      <Input
        id="property-scalar"
        type={kind === "date" ? "date" : kind === "number" || kind === "money" ? "number" : kind === "url" || kind === "file" ? "url" : "text"}
        inputMode={kind === "number" || kind === "money" ? "decimal" : undefined}
        dir={kind === "url" || kind === "file" ? "ltr" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ComboRow({
  label,
  showInclude,
  stock,
  onChange,
  extraDefinitions,
  currency,
  canStock,
}: {
  label: string;
  showInclude: boolean;
  stock: ComboStock;
  onChange: (patch: Partial<ComboStock>) => void;
  extraDefinitions: AttributeDefinition[];
  currency: string;
  canStock: boolean;
}) {
  const [advanced, setAdvanced] = useState(
    !!stock.batchCode || !!stock.expiresOn || stock.extraBatches.length > 0 || Object.keys(stock.extraAttributes).length > 0,
  );
  const off = showInclude && !stock.included;

  return (
    <div className={`rounded-md border p-2 ${off ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2">
        {showInclude && (
          <input
            type="checkbox"
            aria-label={`تضمين ${label}`}
            checked={stock.included}
            onChange={(e) => onChange({ included: e.target.checked })}
          />
        )}
        <span className="flex-1 text-sm font-medium">{label}</span>
        {canStock && (
          <Input
            className="w-28 h-8"
            inputMode="decimal"
            aria-label={`كمية ${label}`}
            placeholder="الكمية"
            disabled={off}
            value={stock.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        )}
        {(canStock || extraDefinitions.length > 0) && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`خيارات متقدمة لـ ${label}`}
            aria-expanded={advanced}
            disabled={off}
            onClick={() => setAdvanced(!advanced)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {advanced && !off && (
        <div className="mt-2 space-y-3 border-t pt-2">
          {canStock && (
            <>
              <div className="grid sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">رقم الدفعة (اختياري — يُرقّم تلقائيًا)</Label>
                  <Input className="h-8" value={stock.batchCode} onChange={(e) => onChange({ batchCode: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">تاريخ الانتهاء (اختياري)</Label>
                  <Input className="h-8" type="date" value={stock.expiresOn} onChange={(e) => onChange({ expiresOn: e.target.value })} />
                </div>
              </div>
              {stock.extraBatches.map((batch, i) => (
                <div key={batch.key} className="grid grid-cols-[1fr_1fr_6rem_auto] gap-2 items-end">
                  <div>
                    <Label className="text-xs">دفعة إضافية {i + 1}</Label>
                    <Input className="h-8" placeholder="رقم الدفعة" value={batch.batchCode} onChange={(e) => onChange({ extraBatches: stock.extraBatches.map((b) => (b.key === batch.key ? { ...b, batchCode: e.target.value } : b)) })} />
                  </div>
                  <Input className="h-8" type="date" aria-label="تاريخ انتهاء الدفعة" value={batch.expiresOn} onChange={(e) => onChange({ extraBatches: stock.extraBatches.map((b) => (b.key === batch.key ? { ...b, expiresOn: e.target.value } : b)) })} />
                  <Input className="h-8" inputMode="decimal" aria-label="كمية الدفعة" placeholder="الكمية" value={batch.quantity} onChange={(e) => onChange({ extraBatches: stock.extraBatches.map((b) => (b.key === batch.key ? { ...b, quantity: e.target.value } : b)) })} />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="حذف الدفعة" onClick={() => onChange({ extraBatches: stock.extraBatches.filter((b) => b.key !== batch.key) })}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange({ extraBatches: [...stock.extraBatches, { key: crypto.randomUUID(), batchCode: "", expiresOn: "", quantity: "" }] })}
              >
                إضافة دفعة بتاريخ انتهاء مختلف
              </Button>
            </>
          )}
          {extraDefinitions.length > 0 && (
            <ProductAttributeFields
              definitions={extraDefinitions}
              values={stock.extraAttributes}
              currency={currency}
              onChange={(extraAttributes) => onChange({ extraAttributes })}
            />
          )}
        </div>
      )}
    </div>
  );
}
