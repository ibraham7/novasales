import { useState } from "react";
import { attributeStock, variantStock } from "@/modules/commerce/stock-summary";
export function ProductStockSummary({
  product,
  attributes,
}: {
  product: any;
  attributes: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const summary = attributeStock(product, attributes);
  const variants = variantStock(product);
  return (
    <div className="space-y-2 mt-3 text-sm">
      {summary.map((def) => (
        <div key={def.id}>
          <strong>{def.name}: </strong>
          <span>{def.values.map((v) => `${v.value} (${v.quantity})`).join(" · ")}</span>
        </div>
      ))}
      {!summary.length && (
        <p className="text-muted-foreground text-xs">لم تُحدد خصائص لهذا المنتج بعد.</p>
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
