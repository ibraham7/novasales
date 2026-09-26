import {
    useMemo,
    useState,
} from "react";

import {
    useQuery,
} from "@tanstack/react-query";

import {
    useServerFn,
} from "@tanstack/react-start";

import {
    BarChart3,
    DollarSign,
    Package,
    Send,
    ShoppingCart,
    Tag,
} from "lucide-react";

import {
    getProductAnalytics,
} from "@/modules/commerce";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

import {
    Badge,
} from "@/components/ui/badge";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type SortKey =
    | "most-sold"
    | "least-sold"
    | "revenue"
    | "sent"
    | "asked"
    | "discount";

function money(
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

export function ProductAnalytics() {
    const fetchAnalytics =
        useServerFn(
            getProductAnalytics,
        );

    const [
        period,
        setPeriod,
    ] = useState<
        "7d" | "30d" | "90d" | "all"
    >("30d");

    const [
        sort,
        setSort,
    ] =
        useState<SortKey>(
            "most-sold",
        );

    const {
        data,
        isLoading,
    } = useQuery({
        queryKey: [
            "product-analytics",
            period,
        ],

        queryFn: () =>
            fetchAnalytics({
                data: {
                    period,
                },
            }),
    });

    const rows =
        useMemo(() => {
            const result = [
                ...(data?.rows ??
                    []),
            ];

            result.sort(
                (a, b) => {
                    switch (
                    sort
                    ) {
                        case "least-sold":
                            return (
                                a.unitsSold -
                                b.unitsSold
                            );

                        case "revenue":
                            return (
                                b.revenue -
                                a.revenue
                            );

                        case "sent":
                            return (
                                b.sentCount -
                                a.sentCount
                            );

                        case "asked":
                            return (
                                b.askedCount -
                                a.askedCount
                            );

                        case "discount":
                            return (
                                b.discount -
                                a.discount
                            );

                        case "most-sold":
                        default:
                            return (
                                b.unitsSold -
                                a.unitsSold
                            );
                    }
                },
            );

            return result;
        }, [
            data?.rows,
            sort,
        ]);

    return (
        <div className="space-y-4 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-primary" />

                        تحليلات المنتجات
                    </h2>

                    <p className="text-xs text-muted-foreground mt-1">
                        أداء المنتجات
                        والمبيعات وتفاعل
                        المندوبين مع العملاء.
                    </p>
                </div>

                <div className="flex gap-2">
                    <Select
                        value={
                            period
                        }
                        onValueChange={(
                            value,
                        ) =>
                            setPeriod(
                                value as typeof period,
                            )
                        }
                    >
                        <SelectTrigger className="w-[140px]">
                            <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                            <SelectItem value="7d">
                                7 أيام
                            </SelectItem>

                            <SelectItem value="30d">
                                30 يومًا
                            </SelectItem>

                            <SelectItem value="90d">
                                90 يومًا
                            </SelectItem>

                            <SelectItem value="all">
                                كل الفترة
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    <Select
                        value={
                            sort
                        }
                        onValueChange={(
                            value,
                        ) =>
                            setSort(
                                value as SortKey,
                            )
                        }
                    >
                        <SelectTrigger className="w-[170px]">
                            <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                            <SelectItem value="most-sold">
                                الأكثر مبيعًا
                            </SelectItem>

                            <SelectItem value="least-sold">
                                الأقل مبيعًا
                            </SelectItem>

                            <SelectItem value="revenue">
                                الأعلى إيرادًا
                            </SelectItem>

                            <SelectItem value="sent">
                                الأكثر إرسالًا
                            </SelectItem>

                            <SelectItem value="asked">
                                الأكثر سؤالًا
                            </SelectItem>

                            <SelectItem value="discount">
                                الأعلى خصمًا
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-5 gap-2 sm:gap-3">
                <MetricCard
                    icon={
                        <Package className="h-4 w-4" />
                    }
                    title="الوحدات المباعة"
                    value={
                        data?.summary
                            .totalUnitsSold ??
                        0
                    }
                />

                <MetricCard
                    icon={
                        <ShoppingCart className="h-4 w-4" />
                    }
                    title="الطلبات"
                    value={
                        data?.summary
                            .totalOrders ??
                        0
                    }
                />

                <MetricCard
                    icon={
                        <DollarSign className="h-4 w-4" />
                    }
                    title="الإيراد"
                    value={
                        Number(
                            data?.summary
                                .totalRevenue ??
                            0,
                        ).toLocaleString(
                            "ar",
                        )
                    }
                />

                <MetricCard
                    icon={
                        <Tag className="h-4 w-4" />
                    }
                    title="إجمالي الخصومات"
                    value={
                        Number(
                            data?.summary
                                .totalDiscount ??
                            0,
                        ).toLocaleString(
                            "ar",
                        )
                    }
                />

                <MetricCard
                    icon={
                        <Send className="h-4 w-4" />
                    }
                    title="مرات الإرسال"
                    value={
                        data?.summary
                            .totalSent ??
                        0
                    }
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        ترتيب المنتجات
                    </CardTitle>
                </CardHeader>

                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="py-12 text-center text-muted-foreground">
                            جارِ تحميل
                            التحليلات...
                        </div>
                    ) : rows.length ===
                        0 ? (
                        <div className="py-12 text-center text-muted-foreground">
                            لا توجد بيانات
                            حتى الآن.
                        </div>
                    ) : (
                        <div className="divide-y">
                            {rows.map(
                                (
                                    row,
                                    index,
                                ) => (
                                    <div
                                        key={
                                            row.productId
                                        }
                                        className="p-3 sm:p-4 grid gap-3 md:grid-cols-[40px_1.4fr_repeat(5,1fr)] md:items-center"
                                    >
                                        <div className="font-bold text-muted-foreground">
                                            #
                                            {index +
                                                1}
                                        </div>

                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="h-11 w-11 rounded-lg bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                                                {row.image ? (
                                                    <img
                                                        src={
                                                            row.image
                                                        }
                                                        alt={
                                                            row.name
                                                        }
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <Package className="h-5 w-5 text-muted-foreground" />
                                                )}
                                            </div>

                                            <div className="min-w-0">
                                                <div className="font-semibold truncate">
                                                    {
                                                        row.name
                                                    }
                                                </div>

                                                <div className="flex gap-1 mt-1">
                                                    {row.sku && (
                                                        <Badge variant="outline">
                                                            {
                                                                row.sku
                                                            }
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <Stat
                                            label="المباع"
                                            value={`${row.unitsSold}`}
                                        />

                                        <Stat
                                            label="الطلبات"
                                            value={`${row.confirmedOrders}`}
                                        />

                                        <Stat
                                            label="الإيراد"
                                            value={money(
                                                row.revenue,
                                                row.currency,
                                            )}
                                        />

                                        <Stat
                                            label="الإرسال"
                                            value={`${row.sentCount}`}
                                        />

                                        <Stat
                                            label="متوسط الخصم"
                                            value={`${row.averageDiscountPercent.toFixed(
                                                1,
                                            )}%`}
                                        />
                                    </div>
                                ),
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            <p className="text-[11px] text-muted-foreground">
                ملاحظة: «الأكثر سؤالًا»
                يعتمد على سجلات
                interaction_type = asked.
                حاليًا نحن نسجل إرسال
                المنتج تلقائيًا، أما سؤال
                العميل عن المنتج فسنربطه
                تلقائيًا في مرحلة تحليل
                رسائل العملاء.
            </p>
        </div>
    );
}

function MetricCard({
    icon,
    title,
    value,
}: {
    icon:
    React.ReactNode;

    title:
    string;

    value:
    React.ReactNode;
}) {
    return (
        <Card>
            <CardContent className="p-3 sm:p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    {icon}

                    {title}
                </div>

                <div className="text-lg sm:text-xl font-bold mt-2">
                    {value}
                </div>
            </CardContent>
        </Card>
    );
}

function Stat({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div>
            <div className="text-[11px] text-muted-foreground">
                {label}
            </div>

            <div className="font-semibold text-sm mt-0.5">
                {value}
            </div>
        </div>
    );
}