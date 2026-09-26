
import {
    createFileRoute,
} from "@tanstack/react-router";

import {
    useQuery,
} from "@tanstack/react-query";

import {
    useServerFn,
} from "@tanstack/react-start";

import {
    useMemo,
    useState,
} from "react";

import {
    ChevronDown,
    ChevronUp,
    Package,
    Search,
    ShoppingBag,
    UserRoundCheck,
    Users,
} from "lucide-react";

import {
    listBuyers,
} from "@/modules/commerce";

import {
    Input,
} from "@/components/ui/input";

import {
    Card,
    CardContent,
} from "@/components/ui/card";

import {
    Badge,
} from "@/components/ui/badge";

import {
    Button,
} from "@/components/ui/button";

import {
    cn,
} from "@/lib/utils";

export const Route =
    createFileRoute(
        "/_authenticated/buyers",
    )({
        head: () => ({
            meta: [
                {
                    title:
                        "العملاء المشترون - NovaSales",
                },
                {
                    name:
                        "description",
                    content:
                        "عرض العملاء الذين أتموا عمليات شراء وتفاصيل مشترياتهم.",
                },
            ],
        }),

        component:
            BuyersPage,
    });

function BuyersPage() {
    const fetchBuyers =
        useServerFn(
            listBuyers,
        );

    const [
        search,
        setSearch,
    ] = useState("");

    const [
        expanded,
        setExpanded,
    ] =
        useState<string | null>(
            null,
        );

    const {
        data: buyers = [],
        isLoading,
    } = useQuery({
        queryKey: [
            "buyers",
        ],

        queryFn: () =>
            fetchBuyers(),
    });

    const filtered =
        useMemo(() => {
            const query =
                search
                    .trim()
                    .toLowerCase();

            if (!query) {
                return buyers;
            }

            return buyers.filter(
                (buyer: any) => {
                    const haystack = [
                        buyer.name,

                        ...buyer.reps.map(
                            (rep: any) =>
                                rep.name,
                        ),

                        ...buyer.departments,

                        ...buyer.orders.flatMap(
                            (order: any) =>
                                order.items.map(
                                    (item: any) =>
                                        `${item.name} ${item.sku ?? ""}`,
                                ),
                        ),
                    ]
                        .join(" ")
                        .toLowerCase();

                    return haystack.includes(
                        query,
                    );
                },
            );
        }, [
            buyers,
            search,
        ]);

    const totalOrders =
        buyers.reduce(
            (
                sum: number,
                buyer: any,
            ) =>
                sum +
                buyer.orderCount,
            0,
        );

    const totalProducts =
        buyers.reduce(
            (
                sum: number,
                buyer: any,
            ) =>
                sum +
                buyer.productsCount,
            0,
        );

    return (
        <div
            className="p-3 sm:p-4 md:p-8 max-w-7xl mx-auto space-y-6"
            dir="rtl"
        >
            <header>
                <div className="flex items-center gap-2">
                    <UserRoundCheck className="h-6 w-6 text-primary" />

                    <h1 className="text-2xl md:text-3xl font-bold">
                        العملاء المشترون
                    </h1>
                </div>

                <p className="text-sm text-muted-foreground mt-1">
                    جميع العملاء الذين
                    لديهم عمليات بيع مؤكدة
                    وتفاصيل مشترياتهم.
                </p>
            </header>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <SummaryCard
                    icon={
                        <Users className="h-5 w-5" />
                    }
                    label="العملاء"
                    value={
                        buyers.length
                    }
                />

                <SummaryCard
                    icon={
                        <ShoppingBag className="h-5 w-5" />
                    }
                    label="الطلبات"
                    value={
                        totalOrders
                    }
                />

                <SummaryCard
                    icon={
                        <Package className="h-5 w-5" />
                    }
                    label="المنتجات المباعة"
                    value={
                        totalProducts
                    }
                />
            </div>

            <Card>
                <CardContent className="p-3 sm:p-4">
                    <div className="relative">
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
                            placeholder="ابحث باسم العميل، المندوب أو المنتج..."
                            className="pr-9"
                        />
                    </div>
                </CardContent>
            </Card>

            {isLoading ? (
                <Card>
                    <CardContent className="py-16 text-center text-muted-foreground">
                        جارِ تحميل العملاء...
                    </CardContent>
                </Card>
            ) : filtered.length ===
                0 ? (
                <Card>
                    <CardContent className="py-16 text-center">
                        <UserRoundCheck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />

                        <p className="font-medium">
                            لا توجد نتائج
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {filtered.map(
                        (buyer: any) => {
                            const isOpen =
                                expanded ===
                                buyer.contactId;

                            return (
                                <Card
                                    key={
                                        buyer.contactId
                                    }
                                    className="overflow-hidden"
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setExpanded(
                                                isOpen
                                                    ? null
                                                    : buyer.contactId,
                                            )
                                        }
                                        className="w-full text-right"
                                    >
                                        <CardContent className="p-4">
                                            <div className="flex items-start gap-3">
                                                <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">
                                                    {String(
                                                        buyer.name,
                                                    )
                                                        .charAt(0)
                                                        .toUpperCase()}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <h2 className="font-semibold truncate">
                                                                {
                                                                    buyer.name
                                                                }
                                                            </h2>

                                                            <div className="flex flex-wrap gap-1 mt-1.5">
                                                                {buyer.departments.map(
                                                                    (
                                                                        department: string,
                                                                    ) => (
                                                                        <Badge
                                                                            key={
                                                                                department
                                                                            }
                                                                            variant="secondary"
                                                                        >
                                                                            {
                                                                                department
                                                                            }
                                                                        </Badge>
                                                                    ),
                                                                )}
                                                            </div>
                                                        </div>

                                                        {isOpen ? (
                                                            <ChevronUp className="h-5 w-5 text-muted-foreground shrink-0" />
                                                        ) : (
                                                            <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
                                                        )}
                                                    </div>

                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                                                        <Info
                                                            label="الطلبات"
                                                            value={
                                                                buyer.orderCount
                                                            }
                                                        />

                                                        <Info
                                                            label="المنتجات"
                                                            value={
                                                                buyer.productsCount
                                                            }
                                                        />

                                                        <Info
                                                            label="آخر شراء"
                                                            value={formatDate(
                                                                buyer.lastPurchaseAt,
                                                            )}
                                                        />

                                                        <Info
                                                            label="إجمالي المشتريات"
                                                            value={formatCurrencyMap(
                                                                buyer.currencies,
                                                            )}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </button>

                                    {isOpen && (
                                        <div className="border-t bg-muted/20">
                                            <div className="p-4 space-y-4">
                                                {buyer.reps.length >
                                                    0 && (
                                                        <div>
                                                            <div className="text-xs text-muted-foreground mb-2">
                                                                المندوبون
                                                            </div>

                                                            <div className="flex flex-wrap gap-2">
                                                                {buyer.reps.map(
                                                                    (
                                                                        rep: any,
                                                                    ) => (
                                                                        <Badge
                                                                            key={
                                                                                rep.id
                                                                            }
                                                                            variant="outline"
                                                                        >
                                                                            {
                                                                                rep.name
                                                                            }
                                                                        </Badge>
                                                                    ),
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                <div className="space-y-3">
                                                    {buyer.orders.map(
                                                        (
                                                            order: any,
                                                        ) => (
                                                            <OrderCard
                                                                key={
                                                                    order.id
                                                                }
                                                                order={
                                                                    order
                                                                }
                                                            />
                                                        ),
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </Card>
                            );
                        },
                    )}
                </div>
            )}
        </div>
    );
}

function OrderCard({
    order,
}: {
    order: any;
}) {
    return (
        <div className="border rounded-xl bg-background overflow-hidden">
            <div className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b">
                <div>
                    <div className="font-medium">
                        طلب #
                        {String(
                            order.id,
                        ).slice(
                            0,
                            8,
                        )}
                    </div>

                    <div className="text-xs text-muted-foreground mt-1">
                        {formatDateTime(
                            order.confirmedAt,
                        )}

                        {order.salesRep?.name
                            ? ` · ${order.salesRep.name}`
                            : ""}
                    </div>
                </div>

                <div className="text-left sm:text-right">
                    <div className="font-bold">
                        {formatMoney(
                            order.total,
                            order.currency,
                        )}
                    </div>

                    {order.discountTotal >
                        0 && (
                            <div className="text-xs text-muted-foreground">
                                خصم:{" "}
                                {formatMoney(
                                    order.discountTotal,
                                    order.currency,
                                )}
                            </div>
                        )}
                </div>
            </div>

            <div className="divide-y">
                {order.items.map(
                    (item: any) => (
                        <div
                            key={
                                item.id
                            }
                            className="p-3 flex items-center justify-between gap-3"
                        >
                            <div className="min-w-0">
                                <div className="font-medium text-sm truncate">
                                    {
                                        item.name
                                    }
                                </div>

                                <div className="text-xs text-muted-foreground mt-1">
                                    الكمية:{" "}
                                    {
                                        item.quantity
                                    }

                                    {item.sku
                                        ? ` · SKU: ${item.sku}`
                                        : ""}
                                </div>
                            </div>

                            <div
                                className="text-sm font-semibold whitespace-nowrap"
                                dir="ltr"
                            >
                                {formatMoney(
                                    item.lineTotal,
                                    order.currency,
                                )}
                            </div>
                        </div>
                    ),
                )}
            </div>
        </div>
    );
}

function SummaryCard({
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
                <div className="flex items-center gap-2 text-muted-foreground">
                    {icon}

                    <span className="text-[11px] sm:text-sm">
                        {label}
                    </span>
                </div>

                <div className="text-xl md:text-2xl font-bold mt-2">
                    {value}
                </div>
            </CardContent>
        </Card>
    );
}

function Info({
    label,
    value,
}: {
    label: string;
    value:
    React.ReactNode;
}) {
    return (
        <div>
            <div className="text-[11px] text-muted-foreground">
                {label}
            </div>

            <div
                className={cn(
                    "text-sm font-semibold mt-0.5",
                )}
            >
                {value}
            </div>
        </div>
    );
}

function formatMoney(
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
        ).format(
            Number(
                value ?? 0,
            ),
        );
    } catch {
        return `${Number(
            value ?? 0,
        ).toFixed(2)} ${currency}`;
    }
}

function formatCurrencyMap(
    values: Record<
        string,
        number
    >,
) {
    const entries =
        Object.entries(
            values,
        );

    if (
        !entries.length
    ) {
        return "—";
    }

    return entries
        .map(
            ([
                currency,
                value,
            ]) =>
                formatMoney(
                    value,
                    currency,
                ),
        )
        .join(" · ");
}

function formatDate(
    value:
        | string
        | null,
) {
    if (!value) {
        return "—";
    }

    return new Date(
        value,
    ).toLocaleDateString(
        "ar",
    );
}

function formatDateTime(
    value:
        | string
        | null,
) {
    if (!value) {
        return "—";
    }

    return new Date(
        value,
    ).toLocaleString(
        "ar",
        {
            dateStyle:
                "medium",

            timeStyle:
                "short",
        },
    );
}