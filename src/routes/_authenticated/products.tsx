import { ProductPropertyManager } from "@/components/commerce/product-property-manager";
import { usePermission } from "@/platform/rbac/use-permission";
import { usePlatformSettings } from "@/modules/superadmin/use-platform-settings";
import { ProductAttributeFields } from "@/components/commerce/product-attribute-fields";
import { ProductFilters } from "@/components/commerce/product-filters";
import { EMPTY_PRODUCT_FILTERS, filterProducts } from "@/modules/commerce/product-filters";
import type { AttributeDefinition, AttributeValue } from "@/modules/commerce/product-attributes";
import { ProductMediaEditor, ProductGallery } from "@/components/commerce/product-media";
import { ProductStockSummary } from "@/components/commerce/product-stock-summary";
import { listProductAttributes } from "@/modules/commerce/stock.functions";
import { CURRENCY_CODES, currencyName, inventoryValues } from "@/modules/commerce/currencies";
import { ProductStockDialog } from "@/components/commerce/product-stock-dialog";
import { createFileRoute } from "@tanstack/react-router";
import { ProductAnalytics } from "@/components/commerce/product-analytics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useServerFn } from "@tanstack/react-start";

import { useMemo, useState } from "react";

import { Boxes, DollarSign, Package, Pencil, Plus, Search, SlidersHorizontal } from "lucide-react";

import { toast } from "@/lib/toast";

import { listProducts, upsertProduct } from "@/modules/commerce";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Card, CardContent } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({
    meta: [
      {
        title: "المنتجات والمخزون - NovaSales",
      },
      {
        name: "description",
        content: "إدارة المنتجات والأسعار والمخزون.",
      },
    ],
  }),

  component: ProductsPage,
});

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  price: number;
  currency: string;
  images: string[] | null;
  videos: string[] | null;
  attributes: Record<string, AttributeValue>;
  sales_product_variants?: any[];
  is_active: boolean;

  sales_stock_batches?: { quantity: number; expires_on: string | null }[];
  sales_inventory?:
    | {
        quantity: number;
      }
    | {
        quantity: number;
      }[]
    | null;
};

type ProductForm = {
  id?: string;
  name: string;
  sku: string;
  description: string;
  price: string;
  currency: string;
  images: string[];
  videos: string[];
  attributes: Record<string, AttributeValue>;
  isActive: boolean;
};

const EMPTY_FORM: ProductForm = {
  name: "",
  sku: "",
  description: "",
  price: "",
  currency: "USD",
  images: [],
  videos: [],
  attributes: {},
  isActive: true,
};

function getStock(product: ProductRow) {
  if (product.sales_stock_batches) {
    const today = new Date().toISOString().slice(0, 10);
    return product.sales_stock_batches
      .filter((b) => !b.expires_on || b.expires_on >= today)
      .reduce((sum, b) => sum + Number(b.quantity), 0);
  }
  const inventory = product.sales_inventory;

  if (Array.isArray(inventory)) {
    return Number(inventory[0]?.quantity ?? 0);
  }

  return Number(inventory?.quantity ?? 0);
}

