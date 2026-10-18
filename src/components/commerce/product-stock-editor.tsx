import { useState } from "react";
import { Settings2, X } from "lucide-react";
import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import { comboKey, comboLabel, emptyComboStock, type ComboStock, type OptionsDraft } from "@/modules/commerce/product-options";
import { newCombinations, optionVariants, type StockBatch, type StockEdits, type StockProduct } from "@/modules/commerce/product-stock-edit";
import { ComboRow } from "./product-properties-section";
import { toLatinDigits } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The stock of an existing product inside its edit dialog: each stock row with its quantity (its
 * batches under ⚙), and rows for newly added option values. Nothing is saved until the product is saved.
 */
export function ProductStockEditor({
  product,
  options,
  onOptionsChange,
  edits,
  onEditsChange,
  definitions,
  currency,
  canStock,
}: {
  product: StockProduct;
  options: OptionsDraft;
  onOptionsChange: (draft: OptionsDraft) => void;
  edits: StockEdits;
  onEditsChange: (edits: StockEdits) => void;
  definitions: AttributeDefinition[];
  currency: string;
  canStock: boolean;
}) {
  const batches = product.sales_stock_batches ?? [];
  const hasOptions = optionVariants(product).length > 0;
  // The plain «أساسي» row is only shown when it holds stock or the product has no options.
  const rows = (product.sales_product_variants ?? []).filter(
    (v) => !v.is_default || !hasOptions || batches.some((b) => b.variant_id === v.id),
  );
  let combos: string[][] = [];
  let comboError = "";
  try {
    combos = newCombinations(options, product, definitions);
  } catch (error) {
    comboError = error instanceof Error ? error.message : "";
  }
  const setStock = (key: string, patch: Partial<ComboStock>) =>
    onOptionsChange({ ...options, stock: { ...options.stock, [key]: { ...(options.stock[key] ?? emptyComboStock()), ...patch } } });

  if (!rows.length && !combos.length && !comboError) return null;
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <Label className="text-sm font-semibold">الكمية في المخزن</Label>
      {rows.map((variant) => (
        <VariantRow
          key={variant.id}
          label={variant.is_default ? (hasOptions ? "بدون خيارات" : "الكمية") : variant.label}
          variantId={variant.id}
          batches={batches.filter((b) => b.variant_id === variant.id)}
          edits={edits}
          onEditsChange={onEditsChange}
          canStock={canStock}
        />
      ))}
      {combos.length > 0 && <p className="pt-1 text-xs font-medium text-primary">جديد</p>}
      {combos.map((values) => {
        const key = comboKey(values);
        return (
          <ComboRow
            key={key}
            label={comboLabel(values)}
            showInclude
            stock={options.stock[key] ?? emptyComboStock()}
            onChange={(patch) => setStock(key, patch)}
            extraDefinitions={definitions.filter((d) => d.scope === "variant" && d.kind !== "select" && d.kind !== "multiselect" && !d.is_archived)}
            currency={currency}
            canStock={canStock}
          />
        );
      })}
      {comboError && <p className="text-sm text-destructive">{comboError}</p>}
    </section>
  );
}

function VariantRow({
  label,
  variantId,
  batches,
  edits,
  onEditsChange,
  canStock,
}: {
  label: string;
  variantId: string;
  batches: StockBatch[];
  edits: StockEdits;
  onEditsChange: (edits: StockEdits) => void;
  canStock: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const added = edits.newBatches.filter((b) => b.variantId === variantId);
  const valid = batches.filter((b) => !b.expires_on || b.expires_on >= today());
  const total = valid.reduce((sum, b) => sum + Number(edits.batches[b.id] ?? b.quantity), 0);
  const single = batches.length === 1 ? batches[0] : undefined;
  const setBatch = (id: string, value: string) => onEditsChange({ ...edits, batches: { ...edits.batches, [id]: toLatinDigits(value) } });
  const setAdded = (key: string, patch: Partial<StockEdits["newBatches"][number]>) =>
    onEditsChange({ ...edits, newBatches: edits.newBatches.map((b) => (b.key === key ? { ...b, ...patch } : b)) });

  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">{label}</span>
        {!canStock ? (
          <span className="text-sm">{total}</span>
        ) : batches.length === 0 ? (
          <Input
            className="h-8 w-28"
            inputMode="decimal"
            aria-label={`كمية ${label}`}
            placeholder="0"
            value={edits.variants[variantId] ?? ""}
            onChange={(e) => onEditsChange({ ...edits, variants: { ...edits.variants, [variantId]: toLatinDigits(e.target.value) } })}
          />
        ) : single ? (
          <Input
            className="h-8 w-28"
            inputMode="decimal"
            aria-label={`كمية ${label}`}
            value={edits.batches[single.id] ?? String(Number(single.quantity))}
            onChange={(e) => setBatch(single.id, e.target.value)}
          />
        ) : (
          <span className="w-28 text-center text-sm" title="عدة دفعات؛ عدّلها من ⚙">
            {total}
          </span>
        )}
        {canStock && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`الدفعات لـ ${label}`}
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {advanced && canStock && (
        <div className="mt-2 space-y-2 border-t pt-2">
          {batches.map((b) => (
            <div key={b.id} className="grid grid-cols-[1fr_6rem] items-center gap-2">
              <span className="text-xs text-muted-foreground">
                دفعة {b.batch_code} · {b.expires_on ? `تنتهي ${b.expires_on}` : "بدون تاريخ انتهاء"}
                {b.expires_on && b.expires_on < today() && <span className="text-destructive"> · منتهية</span>}
              </span>
              <Input
                className="h-8"
                inputMode="decimal"
                aria-label={`كمية الدفعة ${b.batch_code}`}
                value={edits.batches[b.id] ?? String(Number(b.quantity))}
                onChange={(e) => setBatch(b.id, e.target.value)}
              />
            </div>
          ))}
          {added.map((b) => (
            <div key={b.key} className="grid grid-cols-[1fr_1fr_6rem_auto] items-end gap-2">
              <Input className="h-8" placeholder="رقم الدفعة (تلقائي)" aria-label="رقم الدفعة" value={b.batchCode} onChange={(e) => setAdded(b.key, { batchCode: e.target.value })} />
              <Input className="h-8" type="date" aria-label="تاريخ انتهاء الدفعة" value={b.expiresOn} onChange={(e) => setAdded(b.key, { expiresOn: e.target.value })} />
              <Input className="h-8" inputMode="decimal" aria-label="كمية الدفعة" placeholder="الكمية" value={b.quantity} onChange={(e) => setAdded(b.key, { quantity: toLatinDigits(e.target.value) })} />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="حذف الدفعة" onClick={() => onEditsChange({ ...edits, newBatches: edits.newBatches.filter((x) => x.key !== b.key) })}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onEditsChange({ ...edits, newBatches: [...edits.newBatches, { key: crypto.randomUUID(), variantId, batchCode: "", expiresOn: "", quantity: "" }] })
            }
          >
            إضافة دفعة جديدة
          </Button>
        </div>
      )}
    </div>
  );
}
