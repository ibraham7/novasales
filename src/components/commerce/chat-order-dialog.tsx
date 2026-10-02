import { stockCatalog } from "@/modules/commerce/stock-catalog";
import { useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useServerFn } from "@tanstack/react-start";

import { CheckCircle2, Minus, Package, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";

import { toast } from "@/lib/toast";

import { confirmSalesOrder, createSalesOrder, listProducts } from "@/modules/commerce";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Badge } from "@/components/ui/badge";

import { Textarea } from "@/components/ui/textarea";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Line = {
  productId: string;
  quantity: number;
  soldUnitPrice: number;
};

type Props = {
  chatId: string;
  contactId: string;
  opportunityId: string;
  contactName?: string | null;
};

function getStock(product: any) {
  const inventory = Array.isArray(product.sales_inventory)
    ? product.sales_inventory[0]
    : product.sales_inventory;

  return Number(inventory?.quantity ?? 0);
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("ar", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function ChatOrderDialog({ chatId, contactId, opportunityId, contactName }: Props) {
  const qc = useQueryClient();

  const list = useServerFn(listProducts);

  const create = useServerFn(createSalesOrder);

  const confirm = useServerFn(confirmSalesOrder);

  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState("");

  const [notes, setNotes] = useState("");

  const [lines, setLines] = useState<Line[]>([]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["chat-order-products"],

    queryFn: async () =>
      stockCatalog(
        await list({
          data: {
            activeOnly: true,
          },
        }),
      ),

    enabled: open,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) {
      return products as any[];
    }

    return (products as any[]).filter((product) =>
      [product.name, product.sku, product.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [products, search]);

  const selected = useMemo(
    () =>
      lines
        .map((line) => {
          const product = (products as any[]).find((p) => p.id === line.productId);

          return product
            ? {
                ...line,
                product,
              }
            : null;
        })
        .filter(Boolean) as any[],
    [lines, products],
  );

  const currency = selected[0]?.product?.currency ?? "USD";

  const originalTotal = selected.reduce(
    (sum, line) => sum + Number(line.product.price) * line.quantity,
    0,
  );

  const finalTotal = selected.reduce((sum, line) => sum + line.soldUnitPrice * line.quantity, 0);

  const discount = Math.max(0, originalTotal - finalTotal);

  function addProduct(product: any) {
    const stock = getStock(product);

    if (stock <= 0) {
      toast.error("هذا المنتج غير متوفر");

      return;
    }

    if (lines.length > 0) {
      const first = (products as any[]).find((p) => p.id === lines[0].productId);

      if (first && first.currency !== product.currency) {
        toast.error("لا يمكن إضافة منتجات بعملات مختلفة داخل نفس الطلب");

        return;
      }
    }

    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);

      if (existing) {
        if (existing.quantity >= stock) {
          toast.error(`المتوفر: ${stock}`);

          return current;
        }

        return current.map((line) =>
          line.productId === product.id
            ? {
                ...line,
                quantity: line.quantity + 1,
              }
            : line,
        );
      }

      return [
        ...current,
        {
          productId: product.id,

          quantity: 1,

          soldUnitPrice: Number(product.price),
        },
      ];
    });
  }

  function reset() {
    setSearch("");
    setNotes("");
    setLines([]);
  }

  const mutation = useMutation({
    mutationFn: async ({ confirmNow }: { confirmNow: boolean }) => {
      if (!lines.length) {
        throw new Error("أضف منتجًا واحدًا على الأقل");
      }

      const order = await create({
        data: {
          contactId,
          opportunityId,
          chatId,

          notes: notes.trim() || null,

          items: lines.map((line) => ({
            productId: (products as any[]).find((p) => p.id === line.productId)?.sourceProductId,
            batchId: line.productId,

            quantity: line.quantity,

            soldUnitPrice: line.soldUnitPrice,
          })),
        },
      });

      if (confirmNow) {
        await confirm({
          data: {
            orderId: order.id,
          },
        });
      }

      return {
        order,
        confirmNow,
      };
    },

    onSuccess: ({ confirmNow }) => {
      toast.success(
        confirmNow
          ? "تم البيع وخصم المخزون وتحويل العميل إلى مشترٍ"
          : "تم حفظ الطلب وبانتظار التأكيد",
      );

      qc.invalidateQueries({ queryKey: ["sales-products"] });
      qc.invalidateQueries({ queryKey: ["sales-reports"] });
      qc.invalidateQueries({ queryKey: ["sales-performance"] });
      qc.invalidateQueries({ queryKey: ["sales-products-order"] });
      reset();
      setOpen(false);

      qc.invalidateQueries({
        queryKey: ["sales-orders"],
      });

      qc.invalidateQueries({
        queryKey: ["sales-stats"],
      });

      qc.invalidateQueries({
        queryKey: ["sales-products"],
      });

      qc.invalidateQueries({
        queryKey: ["chat-products"],
      });

      qc.invalidateQueries({
        queryKey: ["chat-order-products"],
      });

      qc.invalidateQueries({
        queryKey: ["opportunity-workspace", chatId],
      });

      qc.invalidateQueries({
        queryKey: ["chat", chatId],
      });
    },

    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "تعذر إنشاء عملية البيع");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);

        if (!value) {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          title="إنشاء طلب"
          aria-label="إنشاء طلب"
          className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <ShoppingCart className="h-4 w-4" />
        </button>
      </DialogTrigger>

      <DialogContent dir="rtl" className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            إنشاء طلب
            {contactName ? ` — ${contactName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
          <div>
            <div className="relative mb-4">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث عن منتج..."
                className="pr-9"
              />
            </div>

            {isLoading ? (
              <div className="py-12 text-center text-muted-foreground">جارِ تحميل المنتجات...</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3 max-h-[55vh] overflow-y-auto pr-1">
                {filtered.map((product: any) => {
                  const stock = getStock(product);

                  const image = Array.isArray(product.images) ? product.images[0] : null;

                  return (
                    <button
                      type="button"
                      key={product.id}
                      disabled={stock <= 0}
                      onClick={() => addProduct(product)}
                      className="border rounded-xl overflow-hidden text-right hover:bg-muted/50 disabled:opacity-50 transition-colors"
                    >
                      <div className="h-28 bg-muted overflow-hidden flex items-center justify-center">
                        {image ? (
                          <img
                            src={image}
                            alt={product.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <Package className="h-8 w-8 text-muted-foreground/50" />
                        )}
                      </div>

                      <div className="p-3">
                        <div className="font-semibold">{product.name}</div>

                        <div className="flex justify-between gap-2 mt-2 text-sm">
                          <span className="font-medium">
                            {formatMoney(Number(product.price), product.currency)}
                          </span>

                          <Badge variant={stock > 0 ? "secondary" : "destructive"}>
                            {stock > 0 ? `${stock} متوفر` : "نفد"}
                          </Badge>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">المنتجات المختارة</Label>

              {!selected.length ? (
                <div className="border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">
                  اختر المنتجات من القائمة
                </div>
              ) : (
                <div className="space-y-3">
                  {selected.map((line: any) => {
                    const stock = getStock(line.product);

                    return (
                      <div key={line.productId} className="border rounded-xl p-3 space-y-3">
                        <div className="flex justify-between gap-3">
                          <div>
                            <div className="font-medium">{line.product.name}</div>

                            <div className="text-xs text-muted-foreground">
                              السعر الأساسي:{" "}
                              {formatMoney(Number(line.product.price), line.product.currency)}
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setLines((current) =>
                                current.filter((item) => item.productId !== line.productId),
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">الكمية</Label>

                            <div className="flex items-center gap-1 mt-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-9 w-9"
                                onClick={() =>
                                  setLines((current) =>
                                    current.map((item) =>
                                      item.productId === line.productId
                                        ? {
                                            ...item,
                                            quantity: Math.max(1, item.quantity - 1),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              >
                                <Minus className="h-4 w-4" />
                              </Button>

                              <Input
                                className="text-center"
                                value={line.quantity}
                                type="number"
                                min={1}
                                max={stock}
                                onChange={(e) => {
                                  const value = Math.max(
                                    1,
                                    Math.min(stock, Number(e.target.value) || 1),
                                  );

                                  setLines((current) =>
                                    current.map((item) =>
                                      item.productId === line.productId
                                        ? {
                                            ...item,
                                            quantity: value,
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              />

                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-9 w-9"
                                onClick={() =>
                                  setLines((current) =>
                                    current.map((item) =>
                                      item.productId === line.productId
                                        ? {
                                            ...item,
                                            quantity: Math.min(stock, item.quantity + 1),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div>
                            <Label className="text-xs">سعر البيع</Label>
                            <p className="text-xs text-muted-foreground">
                              الحد الأدنى:{" "}
                              {formatMoney(
                                Number(line.product.minimum_price ?? 0),
                                line.product.currency,
                              )}
                            </p>

                            <Input
                              className="mt-1"
                              type="number"
                              min={Number(line.product.minimum_price ?? 0)}
                              max={Number(line.product.price)}
                              step="0.01"
                              value={line.soldUnitPrice}
                              onChange={(e) => {
                                const value = Math.max(0, Number(e.target.value) || 0);

                                setLines((current) =>
                                  current.map((item) =>
                                    item.productId === line.productId
                                      ? {
                                          ...item,
                                          soldUnitPrice: value,
                                        }
                                      : item,
                                  ),
                                );
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <Label>ملاحظات</Label>

              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
                placeholder="ملاحظات الطلب..."
              />
            </div>

            {!!selected.length && (
              <div className="rounded-xl bg-muted/50 p-4 space-y-2">
                <div className="flex justify-between">
                  <span>السعر الأساسي</span>

                  <span>{formatMoney(originalTotal, currency)}</span>
                </div>

                <div className="flex justify-between text-muted-foreground">
                  <span>الخصم</span>

                  <span>{formatMoney(discount, currency)}</span>
                </div>

                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>الإجمالي</span>

                  <span>{formatMoney(finalTotal, currency)}</span>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-2">
              <Button validate
                variant="outline"
                disabled={!lines.length || mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    confirmNow: false,
                  })
                }
              >
                <ShoppingCart className="h-4 w-4 ml-2" />
                حفظ كطلب
              </Button>

              <Button validate
                disabled={!lines.length || mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    confirmNow: true,
                  })
                }
              >
                <CheckCircle2 className="h-4 w-4 ml-2" />

                {mutation.isPending ? "جارِ التنفيذ..." : "تأكيد البيع الآن"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
