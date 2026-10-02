import { stockCatalog } from "@/modules/commerce/stock-catalog";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Check,
  Clock3,
  Plus,
  Search,
  ShoppingCart,
  Tag,
  Users,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";

import {
  confirmSalesOrder,
  createSalesOrder,
  getSalesStats,
  listProducts,
  listSalesOrders,
} from "@/modules/commerce";

import { listContacts } from "@/modules/crm";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({
    meta: [
      {
        title: "المبيعات والطلبات - NovaSales",
      },
    ],
  }),

  component: SalesPage,
});

type Product = {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  currency: string;
  minimum_price?: number;
  images?: string[];
  sales_inventory?: { quantity: number } | { quantity: number }[];
};

type OrderLine = {
  productId: string;
  quantity: number;
  soldUnitPrice: number;
};

function stockOf(product: Product) {
  const inv = product.sales_inventory;

  if (Array.isArray(inv)) {
    return Number(inv[0]?.quantity ?? 0);
  }

  return Number(inv?.quantity ?? 0);
}

function money(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("ar", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function SalesPage() {
  const qc = useQueryClient();

  const fetchOrders = useServerFn(listSalesOrders);
  const fetchStats = useServerFn(getSalesStats);
  const fetchProducts = useServerFn(listProducts);
  const fetchContacts = useServerFn(listContacts);

  const createOrder = useServerFn(createSalesOrder);
  const confirmOrder = useServerFn(confirmSalesOrder);

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const [contactId, setContactId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([]);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () => fetchOrders(),
  });

  const { data: stats } = useQuery({
    queryKey: ["sales-stats"],
    queryFn: () => fetchStats(),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["sales-products-order"],
    queryFn: async () =>
      stockCatalog(
        await fetchProducts({
          data: {
            activeOnly: true,
          },
        }),
      ),
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["sales-contacts"],
    queryFn: () =>
      fetchContacts({
        data: {
          search: "",
        },
      }),
  });

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) return orders as any[];

    return (orders as any[]).filter((order) => {
      return (
        order.contact_name?.toLowerCase().includes(q) ||
        order.sales_rep_name?.toLowerCase().includes(q) ||
        order.id.toLowerCase().includes(q)
      );
    });
  }, [orders, search]);

  const selectedProducts = useMemo(() => {
    return lines
      .map((line) => {
        const product = (products as Product[]).find((p) => p.id === line.productId);

        return product
          ? {
              ...line,
              product,
            }
          : null;
      })
      .filter(Boolean) as Array<OrderLine & { product: Product }>;
  }, [lines, products]);

  const orderTotal = selectedProducts.reduce(
    (sum, line) => sum + line.quantity * line.soldUnitPrice,
    0,
  );

  const orderOriginal = selectedProducts.reduce(
    (sum, line) => sum + line.quantity * Number(line.product.price),
    0,
  );

  const discount = Math.max(0, orderOriginal - orderTotal);

  function addProduct(product: Product) {
    const stock = stockOf(product);

    if (stock <= 0) {
      toast.error("هذا المنتج غير متوفر في المخزون");
      return;
    }

    setLines((old) => {
      const exists = old.find((line) => line.productId === product.id);

      if (exists) {
        if (exists.quantity >= stock) {
          toast.error(`المتوفر من ${product.name}: ${stock}`);

          return old;
        }

        return old.map((line) =>
          line.productId === product.id
            ? {
                ...line,
                quantity: line.quantity + 1,
              }
            : line,
        );
      }

      return [
        ...old,
        {
          productId: product.id,
          quantity: 1,
          soldUnitPrice: Number(product.price),
        },
      ];
    });
  }

  function resetForm() {
    setContactId("");
    setNotes("");
    setLines([]);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!contactId) {
        throw new Error("اختر العميل");
      }

      if (!lines.length) {
        throw new Error("أضف منتجًا واحدًا على الأقل");
      }

      return createOrder({
        data: {
          contactId,
          notes: notes.trim() || null,
          items: lines.map((line) => ({
            ...line,
            productId: (products as any[]).find((p) => p.id === line.productId)?.sourceProductId,
            batchId: line.productId,
          })),
        },
      });
    },

    onSuccess: () => {
      toast.success("تم إنشاء الطلب وبانتظار التأكيد");

      resetForm();
      setOpen(false);

      qc.invalidateQueries({
        queryKey: ["sales-orders"],
      });

      qc.invalidateQueries({
        queryKey: ["sales-stats"],
      });
    },

    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "تعذر إنشاء الطلب");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (orderId: string) =>
      confirmOrder({
        data: {
          orderId,
        },
      }),

    onSuccess: () => {
      toast.success("تم تأكيد البيع وخصم الكمية من المخزون");
      qc.invalidateQueries({ queryKey: ["sales-products-order"] });
      qc.invalidateQueries({ queryKey: ["chat-order-products"] });

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
        queryKey: ["sales-products-order"],
      });
    },

    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "تعذر تأكيد البيع");
    },
  });

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">المبيعات والطلبات</h1>

          <p className="text-muted-foreground mt-1">
            إنشاء المبيعات ومتابعة الطلبات والخصومات والمخزون.
          </p>
        </div>

        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 ml-2" />
          عملية بيع جديدة
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 mb-8">
        <Stat title="إجمالي المبيعات" value={money(stats?.revenue ?? 0)} icon={BadgeDollarSign} />

        <Stat title="المبيعات المؤكدة" value={stats?.confirmedOrders ?? 0} icon={Check} />

        <Stat title="بانتظار التأكيد" value={stats?.draftOrders ?? 0} icon={Clock3} />

        <Stat title="العملاء المشترون" value={stats?.customers ?? 0} icon={Users} />

        <Stat title="إجمالي الخصومات" value={money(stats?.discounts ?? 0)} icon={Tag} />
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="relative mb-5">
            <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />

            <Input
              className="pr-9"
              placeholder="بحث باسم العميل أو المندوب..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground">جارِ تحميل المبيعات...</div>
          ) : !filteredOrders.length ? (
            <div className="py-16 text-center">
              <ShoppingCart className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />

              <p className="font-medium">لا توجد عمليات بيع حتى الآن</p>

              <p className="text-sm text-muted-foreground mt-1">أنشئ أول عملية بيع للبدء.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((order: any) => (
                <div key={order.id} className="border rounded-xl p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{order.contact_name}</p>

                        <Badge
                          variant={
                            order.status === "confirmed"
                              ? "default"
                              : order.status === "cancelled"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {order.status === "confirmed"
                            ? "تم البيع"
                            : order.status === "cancelled"
                              ? "ملغي"
                              : "بانتظار التأكيد"}
                        </Badge>
                      </div>

                      <div className="text-sm text-muted-foreground mt-2">
                        المندوب: {order.sales_rep_name}
                      </div>

                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(order.created_at).toLocaleString("ar")}
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-xs text-muted-foreground">المنتجات</p>

                        <p className="font-semibold">
                          {order.sales_order_items?.reduce(
                            (sum: number, item: any) => sum + Number(item.quantity),
                            0,
                          ) ?? 0}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">الخصم</p>

                        <p className="font-semibold">
                          {money(Number(order.discount_total), order.currency)}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">الإجمالي</p>

                        <p className="font-bold text-lg">
                          {money(Number(order.total), order.currency)}
                        </p>
                      </div>

                      {order.status === "draft" && (
                        <Button validate
                          onClick={() => confirmMutation.mutate(order.id)}
                          disabled={confirmMutation.isPending}
                        >
                          <Check className="h-4 w-4 ml-2" />
                          تأكيد البيع
                        </Button>
                      )}
                    </div>
                  </div>

                  {!!order.sales_order_items?.length && (
                    <div className="mt-4 pt-4 border-t grid gap-2">
                      {order.sales_order_items.map((item: any) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span>
                            {item.product_name}{" "}
                            {item.variant_label ? `— ${item.variant_label}` : ""}{" "}
                            {item.batch_code ? `— دفعة ${item.batch_code}` : ""}{" "}
                            {item.expires_on ? `— صلاحية ${item.expires_on}` : ""} × {item.quantity}
                          </span>

                          <span className="font-medium">
                            {money(Number(item.line_total), order.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);

          if (!value) resetForm();
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>عملية بيع جديدة</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label>العميل *</Label>

              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger required aria-label="العميل">
                  <SelectValue placeholder="اختر العميل" />
                </SelectTrigger>

                <SelectContent>
                  {(contacts as any[]).map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.display_name ||
                        contact.full_name ||
                        contact.phone ||
                        "عميل بدون اسم"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-3 block">المنتجات</Label>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(products as Product[]).map((product) => {
                  const stock = stockOf(product);

                  return (
                    <button
                      type="button"
                      key={product.id}
                      onClick={() => addProduct(product)}
                      disabled={stock <= 0}
                      className="text-right border rounded-xl p-3 hover:bg-muted/50 disabled:opacity-50 transition-colors"
                    >
                      <p className="font-semibold">{product.name}</p>

                      <div className="flex justify-between mt-2 text-sm">
                        <span>{money(Number(product.price), product.currency)}</span>

                        <span className={stock > 0 ? "text-muted-foreground" : "text-destructive"}>
                          المتوفر: {stock}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {!!selectedProducts.length && (
              <div className="space-y-3">
                <Label>تفاصيل الطلب</Label>

                {selectedProducts.map(({ product, ...line }) => (
                  <div
                    key={product.id}
                    className="grid grid-cols-1 md:grid-cols-[1fr_100px_150px_40px] gap-3 items-end border rounded-xl p-3"
                  >
                    <div>
                      <p className="font-medium">{product.name}</p>

                      <p className="text-xs text-muted-foreground">
                        السعر الأساسي: {money(Number(product.price), product.currency)}
                      </p>
                    </div>

                    <div>
                      <Label className="text-xs">الكمية</Label>

                      <Input
                        type="number"
                        min={1}
                        max={stockOf(product)}
                        value={line.quantity}
                        onChange={(e) => {
                          const quantity = Math.max(
                            1,
                            Math.min(stockOf(product), Number(e.target.value) || 1),
                          );

                          setLines((old) =>
                            old.map((x) =>
                              x.productId === product.id
                                ? {
                                    ...x,
                                    quantity,
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                    </div>

                    <div>
                      <Label className="text-xs">سعر البيع</Label>
                      <p className="text-xs text-muted-foreground">
                        الحد الأدنى: {money(Number(product.minimum_price ?? 0), product.currency)}
                      </p>

                      <Input
                        type="number"
                        min={Number(product.minimum_price ?? 0)}
                        max={Number(product.price)}
                        step="0.01"
                        value={line.soldUnitPrice}
                        onChange={(e) => {
                          const price = Math.max(0, Number(e.target.value) || 0);

                          setLines((old) =>
                            old.map((x) =>
                              x.productId === product.id
                                ? {
                                    ...x,
                                    soldUnitPrice: price,
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setLines((old) => old.filter((x) => x.productId !== product.id))
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label>ملاحظات</Label>

              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أي ملاحظات خاصة بعملية البيع..."
              />
            </div>

            {!!lines.length && (
              <div className="bg-muted/50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between">
                  <span>السعر الأساسي</span>
                  <span>{money(orderOriginal, selectedProducts[0]?.product.currency)}</span>
                </div>

                <div className="flex justify-between text-muted-foreground">
                  <span>الخصم</span>
                  <span>{money(discount, selectedProducts[0]?.product.currency)}</span>
                </div>

                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>الإجمالي</span>
                  <span>{money(orderTotal, selectedProducts[0]?.product.currency)}</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>

            <Button validate
              onClick={() => { if (!lines.length) { toast.error("منتجات الطلب: أضف منتجًا واحدًا على الأقل"); return; } createMutation.mutate(); }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "جارِ الإنشاء..." : "إنشاء الطلب"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ title, value, icon: Icon }: { title: string; value: string | number; icon: any }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>

            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>

          <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
