import { useState } from "react";
import { Plus, Settings2, Trash2, X } from "lucide-react";
import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import {
  MAX_OPTION_GROUPS,
  activeGroups,
  combinations,
  comboKey,
  comboLabel,
  emptyComboStock,
  optionDefinitions,
  type ComboStock,
  type OptionsDraft,
} from "@/modules/commerce/product-options";
import { ProductAttributeFields } from "./product-attribute-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * One place for a new product's options and stock, like Shopify: name an option (اللون), add its
 * values (أحمر، أسود), and every combination gets its own quantity. Batch number, expiry date, extra
 * batches and other stock properties stay available under «متقدم» for each row.
 */
export function ProductOptionsBuilder({
  draft,
  onChange,
  definitions,
  currency,
  canStock,
  disabled,
}: {
  draft: OptionsDraft;
  onChange: (draft: OptionsDraft) => void;
  definitions: AttributeDefinition[];
  currency: string;
  canStock: boolean;
  disabled: boolean;
}) {
  const choices = optionDefinitions(definitions);
  // Choice properties (اللون، المقاس) are added as options above; other stock properties (e.g. a number)
  // are still filled per row under «متقدم».
  const extraDefinitions = definitions.filter(
    (d) => d.scope === "variant" && !["select", "multiselect"].includes(d.kind),
  );
  const combos = combinations(draft.groups);
  const hasOptions = activeGroups(draft.groups).length > 0;

  const setGroups = (groups: OptionsDraft["groups"]) => onChange({ ...draft, groups });
  const setStock = (key: string, patch: Partial<ComboStock>) =>
    onChange({ ...draft, stock: { ...draft.stock, [key]: { ...(draft.stock[key] ?? emptyComboStock()), ...patch } } });

  return (
    <section className="space-y-3 rounded-lg border p-3" data-validation-scope>
      <div>
        <Label className="text-base">الألوان والمقاسات والكميات</Label>
        <p className="text-xs text-muted-foreground mt-1">
          إذا كان للمنتج ألوان أو مقاسات أضفها هنا، وسننشئ كل التركيبات تلقائيًا لتكتب كمية كل واحدة.
        </p>
      </div>

      <fieldset disabled={disabled} className="space-y-3">
        {draft.groups.map((group, index) => (
          <OptionGroupEditor
            key={group.key}
            index={index}
            group={group}
            choices={choices}
            takenNames={draft.groups.filter((g) => g.key !== group.key).map((g) => g.name.trim())}
            onChange={(next) => setGroups(draft.groups.map((g) => (g.key === group.key ? next : g)))}
            onRemove={() => setGroups(draft.groups.filter((g) => g.key !== group.key))}
          />
        ))}

        {draft.groups.length < MAX_OPTION_GROUPS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setGroups([...draft.groups, { key: crypto.randomUUID(), name: "", values: [] }])}
          >
            <Plus className="h-4 w-4" />
            {draft.groups.length ? "إضافة خيار آخر" : "إضافة خيار مثل اللون أو المقاس"}
          </Button>
        )}

        <div className="space-y-2">
          {hasOptions && (
            <div className="text-xs text-muted-foreground">
              {combos.length} تركيبة — ألغِ تحديد أي تركيبة غير متوفرة.
            </div>
          )}
          {combos.map((values) => {
            const key = comboKey(values);
            return (
              <ComboRow
                key={key}
                label={hasOptions ? comboLabel(values) : "الكمية المتوفرة"}
                showInclude={hasOptions}
                stock={draft.stock[key] ?? emptyComboStock()}
                onChange={(patch) => setStock(key, patch)}
                extraDefinitions={extraDefinitions}
                currency={currency}
                canStock={canStock}
              />
            );
          })}
          {!canStock && (
            <p className="text-xs text-muted-foreground">إدخال الكميات يحتاج صلاحية إدارة المخزون؛ ستُنشأ التركيبات بدون كمية.</p>
          )}
          {!hasOptions && canStock && (
            <p className="text-xs text-muted-foreground">اتركها فارغة إذا كنت تضيف خدمة أو منتجًا دون مخزون.</p>
          )}
        </div>
      </fieldset>
    </section>
  );
}

function OptionGroupEditor({
  index,
  group,
  choices,
  takenNames,
  onChange,
  onRemove,
}: {
  index: number;
  group: OptionsDraft["groups"][number];
  choices: AttributeDefinition[];
  takenNames: string[];
  onChange: (group: OptionsDraft["groups"][number]) => void;
  onRemove: () => void;
}) {
  const [input, setInput] = useState("");
  const existing = choices.find((c) => c.name.trim() === group.name.trim());
  const suggestions = (existing?.options ?? []).filter((o) => !group.values.includes(o));
  const listId = `option-names-${group.key}`;

  const addValues = (text: string) => {
    const added = text.split(/[،,]/).map((v) => v.trim()).filter(Boolean);
    if (!added.length) return;
    onChange({ ...group, values: [...new Set([...group.values, ...added])] });
    setInput("");
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor={`${listId}-name`}>اسم الخيار {index + 1}</Label>
          <Input
            id={`${listId}-name`}
            list={listId}
            value={group.name}
            placeholder="مثال: اللون، المقاس، السعة"
            onChange={(e) => onChange({ ...group, name: e.target.value })}
            onKeyDown={(e) => {
              // Enter moves on to the values instead of submitting the whole product form.
              if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById(`${listId}-value`)?.focus();
              }
            }}
          />
          <datalist id={listId}>
            {choices
              .filter((c) => !takenNames.includes(c.name.trim()))
              .map((c) => (
                <option key={c.id} value={c.name} />
              ))}
          </datalist>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={`حذف الخيار ${index + 1}`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${listId}-value`}>القيم</Label>
        {group.values.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {group.values.map((value) => (
              <span key={value} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium">
                {value}
                <button
                  type="button"
                  aria-label={`إزالة ${value}`}
                  className="rounded-full hover:bg-primary/20"
                  onClick={() => onChange({ ...group, values: group.values.filter((v) => v !== value) })}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            id={`${listId}-value`}
            value={input}
            placeholder="اكتب قيمة واضغط Enter (مثال: أحمر)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addValues(input);
              }
            }}
            onBlur={() => addValues(input)}
          />
          <Button type="button" variant="outline" onClick={() => addValues(input)}>
            إضافة
          </Button>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">قيم محفوظة:</span>
            {suggestions.map((value) => (
              <button
                key={value}
                type="button"
                className="rounded-full border border-dashed px-2.5 py-0.5 text-xs hover:bg-accent"
                onClick={() => onChange({ ...group, values: [...group.values, value] })}
              >
                + {value}
              </button>
            ))}
          </div>
        )}
      </div>
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
