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
  const variants = variantStock(product);
  return (
    <div className="space-y-2 mt-3 text-sm">
      {attributes
        .filter((d) => d.scope === "product" && product.attributes?.[d.id] !== undefined)
        .map((d) => (
          <p key={d.id}>
            <strong>{d.name}: </strong>
            {Array.isArray(product.attributes[d.id])
              ? product.attributes[d.id].join("، ")
              : String(product.attributes[d.id])}
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
      {!summary.length && (
        <p className="text-muted-foreground text-xs">لم تُحدد خصائص لمتغيرات المخزون بعد.</p>
      )}
      {variants.length > 0 && (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-primary">المتبقي لكل متغير</summary>
          <div className="space-y-1 pt-2">
            {variants.map((v: any) => (
              <p key={v.id} className="flex justify-between gap-2">
                <span>{v.label}</span>
                <strong className={v.quantity === 0 ? "text-destructive" : ""}>{v.quantity}</strong>
              </p>
            ))}
          </div>
        </details>
      )}
      <p className="text-xs text-muted-foreground">
        الكميات المتاحة للبيع؛ لا تشمل الدفعات المنتهية.
      </p>
    </div>
  );
}
