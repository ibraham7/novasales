import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import { ProductFilters } from "./product-filters";
import { EMPTY_PRODUCT_FILTERS, filterProducts } from "@/modules/commerce/product-filters";
import { ProductGallery } from "./product-media";
import { ProductStockSummary } from "./product-stock-summary";
import { variantStock } from "@/modules/commerce/stock-summary";
import { listProductAttributes } from "@/modules/commerce/stock.functions";
import { useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useServerFn } from "@tanstack/react-start";

import { Package, Search, Send, ShoppingBag } from "lucide-react";

import { toast } from "@/lib/toast";

import { listProducts, sendProductToChatFn } from "@/modules/commerce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ProductPickerDialog({ chatId }: { chatId: string }) {
  const qc = useQueryClient();
  const fetchAttributes = useServerFn(listProductAttributes);
  const { data: attributes = [] } = useQuery({
    queryKey: ["product-attributes"],
    queryFn: () => fetchAttributes(),
  });

  const fetchProducts = useServerFn(listProducts);

  const sendProduct = useServerFn(sendProductToChatFn);

  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_PRODUCT_FILTERS);

  const [sendingProductId, setSendingProductId] = useState<string | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["chat-products"],

    queryFn: () =>
      fetchProducts({
        data: {
          activeOnly: true,
        },
      }),

    enabled: open,
  });

  const filtered = useMemo(
    () => filterProducts(products as any[], attributes as AttributeDefinition[], filters, search),
    [products, attributes, filters, search],
  );

  const sendMutation = useMutation({
    mutationFn: async (productId: string) => {
      setSendingProductId(productId);

      return sendProduct({
        data: {
          chatId,
          productId,
        },
      });
    },

    onSuccess: (result) => {
      if (result.usedTextFallback) {
        toast.warning("تم إرسال تفاصيل المنتج، لكن تعذر إرسال الصورة.");
      } else if (result.mediaSent) {
        toast.success("تم إرسال صورة المنتج والتفاصيل للعميل.");
      } else {
        toast.success("تم إرسال تفاصيل المنتج للعميل.");
      }

      setOpen(false);
      setSearch("");

      qc.invalidateQueries({
        queryKey: ["chat", chatId],
      });

      qc.invalidateQueries({
        queryKey: ["chats-enriched"],
      });
    },

    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال المنتج");
    },

    onSettled: () => {
      setSendingProductId(null);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="إرسال منتج"
          aria-label="إرسال منتج"
          className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Package className="h-4 w-4" />
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl max-h-[85dvh] overflow-y-auto flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            إرسال منتج للعميل
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم المنتج أو SKU..."
            className="pr-9"
          />
        </div>

        <ProductFilters
          products={products as any[]}
          definitions={attributes as AttributeDefinition[]}
          value={filters}
          onChange={setFilters}
        />
        <div className="shrink-0 mt-4 pr-1">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              جارِ تحميل المنتجات...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              لا توجد منتجات مطابقة.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((product: any) => {
                const stock = variantStock(product).reduce(
                  (sum: number, v: any) => sum + v.quantity,
                  0,
                );

                const isSending = sendingProductId === product.id && sendMutation.isPending;

                return (
                  <div key={product.id} className="border rounded-xl overflow-hidden bg-card">
                    <ProductGallery
                      name={product.name}
                      images={product.images ?? []}
                      videos={product.videos ?? []}
                    />

                    <div className="p-3 space-y-3">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold leading-tight">{product.name}</h3>

                          <Badge variant={stock > 0 ? "secondary" : "destructive"}>
                            {stock > 0 ? `المخزون ${stock}` : "نفد المخزون"}
                          </Badge>
                        </div>

                        {product.sku && (
                          <p className="text-xs text-muted-foreground mt-1" dir="ltr">
                            SKU: {product.sku}
                          </p>
                        )}
                      </div>

                      <ProductStockSummary
                        product={product}
                        attributes={attributes as AttributeDefinition[]}
                      />
                      {product.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {product.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-3">
                        <div className="font-bold">
                          {Number(product.price)} {product.currency}
                        </div>

                        <Button validate
                          size="sm"
                          disabled={stock <= 0 || sendMutation.isPending}
                          onClick={() => sendMutation.mutate(product.id)}
                        >
                          <Send className="h-4 w-4 ml-1.5" />

                          {isSending ? "جارِ الإرسال..." : "إرسال"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
