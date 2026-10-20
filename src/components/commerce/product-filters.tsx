import { useState } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import {
  EMPTY_PRODUCT_FILTERS,
  type ProductFilters as Filters,
  type AttributeFilter,
} from "@/modules/commerce/product-filters";
import { currencyName } from "@/modules/commerce/currencies";
const selectClass = "w-full rounded-md border bg-background p-2 text-sm";
export function ProductFilters({
  definitions,
  products,
  value,
  onChange,
  compact = false,
}: {
  definitions: AttributeDefinition[];
  products: any[];
  value: Filters;
  onChange: (v: Filters) => void;
  /** Small one-line bar for pickers on a phone: no currency filter, and price sorting only when
   *  every product shares one currency. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const currencies = [...new Set<string>(products.map((p) => p.currency))];
  const needsCurrency = currencies.length > 1 && !value.currency;
  if (compact) {
    const active =
      Object.values(value.attributes).filter((f) => f.values?.length || f.text || f.min || f.max).length +
      (value.availableOnly ? 1 : 0) +
      (value.priceMin || value.priceMax ? 1 : 0);
    return (
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => setOpen(!open)}>
            <Filter className="w-3.5 h-3.5 ml-1" />
            فلترة{active ? ` (${active})` : ""}
          </Button>
          {!needsCurrency && (
            <select
              aria-label="ترتيب المنتجات"
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={value.sort}
              onChange={(e) => onChange({ ...value, sort: e.target.value })}
            >
              <option value="default">الترتيب</option>
              <option value="price-asc">الأرخص أولًا</option>
              <option value="price-desc">الأغلى أولًا</option>
            </select>
          )}
          {(active > 0 || value.sort !== "default") && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => onChange({ ...EMPTY_PRODUCT_FILTERS, attributes: {} })}
            >
              مسح
            </Button>
          )}
        </div>
        {open && (
          <div className="space-y-3 border rounded-lg p-3 text-sm">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={value.availableOnly}
                onChange={(e) => onChange({ ...value, availableOnly: e.target.checked })}
              />
              المتوفر للبيع فقط
            </label>
            {definitions
              .filter((d) => ["select", "multiselect"].includes(d.kind) && d.options.length)
              .map((d) => (
                <div key={d.id} className="space-y-1">
                  <Label className="text-xs">{d.name}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {d.options.map((o) => {
                      const checked = value.attributes[d.id]?.values?.includes(o) ?? false;
                      return (
                        <button
                          key={o}
                          type="button"
                          className={
                            "rounded-full border px-2.5 py-1 text-xs " +
                            (checked ? "bg-primary text-primary-foreground border-primary" : "bg-background")
                          }
                          onClick={() => {
                            const old = value.attributes[d.id]?.values ?? [];
                            update(d.id, { values: checked ? old.filter((v) => v !== o) : [...old, o] });
                          }}
                        >
                          {o}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  }
  function update(id: string, change: AttributeFilter) {
    onChange({
      ...value,
      attributes: { ...value.attributes, [id]: { ...value.attributes[id], ...change } },
    });
  }
  const count = Object.values(value.attributes).filter(
    (f) => f.values?.length || f.text || f.min || f.max,
  ).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Button type="button" variant="outline" onClick={() => setOpen(!open)}>
          <Filter className="w-4 h-4 ml-2" />
          فلترة الخصائص{count ? ` (${count})` : ""}
        </Button>
        <select
          aria-label="فلترة العملة"
          className={`${selectClass} sm:w-auto`}
          value={value.currency}
          onChange={(e) =>
            onChange({
              ...value,
              currency: e.target.value,
              sort: "default",
              priceMin: "",
              priceMax: "",
              attributes: Object.fromEntries(
                Object.entries(value.attributes).filter(
                  ([id]) => definitions.find((d) => d.id === id)?.kind !== "money",
                ),
              ),
            })
          }
        >
          <option value="">كل العملات</option>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {currencyName(c)}
            </option>
          ))}
        </select>
        <select
          aria-label="ترتيب المنتجات"
          className={`${selectClass} sm:w-auto`}
          value={value.sort}
          disabled={needsCurrency}
          onChange={(e) => onChange({ ...value, sort: e.target.value })}
        >
          <option value="default">الترتيب الافتراضي</option>
          <option value="price-asc">سعر المبيع: الأقل أولًا</option>
          <option value="price-desc">سعر المبيع: الأعلى أولًا</option>
          {definitions
            .filter((d) => d.kind === "money" && d.scope === "product")
            .flatMap((d) => [
              <option key={`${d.id}-asc`} value={`money:${d.id}:asc`}>
                {d.name}: الأقل أولًا
              </option>,
              <option key={`${d.id}-desc`} value={`money:${d.id}:desc`}>
                {d.name}: الأعلى أولًا
              </option>,
            ])}
        </select>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChange({ ...EMPTY_PRODUCT_FILTERS, attributes: {} })}
        >
          مسح الفلاتر
        </Button>
      </div>
      {needsCurrency && (
        <p className="text-xs text-muted-foreground">
          اختر عملة واحدة لترتيب الأسعار أو تحديد نطاق مبالغ.
        </p>
      )}
      {open && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 border rounded-lg p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.availableOnly}
              onChange={(e) => onChange({ ...value, availableOnly: e.target.checked })}
            />
            المتوفر للبيع فقط
          </label>
          <div>
            <Label className="text-xs">سعر المبيع</Label>
            <div className="flex gap-2">
              <Input
                aria-label="أقل سعر مبيع"
                placeholder="من"
                type="number"
                min="0"
                step="any"
                disabled={needsCurrency}
                value={value.priceMin}
                onChange={(e) => onChange({ ...value, priceMin: e.target.value })}
              />
              <Input
                aria-label="أعلى سعر مبيع"
                placeholder="إلى"
                type="number"
                min="0"
                step="any"
                disabled={needsCurrency}
                value={value.priceMax}
                onChange={(e) => onChange({ ...value, priceMax: e.target.value })}
              />
            </div>
          </div>
          {definitions.map((d) => (
            <div key={d.id} className="space-y-1">
              <Label className="text-xs">
                {d.name}
                {d.scope === "variant" ? " — المتبقي بالمخزون" : ""}
              </Label>
              {d.kind === "boolean" ? (<select aria-label={`فلترة ${d.name}`} className="w-full border rounded-md bg-background p-2" value={value.attributes[d.id]?.values?.[0] ?? ""} onChange={e=>update(d.id,{values:e.target.value?[e.target.value]:[]})}><option value="">كل القيم</option><option value="true">نعم</option><option value="false">لا</option></select>) : ["select", "multiselect"].includes(d.kind) ? (
                <div className="flex flex-wrap gap-2">
                  {d.options.map((o) => (
                    <label key={o} className="text-xs flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={value.attributes[d.id]?.values?.includes(o) ?? false}
                        onChange={(e) => {
                          const old = value.attributes[d.id]?.values ?? [];
                          update(d.id, {
                            values: e.target.checked ? [...old, o] : old.filter((v) => v !== o),
                          });
                        }}
                      />
                      {o}
                    </label>
                  ))}
                </div>
              ) : ["number", "money", "date"].includes(d.kind) ? (
                <div className="flex gap-2">
                  <Input
                    aria-label={`أقل ${d.name}`}
                    placeholder="من"
                    type={d.kind === "date" ? "date" : "number"}
                    step="any"
                    disabled={d.kind === "money" && needsCurrency}
                    value={value.attributes[d.id]?.min ?? ""}
                    onChange={(e) => update(d.id, { min: e.target.value })}
                  />
                  <Input
                    aria-label={`أعلى ${d.name}`}
                    placeholder="إلى"
                    type={d.kind === "date" ? "date" : "number"}
                    step="any"
                    disabled={d.kind === "money" && needsCurrency}
                    value={value.attributes[d.id]?.max ?? ""}
                    onChange={(e) => update(d.id, { max: e.target.value })}
                  />
                </div>
              ) : (
                <Input
                  aria-label={`بحث ${d.name}`}
                  placeholder={`ابحث في ${d.name}`}
                  value={value.attributes[d.id]?.text ?? ""}
                  onChange={(e) => update(d.id, { text: e.target.value })}
                />
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
            اختيارات الخاصية الواحدة بدائل؛ الخصائص المختلفة تُطابق معًا. فلترة اللون والمقاس تعرض
            التركيبة المتوفرة نفسها وتستبعد الدفعات المنتهية.
          </p>
        </div>
      )}
    </div>
  );
}