function formatPrice(value: number, currency: string) {
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

function ProductsPage() {
  const qc = useQueryClient();

  const fetchProducts = useServerFn(listProducts);

  const saveProduct = useServerFn(upsertProduct);

  const fetchAttributes = useServerFn(listProductAttributes);
  const attributesQ = useQuery({
    queryKey: ["product-attributes"],
    queryFn: () => fetchAttributes(),
  });

  const attributes = attributesQ.data ?? [];
  const canManageProperties = usePermission("products.manage");
  const [propertiesOpen,setPropertiesOpen] = useState(false);
  const [inlineProperties,setInlineProperties] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_PRODUCT_FILTERS);

  const [showInactive, setShowInactive] = useState(false);

  const [productDialogOpen, setProductDialogOpen] = useState(false);

  const platform = usePlatformSettings();
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);

  const [imageUploading, setImageUploading] = useState(false);

  const [stockDialog, setStockDialog] = useState<ProductRow | null>(null);

  const {
    data: products = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["sales-products", showInactive],

    queryFn: () =>
      fetchProducts({
        data: {
          activeOnly: !showInactive,
        },
      }),
  });

  const filteredProducts = useMemo(
    () =>
      filterProducts(
        products as ProductRow[],
        attributes as AttributeDefinition[],
        filters,
        search,
      ) as ProductRow[],
    [products, attributes, filters, search],
  );

  const totalProducts = products.length;

  const totalUnits = useMemo(
    () => (products as ProductRow[]).reduce((sum, product) => sum + getStock(product), 0),
    [products],
  );

  const outOfStock = useMemo(
    () => (products as ProductRow[]).filter((product) => getStock(product) <= 0).length,
    [products],
  );

  const inventoryValue = useMemo(() => inventoryValues(products as ProductRow[]), [products]);

  const productMutation = useMutation({
    mutationFn: () => {
      const price = Number(form.price);

      if (!form.name.trim()) {
        throw new Error("اسم المنتج مطلوب");
      }

      if (!Number.isFinite(price) || price < 0) {
        throw new Error("السعر غير صالح");
      }

      return saveProduct({
        data: {
          id: form.id,

          name: form.name.trim(),

          sku: form.sku.trim() || null,

          description: form.description.trim() || null,

          price,
          attributes: form.attributes,

          currency: form.currency.trim().toUpperCase() || "USD",

          images: form.images,
          videos: form.videos,

          isActive: form.isActive,
        },
      });
    },

    onSuccess: () => {
      toast.success(form.id ? "تم تحديث المنتج" : "تمت إضافة المنتج");

      setProductDialogOpen(false);

      setForm(EMPTY_FORM);

      for (const key of [
        "sales-products",
        "chat-order-products",
        "sales-products-order",
        "chat-products",
        "product-analytics",
      ])
        qc.invalidateQueries({ queryKey: [key] });
    },

    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ المنتج");
    },
  });

  function openCreateProduct() {
    setForm({ ...EMPTY_FORM, currency: platform.default_currency });

    setProductDialogOpen(true);
  }

  function openEditProduct(product: ProductRow) {
    setForm({
      id: product.id,

      name: product.name,

      sku: product.sku ?? "",

      description: product.description ?? "",

      price: String(product.price),

      currency: product.currency ?? "USD",

      images: [...(product.images ?? [])],
      videos: [...(product.videos ?? [])],
      attributes: { ...(product.attributes ?? {}) },

      isActive: product.is_active,
    });

    setProductDialogOpen(true);
  }

  return (
    <div className="p-3 sm:p-4 md:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 md:mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">المنتجات والمخزون</h1>

          <p className="text-sm text-muted-foreground mt-1">
            إدارة المنتجات والأسعار والكميات المتوفرة للمبيعات.
          </p>
        </div>

        {canManageProperties && <div className="flex flex-col gap-2"><Button type="button" variant="outline" onClick={()=>setPropertiesOpen(true)}>إدارة الخصائص والقيم</Button><Dialog open={propertiesOpen} onOpenChange={setPropertiesOpen}><DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>خصائص المؤسسة وقيمها</DialogTitle></DialogHeader><ProductPropertyManager/></DialogContent></Dialog></div>}
        <Dialog
          open={productDialogOpen}
          onOpenChange={(open) => {
            if (imageUploading || productMutation.isPending) return;
            setProductDialogOpen(open);

            if (!open) {
              setForm(EMPTY_FORM);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openCreateProduct} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 ml-2" />
              إضافة منتج
            </Button>
          </DialogTrigger>

          <DialogContent
            dir="rtl"
            className="w-[calc(100%-1rem)] sm:max-w-xl max-h-[92vh] overflow-y-auto"
          >
            <DialogHeader>
              <DialogTitle>{form.id ? "تعديل المنتج" : "إضافة منتج جديد"}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>اسم المنتج *</Label>

                <Input required aria-label="اسم المنتج"
                  value={form.name}
                  onChange={(event) =>
                    setForm((old) => ({
                      ...old,
                      name: event.target.value,
                    }))
                  }
                  placeholder="مثال: هاتف Nova X"
                />
              </div>

              <div className="grid grid-cols-1 items-end sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SKU</Label>

                  <Input
                    value={form.sku}
                    onChange={(event) =>
                      setForm((old) => ({
                        ...old,

                        sku: event.target.value,
                      }))
                    }
                    placeholder="NV-X-001"
                    dir="ltr"
                  />
                </div>

                <div className="space-y-2">
                  <Label>السعر *</Label>

                  <Input required aria-label="سعر البيع"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(event) =>
                      setForm((old) => ({
                        ...old,

                        price: event.target.value,
                      }))
                    }
                    placeholder="0.00"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>العملة</Label>

                <select
                  aria-label="العملة"
                  className="w-full border rounded-md bg-background px-3 py-2 text-sm"
                  value={form.currency}
                  onChange={(e) => setForm((old) => ({ ...old, currency: e.target.value }))}
                >
                  {!CURRENCY_CODES.includes(form.currency) && (
                    <option value={form.currency}>{form.currency} — اختر عملة صحيحة</option>
                  )}
                  {CURRENCY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {currencyName(code)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>خصائص المنتج</Label>
                {canManageProperties && <Button type="button" variant="outline" size="sm" onClick={()=>setInlineProperties(!inlineProperties)}>{inlineProperties ? "إغلاق إدارة الخصائص" : "إضافة خاصية أو قيم جديدة"}</Button>}
                {inlineProperties && <div className="border rounded-lg p-3"><ProductPropertyManager onSaved={()=>setInlineProperties(false)}/></div>}
                {attributesQ.isError && <div className="text-destructive text-sm">تعذر تحميل الخصائص <Button type="button" variant="outline" onClick={()=>attributesQ.refetch()}>إعادة المحاولة</Button></div>}
                {!attributes.length && !attributesQ.isPending && !attributesQ.isError && <p className="text-sm text-muted-foreground">لا توجد خصائص بعد. أضف خاصية وحدد قيمها من الزر أعلاه.</p>}
                <ProductAttributeFields
                  definitions={(attributes as AttributeDefinition[]).filter(
                    (a) => a.scope === "product",
                  )}
                  values={form.attributes}
                  onChange={(values) => setForm((old) => ({ ...old, attributes: values }))}
                  currency={form.currency}
                />
                <p className="text-xs text-muted-foreground">
                  اختر الخصائص المناسبة لهذا المنتج. المقاسات والألوان ذات الكميات المختلفة تُضاف من «خيارات المخزون والدفعات» بعد حفظ المنتج.
                </p>
              </div>
              <ProductMediaEditor
                media={{ images: form.images, videos: form.videos }}
                onChange={(media) => setForm((old) => ({ ...old, ...media }))}
                onBusyChange={setImageUploading}
              />

              <div className="space-y-2">
                <Label>وصف المنتج</Label>

                <Textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm((old) => ({
                      ...old,

                      description: event.target.value,
                    }))
                  }
                  placeholder="تفاصيل المنتج..."
                  rows={4}
                />
              </div>

              <label className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm((old) => ({
                      ...old,

                      isActive: event.target.checked,
                    }))
                  }
                  className="h-4 w-4"
                />

                <div>
                  <p className="font-medium text-sm">المنتج نشط</p>

                  <p className="text-xs text-muted-foreground">
                    المنتجات غير النشطة لا تظهر للمندوب داخل الكتالوج.
                  </p>
                </div>
              </label>
            </div>

            <DialogFooter>
              <Button validate
                className="w-full sm:w-auto"
                onClick={() => productMutation.mutate()}
                disabled={productMutation.isPending || imageUploading}
              >
                {productMutation.isPending
                  ? "جارٍ الحفظ..."
                  : form.id
                    ? "حفظ التعديلات"
                    : "إضافة المنتج"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3 mb-5 md:mb-6">
        <StatCard icon={<Package className="h-5 w-5" />} label="المنتجات" value={totalProducts} />

        <StatCard
          icon={<Boxes className="h-5 w-5" />}
          label="الوحدات بالمخزون"
          value={totalUnits}
        />

        <StatCard
          icon={<SlidersHorizontal className="h-5 w-5" />}
          label="نفد من المخزون"
          value={outOfStock}
        />

        <StatCard
          icon={<DollarSign className="h-5 w-5" />}
          label="قيمة المخزون"
          value={
            <div className="space-y-1 text-sm">
              {Object.entries(inventoryValue).map(([currency, value]) => (
                <p key={currency}>{formatPrice(value, currency)}</p>
              ))}
            </div>
          }
        />
      </div>
      <ProductAnalytics />
      {/* Search */}
      <Card className="mb-5 md:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث باسم المنتج أو SKU..."
                className="pr-9"
              />
            </div>

            <Button
              variant={showInactive ? "secondary" : "outline"}
              onClick={() => setShowInactive((value) => !value)}
              className="w-full sm:w-auto"
            >
              {showInactive ? "إخفاء غير النشطة" : "عرض جميع المنتجات"}
            </Button>
          </div>
          <div className="mt-3">
            <ProductFilters
              definitions={attributes as AttributeDefinition[]}
              products={products as any[]}
              value={filters}
              onChange={setFilters}
            />
            <p className="text-xs text-muted-foreground mt-2">
              النتائج: {filteredProducts.length} منتج
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            جارٍ تحميل المنتجات...
          </CardContent>
        </Card>
      ) : filteredProducts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />

            <p className="font-medium">{search ? "لا توجد نتائج" : "لا توجد منتجات بعد"}</p>

            <p className="text-sm text-muted-foreground mt-1">
              {search ? "جرّب البحث بكلمة مختلفة." : "أضف أول منتج للبدء بإدارة المخزون."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProducts.map((product) => {
              const stock = getStock(product);

              return (
                <Card key={product.id} className="overflow-hidden">
                  <div className="relative">
                    <ProductGallery
                      images={product.images ?? []}
                      videos={product.videos ?? []}
                      name={product.name}
                    />
                    <div className="absolute top-2 right-2 sm:top-3 sm:right-3 flex flex-wrap gap-1.5">
                      <Badge variant={product.is_active ? "default" : "secondary"}>
                        {product.is_active ? "نشط" : "غير نشط"}
                      </Badge>

                      <Badge
                        variant={stock <= 0 ? "destructive" : stock <= 5 ? "secondary" : "outline"}
                      >
                        {stock <= 0 ? "نفد المخزون" : `${stock} متوفر`}
                      </Badge>
                    </div>
                  </div>

                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold text-base sm:text-lg truncate">
                          {product.name}
                        </h2>

                        {product.sku && (
                          <p className="text-xs text-muted-foreground mt-1 truncate" dir="ltr">
                            SKU: {product.sku}
                          </p>
                        )}
                      </div>

                      <p className="font-bold text-sm sm:text-base whitespace-nowrap" dir="ltr">
                        {formatPrice(Number(product.price), product.currency)}
                      </p>
                    </div>

                    <ProductStockSummary
                      product={product}
                      attributes={attributes as AttributeDefinition[]}
                    />

                    {product.description && (
                      <p className="text-sm text-muted-foreground mt-3 line-clamp-2 min-h-10">
                        {product.description}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2 mt-4 sm:mt-5">
                      <Button variant="outline" size="sm" onClick={() => openEditProduct(product)}>
                        <Pencil className="h-4 w-4 ml-1" />
                        تعديل
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => {
                          setStockDialog(product);
                        }}
                      >
                        <Boxes className="h-4 w-4 ml-1" />
                        خيارات المخزون والدفعات
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {isFetching && (
            <p className="text-xs text-muted-foreground mt-4">جارٍ تحديث البيانات...</p>
          )}
        </>
      )}

      {stockDialog && (
        <ProductStockDialog productId={stockDialog.id} onClose={() => setStockDialog(null)} />
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;

  label: string;

  value: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}

          <span className="text-[11px] sm:text-sm">{label}</span>
        </div>

        <div className="text-lg sm:text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
