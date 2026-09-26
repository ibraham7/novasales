import {
    createFileRoute,
} from "@tanstack/react-router";
import {
    ProductAnalytics,
} from "@/components/commerce/product-analytics";
import {
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";

import {
    useServerFn,
} from "@tanstack/react-start";

import {
    ChangeEvent,
    DragEvent,
    useMemo,
    useRef,
    useState,
} from "react";

import {
    Boxes,
    DollarSign,
    ImageIcon,
    Package,
    Pencil,
    Plus,
    Search,
    SlidersHorizontal,
    Upload,
    X,
} from "lucide-react";

import {
    toast,
} from "sonner";

import {
    adjustInventory,
    createProductImageUpload,
    listProducts,
    upsertProduct,
} from "@/modules/commerce";

import {
    supabase,
} from "@/integrations/supabase/client";

import {
    Button,
} from "@/components/ui/button";

import {
    Input,
} from "@/components/ui/input";

import {
    Label,
} from "@/components/ui/label";

import {
    Card,
    CardContent,
} from "@/components/ui/card";

import {
    Badge,
} from "@/components/ui/badge";

import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import {
    Textarea,
} from "@/components/ui/textarea";

import {
    cn,
} from "@/lib/utils";

export const Route =
    createFileRoute(
        "/_authenticated/products",
    )({
        head: () => ({
            meta: [
                {
                    title:
                        "المنتجات والمخزون - NovaSales",
                },
                {
                    name:
                        "description",
                    content:
                        "إدارة المنتجات والأسعار والمخزون.",
                },
            ],
        }),

        component:
            ProductsPage,
    });

type ProductRow = {
    id: string;
    name: string;
    sku: string | null;
    description:
    | string
    | null;
    price: number;
    currency: string;
    images:
    | string[]
    | null;
    is_active: boolean;

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
    imageUrl: string;
    isActive: boolean;
};

const EMPTY_FORM: ProductForm =
{
    name: "",
    sku: "",
    description: "",
    price: "",
    currency: "USD",
    imageUrl: "",
    isActive: true,
};

const MAX_FILE_SIZE =
    5 * 1024 * 1024;

const ACCEPTED_TYPES =
    new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    ]);

function getStock(
    product: ProductRow,
) {
    const inventory =
        product.sales_inventory;

    if (
        Array.isArray(
            inventory,
        )
    ) {
        return Number(
            inventory[0]
                ?.quantity ?? 0,
        );
    }

    return Number(
        inventory?.quantity ??
        0,
    );
}

function formatPrice(
    value: number,
    currency: string,
) {
    try {
        return new Intl.NumberFormat(
            "ar",
            {
                style: "currency",
                currency,
                maximumFractionDigits:
                    2,
            },
        ).format(value);
    } catch {
        return `${value.toFixed(
            2,
        )} ${currency}`;
    }
}

