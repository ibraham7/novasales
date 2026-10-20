import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** One purchasable lot as produced by stockCatalog. */
export type Lot = {
  id: string;
  sourceProductId: string;
  productName: string;
  price: number;
  currency: string;
  batchCode: string;
  expiresOn: string | null;
  variantAttributes: Record<string, unknown>;
  variant_attribute_names?: Record<string, string>;
  images?: string[];
  sales_inventory?: { quantity: number } | { quantity: number }[];
};

function lotStock(lot: Lot) {
  const inv = lot.sales_inventory;
  return Number((Array.isArray(inv) ? inv[0]?.quantity : inv?.quantity) ?? 0);
}

function money(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

const valueOf = (lot: Lot, key: string) => String(lot.variantAttributes?.[key] ?? "");

/**
 * Shows each product once; picking it asks for its options (colour, size…) one after another,
 * then for the batch, and hands the chosen lot to onAdd.
 */
export function ProductLotPicker({ lots, onAdd }: { lots: Lot[]; onAdd: (lot: Lot) => void }) {
  const products = useMemo(() => {
    const byProduct = new Map<string, Lot[]>();
    for (const lot of lots) {
      const list = byProduct.get(lot.sourceProductId) ?? [];
      list.push(lot);
      byProduct.set(lot.sourceProductId, list);
    }
    return Array.from(byProduct.entries()).map(([id, productLots]) => {
      const keys: string[] = [];
      for (const lot of productLots)
        for (const key of Object.keys(lot.variantAttributes ?? {})) if (!keys.includes(key)) keys.push(key);
      return {
        id,
        name: productLots[0].productName,
        image: Array.isArray(productLots[0].images) ? productLots[0].images[0] ?? null : null,
        price: Number(productLots[0].price),
        currency: productLots[0].currency,
        stock: productLots.reduce((sum, lot) => sum + lotStock(lot), 0),
        names: productLots[0].variant_attribute_names ?? {},
        keys,
        lots: productLots,
      };
    });
  }, [lots]);

  const [productId, setProductId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [lotId, setLotId] = useState<string | null>(null);
  const product = products.find((p) => p.id === productId) ?? null;
  // On a phone the options open below the product list: bring them into view.
  const optionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (productId) optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [productId]);

  function pickProduct(id: string) {
    const next = products.find((p) => p.id === id);
    if (!next) return;
    // Nothing to ask: a product with a single lot and no options goes straight into the order.
    if (!next.keys.length && next.lots.length === 1) {
      onAdd(next.lots[0]);
      setProductId(null);
      return;
    }
    setProductId(id);
    setChoices({});
    setLotId(null);
  }

  function choose(index: number, key: string, value: string) {
    if (!product) return;
    // A change to an earlier option clears the ones after it, since their values depend on it.
    const next: Record<string, string> = {};
    for (const k of product.keys.slice(0, index)) if (choices[k]) next[k] = choices[k];
    next[key] = value;
    setChoices(next);
    setLotId(null);
  }

  const matchesUpTo = (lot: Lot, count: number) =>
    product!.keys.slice(0, count).every((k) => valueOf(lot, k) === choices[k]);

  const allChosen = !!product && product.keys.every((k) => choices[k]);
  const matchingLots = allChosen ? product!.lots.filter((lot) => matchesUpTo(lot, product!.keys.length)) : [];
  const chosenLot = matchingLots.find((lot) => lot.id === lotId) ?? (matchingLots.length === 1 ? matchingLots[0] : null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
        {products.map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => pickProduct(p.id)}
            disabled={p.stock <= 0}
            className={
              "text-right border rounded-xl overflow-hidden hover:bg-muted/50 disabled:opacity-50 transition-colors " +
              (productId === p.id ? "border-primary ring-1 ring-primary" : "")
            }
          >
            {p.image && (
              <div className="aspect-[4/3] bg-muted overflow-hidden">
                <img src={p.image} alt={p.name} loading="lazy" className="w-full h-full object-contain" />
              </div>
            )}
            <div className="p-2.5">
              <p className="font-semibold text-sm leading-snug">{p.name}</p>
              <div className="flex flex-wrap justify-between gap-x-2 mt-1.5 text-xs">
                <span className="font-medium">{money(p.price, p.currency)}</span>
                <span className={p.stock > 0 ? "text-muted-foreground" : "text-destructive"}>المتوفر: {p.stock}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {product && (
        <div ref={optionsRef} className="border rounded-xl p-4 space-y-4 bg-muted/30 scroll-mt-14">
          <p className="font-semibold">{product.name}</p>

          {product.keys.map((key, index) => {
            // Only show an option once the previous ones are chosen, and only values still in stock.
            if (index > 0 && !choices[product.keys[index - 1]]) return null;
            const values = Array.from(
              new Set(product.lots.filter((lot) => matchesUpTo(lot, index)).map((lot) => valueOf(lot, key))),
            ).filter(Boolean);
            return (
              <div key={key} className="space-y-2">
                <Label>{product.names[key] ?? "الخيار"}</Label>
                <div className="flex flex-wrap gap-2">
                  {values.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={choices[key] === value ? "default" : "outline"}
                      onClick={() => choose(index, key, value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}

          {allChosen && matchingLots.length > 1 && (
            <div className="space-y-2">
              <Label>الدفعة</Label>
              <div className="flex flex-wrap gap-2">
                {matchingLots.map((lot) => (
                  <Button
                    key={lot.id}
                    type="button"
                    size="sm"
                    variant={chosenLot?.id === lot.id ? "default" : "outline"}
                    onClick={() => setLotId(lot.id)}
                  >
                    دفعة {lot.batchCode}
                    {lot.expiresOn ? ` — صلاحية ${lot.expiresOn}` : ""} (المتوفر: {lotStock(lot)})
                  </Button>
                ))}
              </div>
            </div>
          )}

          {chosenLot && matchingLots.length === 1 && (
            <p className="text-sm text-muted-foreground">
              دفعة {chosenLot.batchCode}
              {chosenLot.expiresOn ? ` — صلاحية ${chosenLot.expiresOn}` : ""} — المتوفر: {lotStock(chosenLot)}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={!chosenLot}
              onClick={() => {
                if (!chosenLot) return;
                onAdd(chosenLot);
                setProductId(null);
              }}
            >
              <Plus className="h-4 w-4 ml-1" /> إضافة للطلب
            </Button>
            <Button type="button" variant="ghost" onClick={() => setProductId(null)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
