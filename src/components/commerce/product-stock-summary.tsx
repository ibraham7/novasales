import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import { useState } from "react";
import { attributeStock, variantStock } from "@/modules/commerce/stock-summary";
export function ProductStockSummary({
  product,
  attributes,
}: {
  product: any;
  attributes: AttributeDefinition[];
}) {
  const [open, setOpen] = useState(false);
  const summary = attributeStock(product, attributes);
  // The plain «أساسي» row only matters when it holds stock or is the only row.
  const all = variantStock(product);
  const variants = all.filter((v: any) => !v.is_default || v.quantity > 0 || all.length === 1);
  const specs = attributes.filter((d) => d.scope === "product" && product.attributes?.[d.id] !== undefined);
  const total = variants.reduce((sum: number, v: any) => sum + v.quantity, 0);
  return (
    <div className="space-y-2 mt-3 text-sm">
      {/* The quantity left of each option is the main information, always shown. */}
      {variants.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="mb-1 flex justify-between gap-2 text-xs font-semibold">
            <span>الكمية المتبقية</span>
            <span>{total}</span>
          </p>
          <div className="space-y-0.5">
            {variants.map((v: any) => (
              <p key={v.id} className="flex justify-between gap-2">
                <span className="truncate">{v.is_default && variants.length === 1 ? "الكمية" : v.label}</span>
                <strong className={v.quantity === 0 ? "text-destructive" : ""}>{v.quantity}</strong>
              </p>
            ))}
          </div>
        </div>
      )}
      {(specs.length > 0 || summary.length > 0) && (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-primary">تفاصيل المنتج</summary>
          <div className="space-y-1 pt-2">
            {specs.map((d) => (
              <p key={d.id}>
                <strong>{d.name}: </strong>
                {["url", "file"].includes(d.kind) && /^https?:\/\//i.test(String(product.attributes[d.id])) ? <a href={String(product.attributes[d.id])} target="_blank" rel="noopener noreferrer" className="text-primary underline">{d.kind === "file" ? "فتح الملف" : "فتح الرابط"}</a> : Array.isArray(product.attributes[d.id])
                  ? product.attributes[d.id].join("، ")
                  : typeof product.attributes[d.id] === "boolean" ? (product.attributes[d.id] ? "نعم" : "لا") : String(product.attributes[d.id])}
                {d.kind === "money" ? ` ${product.currency}` : ""}
                {d.is_price_floor ? " — الحد الأدنى للبيع" : ""}
              </p>
            ))}
            {summary.map((def) => (
              <div key={def.id}>
                <strong>{def.name}: </strong>
                <span>{def.values.map((v) => `${v.value} (${v.quantity})`).join(" · ")}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="text-xs text-muted-foreground">لا تشمل الكميات الدفعات المنتهية.</p>
    </div>
  );
}
