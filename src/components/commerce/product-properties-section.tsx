import { useState } from "react";
import { Plus, Settings2, X } from "lucide-react";
import type { AttributeDefinition, AttributeValue } from "@/modules/commerce/product-attributes";
import {
  MAX_OPTION_GROUPS,
  READY_PROPERTIES,
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
import { SCOPES, ValuesInput } from "./product-property-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toLatinDigits } from "@/lib/utils";

type Kind = AttributeDefinition["kind"];
type Scope = AttributeDefinition["scope"];
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
  allowStockOptions = isNew,
  lockedOptions = {},
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
  /** Whether options with their own quantity can be added (a new product, or an existing one from its stock). */
  allowStockOptions?: boolean;
  /** Values an existing product already has for each option (by option key); they cannot be removed. */
  lockedOptions?: Record<string, string[]>;
}) {
  const [editing, setEditing] = useState<{ key?: string } | null>(null);
  const groups = activeGroups(options.groups);
  const combos = combinations(options.groups);
  // Other stock properties (e.g. a number) are still filled per quantity row under ⚙.
  const extraDefinitions = definitions.filter((d) => d.scope === "variant" && !isList(d.kind) && !d.is_archived);
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
              onRemove={
                lockedOptions[g.key]
                  ? undefined
                  : () => onOptionsChange({ ...options, groups: options.groups.filter((x) => x.key !== g.key) })
              }
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

      {isNew && canStock && groups.length > 0 && (
        <div className="space-y-1.5">
          <StockTotals options={options} combos={combos} />
          {combos.map((values) => {
            const key = comboKey(values);
            return (
              <ComboRow
                key={key}
                label={comboLabel(values)}
                showInclude
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
          allowStock={allowStockOptions}
          stockFull={!editingGroup && options.groups.length >= MAX_OPTION_GROUPS}
          lockedValues={editingGroup ? lockedOptions[editingGroup.key] : undefined}
          blockNewStock={Object.keys(lockedOptions).length > 0}
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

/**
 * The stock of a new product that has no options with their own quantity. It sits with the price;
 * batch number, expiry date and extra batches stay under ⚙. Hidden once such an option is added.
 */
export function ProductQuantityField({
  options,
  onOptionsChange,
  definitions,
  currency,
}: {
  options: OptionsDraft;
  onOptionsChange: (draft: OptionsDraft) => void;
  definitions: AttributeDefinition[];
  currency: string;
}) {
  if (activeGroups(options.groups).length) return null;
  const key = comboKey([]);
  return (
    <ComboRow
      label="الكمية في المخزن (اختياري)"
      showInclude={false}
      stock={options.stock[key] ?? emptyComboStock()}
      onChange={(patch) =>
        onOptionsChange({ ...options, stock: { ...options.stock, [key]: { ...(options.stock[key] ?? emptyComboStock()), ...patch } } })
      }
      extraDefinitions={definitions.filter((d) => d.scope === "variant" && !isList(d.kind) && !d.is_archived)}
      currency={currency}
      canStock
    />
  );
}

/**
 * With options, the quantity is entered per row. A quantity typed before adding the options is kept
 * and shown, with what is already spread over the rows, so it is not lost.
 */
function StockTotals({ options, combos }: { options: OptionsDraft; combos: string[][] }) {
  const earlier = options.stock[comboKey([])]?.quantity.trim() ?? "";
  const spread = combos.reduce((sum, values) => {
    const stock = options.stock[comboKey(values)];
    return sum + (stock?.included === false ? 0 : Number(stock?.quantity) || 0);
  }, 0);
  if (!earlier && !spread) return null;
  const target = Number(earlier);
  return (
    <p className={`rounded-md px-2 py-1.5 text-xs ${earlier && spread !== target ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-muted text-muted-foreground"}`}>
      {earlier ? (
        <>
          كتبت الكمية <b>{earlier}</b> قبل إضافة الخيارات؛ وزّعها على السطور تحت — الموزّع حتى الآن: <b>{spread}</b>
        </>
      ) : (
        <>
          مجموع الكميات: <b>{spread}</b>
        </>
      )}
    </p>
  );
}

function PropertyChip({ label, stock, onEdit, onRemove }: { label: string; stock?: boolean; onEdit?: () => void; onRemove?: () => void }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${stock ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted"}`}>
      {onEdit ? (
        <button type="button" className="truncate hover:underline" onClick={onEdit}>
          {label}
        </button>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {onRemove && (
        <button type="button" aria-label={`إزالة ${label}`} className="rounded-full p-0.5 hover:bg-background/60" onClick={onRemove}>
          <X className="h-3 w-3" />
        </button>
      )}
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
  lockedValues = [],
  blockNewStock = false,
}: {
  allowStock: boolean;
  stockFull: boolean;
  lockedValues?: string[];
  /** The product already has options: values can be added to them, but no new option. */
  blockNewStock?: boolean;
  definitions: AttributeDefinition[];
  takenNames: string[];
  initialGroup?: OptionGroup;
  initialSpec?: SpecDraft;
  onClose: () => void;
  onSaveGroup: (group: OptionGroup) => void;
  onSaveSpec: (spec: SpecDraft) => void;
}) {
  const key = initialGroup?.key ?? initialSpec?.key ?? crypto.randomUUID();
  const editing = !!(initialGroup || initialSpec);
  const canStock = allowStock && (!stockFull || !!initialGroup);
  const [name, setName] = useState(initialGroup?.name ?? initialSpec?.name ?? "");
  const [values, setValues] = useState<string[]>(initialGroup?.values ?? initialSpec?.values ?? []);
  const [scope, setScope] = useState<Scope>(initialGroup || (canStock && !initialSpec) ? "variant" : "product");
  const [kind, setKind] = useState<Kind>(initialSpec?.kind ?? "select");
  const [scalar, setScalar] = useState(initialSpec?.scalar ?? "");
  const [isPriceFloor, setIsPriceFloor] = useState(initialSpec?.isPriceFloor ?? false);
  const [applied, setApplied] = useState<string[]>([]);
  const [error, setError] = useState("");

  const existing = definitions.find((d) => d.name.trim() === name.trim());
  // A saved property keeps its own kind and scope; a new stock option is always a list of values.
  const effectiveScope: Scope = existing ? existing.scope : scope;
  const effectiveKind: Kind = existing ? existing.kind : scope === "variant" ? "select" : kind;
  const listKind = isList(effectiveKind);
  const templates = READY_PROPERTIES.filter((p) => p.stock === (effectiveScope === "variant"));
  const suggestions = [
    ...new Set([...(existing?.options ?? []), ...templates.filter((t) => applied.includes(t.label)).flatMap((t) => t.values)]),
  ];
  // The organization's saved properties as one-tap buttons.
  const saved = editing
    ? []
    : definitions.filter((d) => !d.is_archived && !takenNames.includes(d.name.trim()) && (allowStock || d.scope === "product"));

  const pick = (d: AttributeDefinition) => {
    setName(d.name);
    setValues(isList(d.kind) ? d.options : []);
    setScalar("");
    setError("");
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      // The name is at the top of the dialog; bring it into view so the message is seen.
      const field = document.getElementById("property-name");
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.focus();
      return setError("اكتب اسم الخاصية");
    }
    if (takenNames.includes(trimmed)) return setError("هذه الخاصية مضافة للمنتج");
    const stock = effectiveScope === "variant";
    if (stock && !allowStock) return setError("إضافة خيارات لها كمية تحتاج صلاحية المخزون");
    if (stock && !canStock) return setError("يمكن إضافة 3 خيارات لها كمية كحد أقصى");
    if (stock && blockNewStock && !initialGroup)
      return setError("هذا المنتج له خيارات؛ اضغط على الخيار الموجود لإضافة قيم جديدة له");
    if (listKind && !values.length) return setError("أضف قيمة واحدة على الأقل");
    if (!listKind && effectiveKind !== "boolean" && !scalar.trim()) return setError("أدخل القيمة");
    if (stock) onSaveGroup({ key, name: trimmed, values });
    else onSaveSpec({ key, name: trimmed, kind: effectiveKind, values: listKind ? values : [], scalar, isPriceFloor });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل خاصية" : "إضافة خاصية"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4" data-validation-scope>
          {saved.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">خصائصك المحفوظة</p>
              <div className="flex flex-wrap gap-1.5">
                {saved.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent ${existing?.id === d.id ? "border-primary bg-primary/10 text-primary" : ""}`}
                    onClick={() => pick(d)}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="property-name">{saved.length > 0 ? "أو خاصية جديدة — اسم الخاصية" : "اسم الخاصية"}</Label>
            <Input
              id="property-name"
              autoFocus
              placeholder="مثال: لون الغطاء، مقاس البنطلون"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
            {error === "اكتب اسم الخاصية" && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {existing ? (
            <p className="text-xs text-muted-foreground">{SCOPES[existing.scope].title} · خاصية محفوظة</p>
          ) : (
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="نوع الخاصية">
              {(["variant", "product"] as Scope[]).map((option) => {
                const off = option === "variant" && !canStock;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={scope === option}
                    disabled={off}
                    className={`rounded-lg border p-2.5 text-start transition-colors disabled:opacity-50 ${scope === option ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                    onClick={() => {
                      setScope(option);
                      setError("");
                    }}
                  >
                    <div className="text-sm font-medium">{SCOPES[option].title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {off ? (allowStock ? "وصلت للحد الأقصى (3)" : "تحتاج صلاحية المخزون") : SCOPES[option].hint}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!existing && scope === "product" && (
            <div className="space-y-1">
              <Label htmlFor="property-kind">نوع القيمة</Label>
              <select
                id="property-kind"
                className="w-full rounded-md border bg-background p-2 text-sm"
                value={isList(kind) ? "select" : kind}
                onChange={(e) => {
                  setKind(e.target.value as Kind);
                  setScalar("");
                  setIsPriceFloor(false);
                }}
              >
                <option value="select">اختيار من قائمة</option>
                {OTHER_TYPES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              {kind === "money" && (
                <label className="flex gap-2 pt-1 text-sm">
                  <input type="checkbox" checked={isPriceFloor} onChange={(e) => setIsPriceFloor(e.target.checked)} />
                  حد أدنى للبيع (سعر التكلفة)
                </label>
              )}
            </div>
          )}

          {!name.trim() ? (
            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">اكتب اسم الخاصية أولًا، ثم أضف قيمها</p>
          ) : listKind ? (
            <ValuesInput
              values={values}
              locked={new Set(lockedValues)}
              suggestions={suggestions}
              templates={templates}
              applied={applied}
              onApply={(t) => {
                setApplied((old) => [...new Set([...old, t.label])]);
                setValues((old) => [...new Set([...old, ...t.values])]);
              }}
              placeholder={effectiveScope === "variant" ? "مثال: أحمر" : "مثال: قطن"}
              onChange={(next) => {
                setValues(next);
                setError("");
              }}
            />
          ) : (
            <ScalarInput kind={effectiveKind} value={scalar} onChange={setScalar} />
          )}

          {error && error !== "اكتب اسم الخاصية" && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" onClick={submit}>
            {editing ? "حفظ" : "إضافة"}
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

export function ComboRow({
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
            onChange={(e) => onChange({ quantity: toLatinDigits(e.target.value) })}
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
                  <Input className="h-8" inputMode="decimal" aria-label="كمية الدفعة" placeholder="الكمية" value={batch.quantity} onChange={(e) => onChange({ extraBatches: stock.extraBatches.map((b) => (b.key === batch.key ? { ...b, quantity: toLatinDigits(e.target.value) } : b)) })} />
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
