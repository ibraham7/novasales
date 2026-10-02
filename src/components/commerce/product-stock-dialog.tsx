import { ProductAttributeFields } from "./product-attribute-fields";
import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import { variantStock } from "@/modules/commerce/stock-summary";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { usePermission } from "@/platform/rbac/use-permission";
import { listProducts } from "@/modules/commerce/products.functions";
import {
  listProductAttributes,
  saveProductAttribute,
  createProductVariant,
  receiveStockBatch,
  adjustStockBatch,
} from "@/modules/commerce/stock.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Attribute = AttributeDefinition;
const selectClass = "w-full border rounded-md bg-background px-3 py-2 text-sm";

export function ProductStockDialog({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const canManage = usePermission("products.manage");
  const canStock = usePermission("inventory.manage");
  const list = useServerFn(listProducts),
    defs = useServerFn(listProductAttributes),
    save = useServerFn(saveProductAttribute),
    variant = useServerFn(createProductVariant),
    receive = useServerFn(receiveStockBatch),
    adjust = useServerFn(adjustStockBatch);
  const { data: products = [], error: productError } = useQuery({
    queryKey: ["sales-products", "stock-dialog"],
    queryFn: () => list({ data: { activeOnly: false } }),
  });
  const { data: attributes = [], error: attributeError } = useQuery({
    queryKey: ["product-attributes"],
    queryFn: () => defs(),
  });
  const product = (products as any[]).find((p) => p.id === productId);
  const [attribute, setAttribute] = useState({
    id: undefined as string | undefined,
    name: "",
    kind: "text" as "text" | "select" | "multiselect" | "number" | "date" | "money",
    options: "",
    scope: "variant" as "variant" | "product",
    isPriceFloor: false,
  });
  const [values, setValues] = useState<Record<string, any>>({});
  const [label, setLabel] = useState("");
  const [variantId, setVariantId] = useState("");
  const [batchCode, setBatchCode] = useState("");
  const [expiry, setExpiry] = useState("");
  const [quantity, setQuantity] = useState("");
  const [adjustment, setAdjustment] = useState({ id: "", delta: "", reason: "" });
  const [showDefinitions, setShowDefinitions] = useState(false);
  const mutation = useMutation({
    mutationFn: async (action: "attribute" | "variant" | "receive" | "adjust") => {
      if (action === "attribute")
        return save({
          data: {
            ...attribute,
            options: attribute.options
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
          },
        });
      if (action === "variant") return variant({ data: { productId, label, attributes: values } });
      if (action === "receive")
        return receive({
          data: {
            productId,
            variantId:
              variantId || product?.sales_product_variants?.find((v: any) => v.is_default)?.id,
            batchCode,
            expiresOn: expiry || null,
            quantity: Number(quantity),
          },
        });
      return adjust({
        data: {
          productId,
          batchId: adjustment.id,
          delta: Number(adjustment.delta),
          reason: adjustment.reason,
        },
      });
    },
    onSuccess: (_result, action) => {
      toast.success("تم الحفظ");
      for (const key of [
        "sales-products",
        "product-attributes",
        "chat-order-products",
        "sales-products-order",
        "chat-products",
      ])
        qc.invalidateQueries({ queryKey: [key] });
      if (action === "attribute")
        setAttribute({
          id: undefined,
          name: "",
          kind: "text",
          options: "",
          scope: "variant",
          isPriceFloor: false,
        });
      if (action === "variant") {
        setValues({});
        setLabel("");
      }
      if (action === "receive") {
        setBatchCode("");
        setQuantity("");
        setExpiry("");
      }
      if (action === "adjust") setAdjustment({ id: "", delta: "", reason: "" });
    },
    onError: (e) => toast.error(e.message),
  });
  const today = new Date().toISOString().slice(0, 10);
  const variants = variantStock(product ?? {});
  const batches = [...(product?.sales_stock_batches ?? [])].sort((a, b) =>
    (a.expires_on ?? "9999").localeCompare(b.expires_on ?? "9999"),
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent dir="rtl" className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>خصائص ومخزون {product?.name ?? "المنتج"}</DialogTitle>
        </DialogHeader>
        {(productError || attributeError) && (
          <p className="text-destructive">
            تعذر تحميل البيانات: {(productError || attributeError)?.message}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          يمكن إنشاء خصائص مثل اللون والمقاس من «تعريف الخصائص»، ثم إضافة متغير لكل تركيبة وإدخال
          كميته باستلام دفعة. كل دفعة لها كمية وصلاحية مستقلة.
        </p>
        <section className="space-y-3">
          <h3 className="font-semibold">الدفعات والكميات المتبقية</h3>
          {!batches.length && (
            <p className="text-sm text-muted-foreground">لا توجد دفعات؛ أضف استلامًا جديدًا.</p>
          )}
          {batches.map((b: any) => (
            <div key={b.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <strong>{variants.find((v: any) => v.id === b.variant_id)?.label}</strong>
                  <p className="text-sm">
                    دفعة {b.batch_code} · الصلاحية: {b.expires_on ?? "غير محددة"}
                  </p>
                </div>
                <div>
                  <strong>{b.quantity} متبقي</strong>
                  {b.expires_on && b.expires_on < today && (
                    <p className="text-destructive text-sm">منتهية — لا تباع</p>
                  )}
                </div>
              </div>
              {canStock && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAdjustment({ id: b.id, delta: "", reason: "" })}
                >
                  تصحيح كمية هذه الدفعة
                </Button>
              )}
              {adjustment.id === b.id && (
                <div data-validation-scope className="grid gap-2 sm:grid-cols-3">
                  <Input required
                    aria-label="تغيير الكمية"
                    type="number"
                    step="0.001"
                    placeholder="تغيير الكمية: 5 أو -2"
                    value={adjustment.delta}
                    onChange={(e) => setAdjustment({ ...adjustment, delta: e.target.value })}
                  />
                  <Input required
                    aria-label="سبب التصحيح"
                    placeholder="سبب التصحيح"
                    value={adjustment.reason}
                    onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })}
                  />
                  <Button validate disabled={mutation.isPending} onClick={() => mutation.mutate("adjust")}>
                    حفظ التصحيح
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold">المتبقي لكل متغير (اللون / المقاس أو خصائصك الأخرى)</h3>
          {variants.map((v: any) => (
            <div key={v.id} className="border rounded-lg p-3">
              <div className="flex justify-between gap-2">
                <strong>{v.label}</strong>
                <strong>{v.quantity} متاح</strong>
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(v.attributes).map(([id, value]) => (
                  <span key={id} className="text-sm bg-muted px-2 py-1 rounded">
                    {(attributes as Attribute[]).find((a) => a.id === id)?.name ?? "خاصية"}:{" "}
                    {Array.isArray(value) ? value.join("، ") : String(value)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
        {canManage && (
          <section data-validation-scope className="border-t pt-4 space-y-3">
            <h3 className="font-semibold">إضافة متغير بخصائص مستقلة</h3>
            <Label>اسم المتغير للعرض</Label>
            <Input required aria-label="اسم التنويعة"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="مثال: أسود / M أو ذاكرة 16GB"
            />
            <ProductAttributeFields
              definitions={(attributes as Attribute[]).filter((a) => a.scope === "variant")}
              values={values}
              onChange={setValues}
              currency={product?.currency}
            />
            <Button validate
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("variant")}
            >
              حفظ المتغير
            </Button>
            <Button variant="outline" onClick={() => setShowDefinitions(!showDefinitions)}>
              تعريف / تعديل خصائص المؤسسة
            </Button>
            {showDefinitions && (
              <div data-validation-scope className="bg-muted/30 border rounded-lg p-3 space-y-2">
                <p className="text-sm">عرّف خصائص تناسب نشاط مؤسستك. اختر ما يلزم لكل منتج.</p>
                <select
                  aria-label="تعديل خاصية"
                  className={selectClass}
                  value={attribute.id ?? ""}
                  onChange={(e) => {
                    const a = (attributes as Attribute[]).find((a) => a.id === e.target.value);
                    setAttribute(
                      a
                        ? {
                            id: a.id,
                            name: a.name,
                            kind: a.kind as typeof attribute.kind,
                            options: a.options.join("\n"),
                            scope: a.scope,
                            isPriceFloor: a.is_price_floor,
                          }
                        : {
                            id: undefined,
                            name: "",
                            kind: "text",
                            options: "",
                            scope: "variant",
                            isPriceFloor: false,
                          },
                    );
                  }}
                >
                  <option value="">خاصية جديدة</option>
                  {(attributes as Attribute[]).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Input required
                  aria-label="اسم الخاصية"
                  value={attribute.name}
                  placeholder="اسم الخاصية: المقاس، الرام، الطول…"
                  onChange={(e) => setAttribute({ ...attribute, name: e.target.value })}
                />
                <select
                  aria-label="نوع الخاصية"
                  className={selectClass}
                  disabled={!!attribute.id}
                  value={attribute.kind}
                  onChange={(e) =>
                    setAttribute({
                      ...attribute,
                      kind: e.target.value as typeof attribute.kind,
                      scope: e.target.value === "money" ? "product" : attribute.scope,
                      isPriceFloor: false,
                    })
                  }
                >
                  <option value="text">نص حر</option>
                  <option value="select">اختيار واحد</option>
                  <option value="multiselect">اختيارات متعددة</option>
                  <option value="number">رقم</option>
                  <option value="date">تاريخ</option>
                  <option value="money">سعر / مبلغ بعملة المنتج</option>
                </select>
                <select
                  aria-label="مكان الخاصية"
                  className={selectClass}
                  disabled={!!attribute.id || attribute.kind === "money"}
                  value={attribute.scope}
                  onChange={(e) =>
                    setAttribute({ ...attribute, scope: e.target.value as "product" | "variant" })
                  }
                >
                  <option value="variant">خاصية تميز متغيرات المخزون (لون، مقاس…)</option>
                  <option value="product">حقل عام للمنتج (تكلفة، مواصفات…)</option>
                </select>
                {attribute.kind === "money" && (
                  <label className="flex gap-2 items-center text-sm">
                    <input
                      type="checkbox"
                      checked={attribute.isPriceFloor}
                      onChange={(e) =>
                        setAttribute({ ...attribute, isPriceFloor: e.target.checked })
                      }
                    />
                    استخدام هذا السعر حدًا أدنى للبيع
                  </label>
                )}
                <p className="text-xs text-muted-foreground">
                  حقول المنتج تُملأ من تعديل المنتج. يُطبّق الحد الأدنى عند تعبئة قيمته للمنتج. حقول
                  السعر تستخدم عملته؛ إذا فُعّل أكثر من حد أدنى يُطبّق الأعلى.
                </p>
                {["select", "multiselect"].includes(attribute.kind) && (
                  <textarea
                    aria-label="الخيارات"
                    className={selectClass}
                    placeholder="كل خيار في سطر"
                    value={attribute.options}
                    onChange={(e) => setAttribute({ ...attribute, options: e.target.value })}
                  />
                )}
                <Button validate
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate("attribute")}
                >
                  حفظ الخاصية
                </Button>
              </div>
            )}
          </section>
        )}
        {canStock && (
          <section data-validation-scope className="border-t pt-4 space-y-3">
            <h3 className="font-semibold">استلام دفعة جديدة</h3>
            <Label>المتغير</Label>
            <select
              required aria-label="متغير الدفعة"
              className={selectClass}
              value={variantId || variants.find((v: any) => v.is_default)?.id || ""}
              onChange={(e) => setVariantId(e.target.value)}
            >
              {variants.map((v: any) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>رقم الدفعة</Label>
                <Input required aria-label="رقم الدفعة"
                  value={batchCode}
                  onChange={(e) => setBatchCode(e.target.value)}
                  placeholder="رقم فريد لكل استلام"
                />
              </div>
              <div>
                <Label>تاريخ انتهاء الصلاحية (اختياري)</Label>
                <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </div>
              <div>
                <Label>الكمية</Label>
                <Input required aria-label="الكمية"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>
            <Button validate
              disabled={
                mutation.isPending
              }
              onClick={() => mutation.mutate("receive")}
            >
              استلام الدفعة
            </Button>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