function ProductsPage() {
    const qc =
        useQueryClient();

    const fileInputRef =
        useRef<HTMLInputElement>(
            null,
        );

    const fetchProducts =
        useServerFn(
            listProducts,
        );

    const saveProduct =
        useServerFn(
            upsertProduct,
        );

    const changeInventory =
        useServerFn(
            adjustInventory,
        );

    const createUpload =
        useServerFn(
            createProductImageUpload,
        );

    const [
        search,
        setSearch,
    ] = useState("");

    const [
        showInactive,
        setShowInactive,
    ] = useState(false);

    const [
        productDialogOpen,
        setProductDialogOpen,
    ] = useState(false);

    const [
        form,
        setForm,
    ] =
        useState<ProductForm>(
            EMPTY_FORM,
        );

    const [
        imageUploading,
        setImageUploading,
    ] = useState(false);

    const [
        dragActive,
        setDragActive,
    ] = useState(false);

    const [
        stockDialog,
        setStockDialog,
    ] =
        useState<ProductRow | null>(
            null,
        );

    const [
        stockDelta,
        setStockDelta,
    ] = useState("");

    const [
        stockReason,
        setStockReason,
    ] = useState("");

    const {
        data: products = [],
        isLoading,
        isFetching,
    } = useQuery({
        queryKey: [
            "sales-products",
            showInactive,
        ],

        queryFn: () =>
            fetchProducts({
                data: {
                    activeOnly:
                        !showInactive,
                },
            }),
    });

    const filteredProducts =
        useMemo(() => {
            const q =
                search
                    .trim()
                    .toLowerCase();

            if (!q) {
                return products as ProductRow[];
            }

            return (
                products as ProductRow[]
            ).filter(
                (product) =>
                    product.name
                        .toLowerCase()
                        .includes(q) ||
                    product.sku
                        ?.toLowerCase()
                        .includes(q) ||
                    product.description
                        ?.toLowerCase()
                        .includes(q),
            );
        }, [
            products,
            search,
        ]);

    const totalProducts =
        products.length;

    const totalUnits =
        useMemo(
            () =>
                (
                    products as ProductRow[]
                ).reduce(
                    (
                        sum,
                        product,
                    ) =>
                        sum +
                        getStock(
                            product,
                        ),
                    0,
                ),
            [
                products,
            ],
        );

    const outOfStock =
        useMemo(
            () =>
                (
                    products as ProductRow[]
                ).filter(
                    (product) =>
                        getStock(
                            product,
                        ) <= 0,
                ).length,
            [
                products,
            ],
        );

    const inventoryValue =
        useMemo(
            () =>
                (
                    products as ProductRow[]
                ).reduce(
                    (
                        sum,
                        product,
                    ) =>
                        sum +
                        getStock(
                            product,
                        ) *
                        Number(
                            product.price,
                        ),
                    0,
                ),
            [
                products,
            ],
        );

    const productMutation =
        useMutation({
            mutationFn:
                () => {
                    const price =
                        Number(
                            form.price,
                        );

                    if (
                        !form.name.trim()
                    ) {
                        throw new Error(
                            "اسم المنتج مطلوب",
                        );
                    }

                    if (
                        !Number.isFinite(
                            price,
                        ) ||
                        price < 0
                    ) {
                        throw new Error(
                            "السعر غير صالح",
                        );
                    }

                    const images =
                        form.imageUrl.trim()
                            ? [
                                form.imageUrl.trim(),
                            ]
                            : [];

                    return saveProduct({
                        data: {
                            id: form.id,

                            name:
                                form.name.trim(),

                            sku:
                                form.sku.trim() ||
                                null,

                            description:
                                form.description.trim() ||
                                null,

                            price,

                            currency:
                                form.currency
                                    .trim()
                                    .toUpperCase() ||
                                "USD",

                            images,

                            isActive:
                                form.isActive,
                        },
                    });
                },

            onSuccess: () => {
                toast.success(
                    form.id
                        ? "تم تحديث المنتج"
                        : "تمت إضافة المنتج",
                );

                setProductDialogOpen(
                    false,
                );

                setForm(
                    EMPTY_FORM,
                );

                qc.invalidateQueries({
                    queryKey: [
                        "sales-products",
                    ],
                });
            },

            onError:
                (error) => {
                    toast.error(
                        error instanceof
                            Error
                            ? error.message
                            : "تعذر حفظ المنتج",
                    );
                },
        });

    const inventoryMutation =
        useMutation({
            mutationFn:
                () => {
                    if (
                        !stockDialog
                    ) {
                        throw new Error(
                            "لم يتم تحديد المنتج",
                        );
                    }

                    const quantityDelta =
                        Number(
                            stockDelta,
                        );

                    if (
                        !Number.isFinite(
                            quantityDelta,
                        ) ||
                        quantityDelta ===
                        0 ||
                        !Number.isInteger(
                            quantityDelta,
                        )
                    ) {
                        throw new Error(
                            "أدخل كمية صحيحة غير صفرية",
                        );
                    }

                    return changeInventory({
                        data: {
                            productId:
                                stockDialog.id,

                            quantityDelta,

                            reason:
                                stockReason.trim() ||
                                undefined,
                        },
                    });
                },

            onSuccess: () => {
                toast.success(
                    "تم تحديث المخزون",
                );

                setStockDialog(
                    null,
                );

                setStockDelta(
                    "",
                );

                setStockReason(
                    "",
                );

                qc.invalidateQueries({
                    queryKey: [
                        "sales-products",
                    ],
                });
            },

            onError:
                (error) => {
                    toast.error(
                        error instanceof
                            Error
                            ? error.message
                            : "تعذر تحديث المخزون",
                    );
                },
        });

    async function uploadImage(
        file: File,
    ) {
        if (
            !ACCEPTED_TYPES.has(
                file.type,
            )
        ) {
            toast.error(
                "الصورة يجب أن تكون JPG أو PNG أو WebP أو GIF",
            );

            return;
        }

        if (
            file.size >
            MAX_FILE_SIZE
        ) {
            toast.error(
                "حجم الصورة يجب ألا يتجاوز 5MB",
            );

            return;
        }

        setImageUploading(
            true,
        );

        try {
            const signed =
                await createUpload({
                    data: {
                        fileName:
                            file.name,

                        contentType:
                            file.type as
                            | "image/jpeg"
                            | "image/png"
                            | "image/webp"
                            | "image/gif",
                    },
                });

            const {
                error,
            } =
                await supabase.storage
                    .from(
                        signed.bucket,
                    )
                    .uploadToSignedUrl(
                        signed.path,
                        signed.token,
                        file,
                        {
                            contentType:
                                file.type,

                            cacheControl:
                                "3600",
                        },
                    );

            if (error) {
                throw error;
            }

            const {
                data: publicUrlData,
            } =
                supabase.storage
                    .from(
                        signed.bucket,
                    )
                    .getPublicUrl(
                        signed.path,
                    );

            setForm(
                (old) => ({
                    ...old,

                    imageUrl:
                        publicUrlData
                            .publicUrl,
                }),
            );

            toast.success(
                "تم رفع الصورة",
            );
        } catch (error) {
            toast.error(
                error instanceof
                    Error
                    ? error.message
                    : "تعذر رفع الصورة",
            );
        } finally {
            setImageUploading(
                false,
            );
        }
    }

    function onFileChange(
        event: ChangeEvent<HTMLInputElement>,
    ) {
        const file =
            event.target
                .files?.[0];

        if (file) {
            void uploadImage(
                file,
            );
        }

        event.target.value =
            "";
    }

    function onDrop(
        event: DragEvent<HTMLDivElement>,
    ) {
        event.preventDefault();

        setDragActive(
            false,
        );

        const file =
            event.dataTransfer
                .files?.[0];

        if (file) {
            void uploadImage(
                file,
            );
        }
    }

    function openCreateProduct() {
        setForm(
            EMPTY_FORM,
        );

        setProductDialogOpen(
            true,
        );
    }

    function openEditProduct(
        product: ProductRow,
    ) {
        setForm({
            id:
                product.id,

            name:
                product.name,

            sku:
                product.sku ??
                "",

            description:
                product.description ??
                "",

            price:
                String(
                    product.price,
                ),

            currency:
                product.currency ??
                "USD",

            imageUrl:
                product.images?.[0] ??
                "",

            isActive:
                product.is_active,
        });

        setProductDialogOpen(
            true,
        );
    }

    return (
        <div className="p-3 sm:p-4 md:p-8 max-w-7xl mx-auto">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 md:mb-8">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold">
                        المنتجات والمخزون
                    </h1>

                    <p className="text-sm text-muted-foreground mt-1">
                        إدارة المنتجات
                        والأسعار والكميات
                        المتوفرة للمبيعات.
                    </p>
                </div>

                <Dialog
                    open={
                        productDialogOpen
                    }
                    onOpenChange={(
                        open,
                    ) => {
                        setProductDialogOpen(
                            open,
                        );

                        if (!open) {
                            setForm(
                                EMPTY_FORM,
                            );
                        }
                    }}
                >
                    <DialogTrigger
                        asChild
                    >
                        <Button
                            onClick={
                                openCreateProduct
                            }
                            className="w-full sm:w-auto"
                        >
                            <Plus className="h-4 w-4 ml-2" />

                            إضافة منتج
                        </Button>
                    </DialogTrigger>

                    <DialogContent
                        dir="rtl"
                        className="w-[calc(100%-1rem)] sm:max-w-xl max-h-[92vh] overflow-y-auto"
                    >
                        <DialogHeader>
                            <DialogTitle>
                                {form.id
                                    ? "تعديل المنتج"
                                    : "إضافة منتج جديد"}
                            </DialogTitle>
                        </DialogHeader>

                        <div className="grid gap-4 py-2">
                            <div className="space-y-2">
                                <Label>
                                    اسم المنتج *
                                </Label>

                                <Input
                                    value={
                                        form.name
                                    }
                                    onChange={(
                                        event,
                                    ) =>
                                        setForm(
                                            (old) => ({
                                                ...old,
                                                name:
                                                    event
                                                        .target
                                                        .value,
                                            }),
                                        )
                                    }
                                    placeholder="مثال: هاتف Nova X"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>
                                        SKU
                                    </Label>

                                    <Input
                                        value={
                                            form.sku
                                        }
                                        onChange={(
                                            event,
                                        ) =>
                                            setForm(
                                                (old) => ({
                                                    ...old,

                                                    sku:
                                                        event
                                                            .target
                                                            .value,
                                                }),
                                            )
                                        }
                                        placeholder="NV-X-001"
                                        dir="ltr"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>
                                        السعر *
                                    </Label>

                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={
                                            form.price
                                        }
                                        onChange={(
                                            event,
                                        ) =>
                                            setForm(
                                                (old) => ({
                                                    ...old,

                                                    price:
                                                        event
                                                            .target
                                                            .value,
                                                }),
                                            )
                                        }
                                        placeholder="0.00"
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>
                                    العملة
                                </Label>

                                <Input
                                    value={
                                        form.currency
                                    }
                                    onChange={(
                                        event,
                                    ) =>
                                        setForm(
                                            (old) => ({
                                                ...old,

                                                currency:
                                                    event
                                                        .target
                                                        .value
                                                        .toUpperCase(),
                                            }),
                                        )
                                    }
                                    maxLength={8}
                                    placeholder="USD"
                                    dir="ltr"
                                />
                            </div>

                            {/* Product image */}
                            <div className="space-y-2">
                                <Label>
                                    صورة المنتج
                                </Label>

                                <input
                                    ref={
                                        fileInputRef
                                    }
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                    className="hidden"
                                    onChange={
                                        onFileChange
                                    }
                                />

                                {form.imageUrl ? (
                                    <div className="relative rounded-xl overflow-hidden border bg-muted">
                                        <img
                                            src={
                                                form.imageUrl
                                            }
                                            alt="معاينة المنتج"
                                            className="w-full h-52 object-cover"
                                        />

                                        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent flex justify-between items-end">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                disabled={
                                                    imageUploading
                                                }
                                                onClick={() =>
                                                    fileInputRef.current?.click()
                                                }
                                            >
                                                <Upload className="h-4 w-4 ml-1.5" />

                                                تغيير الصورة
                                            </Button>

                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="destructive"
                                                className="h-8 w-8"
                                                onClick={() =>
                                                    setForm(
                                                        (old) => ({
                                                            ...old,
                                                            imageUrl:
                                                                "",
                                                        }),
                                                    )
                                                }
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        onDragEnter={(
                                            event,
                                        ) => {
                                            event.preventDefault();

                                            setDragActive(
                                                true,
                                            );
                                        }}
                                        onDragOver={(
                                            event,
                                        ) => {
                                            event.preventDefault();

                                            setDragActive(
                                                true,
                                            );
                                        }}
                                        onDragLeave={() =>
                                            setDragActive(
                                                false,
                                            )
                                        }
                                        onDrop={
                                            onDrop
                                        }
                                        onClick={() =>
                                            !imageUploading &&
                                            fileInputRef.current?.click()
                                        }
                                        className={cn(
                                            "border-2 border-dashed rounded-xl p-7 cursor-pointer transition-colors text-center",
                                            dragActive
                                                ? "border-primary bg-primary/5"
                                                : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/40",
                                            imageUploading &&
                                            "opacity-60 cursor-wait",
                                        )}
                                    >
                                        <div className="h-12 w-12 mx-auto rounded-full bg-muted flex items-center justify-center">
                                            <Upload className="h-5 w-5 text-muted-foreground" />
                                        </div>

                                        <p className="font-medium text-sm mt-3">
                                            {imageUploading
                                                ? "جارِ رفع الصورة..."
                                                : "اضغط لاختيار صورة أو اسحبها هنا"}
                                        </p>

                                        <p className="text-xs text-muted-foreground mt-1">
                                            JPG, PNG,
                                            WebP أو GIF —
                                            حتى 5MB
                                        </p>
                                    </div>
                                )}

                                <div className="pt-1">
                                    <p className="text-xs text-muted-foreground mb-2">
                                        أو استخدم رابط
                                        صورة مباشر
                                    </p>

                                    <Input
                                        value={
                                            form.imageUrl
                                        }
                                        onChange={(
                                            event,
                                        ) =>
                                            setForm(
                                                (old) => ({
                                                    ...old,

                                                    imageUrl:
                                                        event
                                                            .target
                                                            .value,
                                                }),
                                            )
                                        }
                                        placeholder="https://..."
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>
                                    وصف المنتج
                                </Label>

                                <Textarea
                                    value={
                                        form.description
                                    }
                                    onChange={(
                                        event,
                                    ) =>
                                        setForm(
                                            (old) => ({
                                                ...old,

                                                description:
                                                    event
                                                        .target
                                                        .value,
                                            }),
                                        )
                                    }
                                    placeholder="تفاصيل المنتج..."
                                    rows={4}
                                />
                            </div>

                            <label className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={
                                        form.isActive
                                    }
                                    onChange={(
                                        event,
                                    ) =>
                                        setForm(
                                            (old) => ({
                                                ...old,

                                                isActive:
                                                    event
                                                        .target
                                                        .checked,
                                            }),
                                        )
                                    }
                                    className="h-4 w-4"
                                />

                                <div>
                                    <p className="font-medium text-sm">
                                        المنتج نشط
                                    </p>

                                    <p className="text-xs text-muted-foreground">
                                        المنتجات غير
                                        النشطة لا تظهر
                                        للمندوب داخل
                                        الكتالوج.
                                    </p>
                                </div>
                            </label>
                        </div>

                        <DialogFooter>
                            <Button
                                className="w-full sm:w-auto"
                                onClick={() =>
                                    productMutation.mutate()
                                }
                                disabled={
                                    productMutation.isPending ||
                                    imageUploading
                                }
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
                <StatCard
                    icon={
                        <Package className="h-5 w-5" />
                    }
                    label="المنتجات"
                    value={
                        totalProducts
                    }
                />

                <StatCard
                    icon={
                        <Boxes className="h-5 w-5" />
                    }
                    label="الوحدات بالمخزون"
                    value={
                        totalUnits
                    }
                />

                <StatCard
                    icon={
                        <SlidersHorizontal className="h-5 w-5" />
                    }
                    label="نفد من المخزون"
                    value={
                        outOfStock
                    }
                />

                <StatCard
                    icon={
                        <DollarSign className="h-5 w-5" />
                    }
                    label="قيمة المخزون"
                    value={inventoryValue.toLocaleString(
                        "ar",
                    )}
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
                                value={
                                    search
                                }
                                onChange={(
                                    event,
                                ) =>
                                    setSearch(
                                        event.target
                                            .value,
                                    )
                                }
                                placeholder="ابحث باسم المنتج أو SKU..."
                                className="pr-9"
                            />
                        </div>

                        <Button
                            variant={
                                showInactive
                                    ? "secondary"
                                    : "outline"
                            }
                            onClick={() =>
                                setShowInactive(
                                    (value) =>
                                        !value,
                                )
                            }
                            className="w-full sm:w-auto"
                        >
                            {showInactive
                                ? "إخفاء غير النشطة"
                                : "عرض جميع المنتجات"}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {isLoading ? (
                <Card>
                    <CardContent className="py-16 text-center text-muted-foreground">
                        جارٍ تحميل
                        المنتجات...
                    </CardContent>
                </Card>
            ) : filteredProducts.length ===
                0 ? (
                <Card>
                    <CardContent className="py-16 text-center">
                        <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />

                        <p className="font-medium">
                            {search
                                ? "لا توجد نتائج"
                                : "لا توجد منتجات بعد"}
                        </p>

                        <p className="text-sm text-muted-foreground mt-1">
                            {search
                                ? "جرّب البحث بكلمة مختلفة."
                                : "أضف أول منتج للبدء بإدارة المخزون."}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {filteredProducts.map(
                            (product) => {
                                const stock =
                                    getStock(
                                        product,
                                    );

                                const image =
                                    product.images?.[0];

                                return (
                                    <Card
                                        key={
                                            product.id
                                        }
                                        className="overflow-hidden"
                                    >
                                        <div className="aspect-[16/10] sm:aspect-[16/9] bg-muted relative overflow-hidden">
                                            {image ? (
                                                <img
                                                    src={
                                                        image
                                                    }
                                                    alt={
                                                        product.name
                                                    }
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
                                                </div>
                                            )}

                                            <div className="absolute top-2 right-2 sm:top-3 sm:right-3 flex flex-wrap gap-1.5">
                                                <Badge
                                                    variant={
                                                        product.is_active
                                                            ? "default"
                                                            : "secondary"
                                                    }
                                                >
                                                    {product.is_active
                                                        ? "نشط"
                                                        : "غير نشط"}
                                                </Badge>

                                                <Badge
                                                    variant={
                                                        stock <= 0
                                                            ? "destructive"
                                                            : stock <= 5
                                                                ? "secondary"
                                                                : "outline"
                                                    }
                                                >
                                                    {stock <=
                                                        0
                                                        ? "نفد المخزون"
                                                        : `${stock} متوفر`}
                                                </Badge>
                                            </div>
                                        </div>

                                        <CardContent className="p-3 sm:p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <h2 className="font-semibold text-base sm:text-lg truncate">
                                                        {
                                                            product.name
                                                        }
                                                    </h2>

                                                    {product.sku && (
                                                        <p
                                                            className="text-xs text-muted-foreground mt-1 truncate"
                                                            dir="ltr"
                                                        >
                                                            SKU:{" "}
                                                            {
                                                                product.sku
                                                            }
                                                        </p>
                                                    )}
                                                </div>

                                                <p
                                                    className="font-bold text-sm sm:text-base whitespace-nowrap"
                                                    dir="ltr"
                                                >
                                                    {formatPrice(
                                                        Number(
                                                            product.price,
                                                        ),
                                                        product.currency,
                                                    )}
                                                </p>
                                            </div>

                                            {product.description && (
                                                <p className="text-sm text-muted-foreground mt-3 line-clamp-2 min-h-10">
                                                    {
                                                        product.description
                                                    }
                                                </p>
                                            )}

                                            <div className="grid grid-cols-2 gap-2 mt-4 sm:mt-5">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        openEditProduct(
                                                            product,
                                                        )
                                                    }
                                                >
                                                    <Pencil className="h-4 w-4 ml-1" />

                                                    تعديل
                                                </Button>

                                                <Button
                                                    size="sm"
                                                    onClick={() => {
                                                        setStockDialog(
                                                            product,
                                                        );

                                                        setStockDelta(
                                                            "",
                                                        );

                                                        setStockReason(
                                                            "",
                                                        );
                                                    }}
                                                >
                                                    <Boxes className="h-4 w-4 ml-1" />

                                                    المخزون
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            },
                        )}
                    </div>

                    {isFetching && (
                        <p className="text-xs text-muted-foreground mt-4">
                            جارٍ تحديث
                            البيانات...
                        </p>
                    )}
                </>
            )}

            {/* Inventory dialog */}
            <Dialog
                open={
                    !!stockDialog
                }
                onOpenChange={(
                    open,
                ) => {
                    if (!open) {
                        setStockDialog(
                            null,
                        );

                        setStockDelta(
                            "",
                        );

                        setStockReason(
                            "",
                        );
                    }
                }}
            >
                <DialogContent
                    dir="rtl"
                    className="w-[calc(100%-1rem)] sm:max-w-lg"
                >
                    <DialogHeader>
                        <DialogTitle>
                            تعديل المخزون
                        </DialogTitle>
                    </DialogHeader>

                    {stockDialog && (
                        <div className="space-y-5">
                            <div className="rounded-lg border p-4">
                                <p className="font-medium">
                                    {
                                        stockDialog.name
                                    }
                                </p>

                                <p className="text-sm text-muted-foreground mt-1">
                                    الكمية الحالية:{" "}
                                    <strong>
                                        {getStock(
                                            stockDialog,
                                        )}
                                    </strong>
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>
                                    تغيير الكمية
                                </Label>

                                <Input
                                    type="number"
                                    step="1"
                                    value={
                                        stockDelta
                                    }
                                    onChange={(
                                        event,
                                    ) =>
                                        setStockDelta(
                                            event.target
                                                .value,
                                        )
                                    }
                                    placeholder="مثال: 10 أو -3"
                                    dir="ltr"
                                />

                                <p className="text-xs text-muted-foreground">
                                    استخدم رقمًا
                                    موجبًا لإضافة
                                    مخزون، وسالبًا
                                    للخصم.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>
                                    سبب التعديل
                                </Label>

                                <Textarea
                                    value={
                                        stockReason
                                    }
                                    onChange={(
                                        event,
                                    ) =>
                                        setStockReason(
                                            event.target
                                                .value,
                                        )
                                    }
                                    placeholder="مثال: توريد جديد، تصحيح مخزون..."
                                    rows={3}
                                />
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            className="w-full sm:w-auto"
                            onClick={() =>
                                inventoryMutation.mutate()
                            }
                            disabled={
                                inventoryMutation.isPending ||
                                !stockDelta ||
                                Number(
                                    stockDelta,
                                ) === 0
                            }
                        >
                            {inventoryMutation.isPending
                                ? "جارٍ التحديث..."
                                : "حفظ المخزون"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
}: {
    icon:
    React.ReactNode;

    label:
    string;

    value:
    React.ReactNode;
}) {
    return (
        <Card>
            <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    {icon}

                    <span className="text-[11px] sm:text-sm">
                        {label}
                    </span>
                </div>

                <div className="text-lg sm:text-2xl font-bold">
                    {value}
                </div>
            </CardContent>
        </Card>
    );
}