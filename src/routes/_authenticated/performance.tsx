import { performanceSortKey, performanceLeader } from "@/modules/commerce/performance-model";
import { useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";

import { useQuery } from "@tanstack/react-query";

import { useServerFn } from "@tanstack/react-start";

import {
  Clock3,
  Crown,
  DollarSign,
  Medal,
  Package,
  ShoppingCart,
  Trophy,
  Users,
} from "lucide-react";

import { getSalesPerformance } from "@/modules/commerce/performance.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/performance")({
  component: PerformancePage,
});

type SortKey = "revenue" | "orders" | "products" | "customers" | "response";

function formatNumber(value: number) {
  return new Intl.NumberFormat("ar").format(Number(value || 0));
}

function formatMoney(value: number, currency: string) {
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

function responseTimeLabel(minutes: number | null) {
  if (minutes === null) {
    return "لا توجد بيانات";
  }

  if (minutes < 1) {
    return "أقل من دقيقة";
  }

  if (minutes < 60) {
    return `${Math.round(minutes)} دقيقة`;
  }

  const hours = minutes / 60;

  if (hours < 24) {
    return `${hours.toFixed(1)} ساعة`;
  }

  return `${(hours / 24).toFixed(1)} يوم`;
}

function PerformancePage() {
  const fetchPerformance = useServerFn(getSalesPerformance);

  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");

  const [currency, setCurrency] = useState("all");

  const [sortBy, setSortBy] = useState<SortKey>("orders");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["sales-performance", period, currency],

    queryFn: () =>
      fetchPerformance({
        data: {
          period,

          currency: currency === "all" ? null : currency,
        },
      }),
  });

  const rows = useMemo(() => {
    const result = [...(data?.rows ?? [])];

    result.sort((a, b) => {
      switch (
        performanceSortKey(sortBy, currency === "all" && (data?.currencies.length ?? 0) > 1)
      ) {
        case "revenue":
          return b.revenue - a.revenue;

        case "products":
          return b.productsSold - a.productsSold;

        case "customers":
          return b.customers - a.customers;

        case "response": {
          const aValue = a.avgResponseMinutes ?? Number.POSITIVE_INFINITY;

          const bValue = b.avgResponseMinutes ?? Number.POSITIVE_INFINITY;

          return aValue - bValue;
        }

        case "orders":
        default:
          return b.confirmedOrders - a.confirmedOrders;
      }
    });

    return result;
  }, [data?.rows, data?.currencies, sortBy, currency]);

  const currencies = data?.currencies ?? [];

  const mixedCurrencies = currency === "all" && currencies.length > 1;

  const hasLeader = performanceLeader(rows, performanceSortKey(sortBy, mixedCurrencies));
  return (
    <div className="p-4 md:p-6 space-y-6" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" />

            <h1 className="text-2xl font-bold">أداء المندوبين</h1>
          </div>

          <p className="text-sm text-muted-foreground mt-1">
            متابعة المبيعات والعملاء والمنتجات وسرعة الاستجابة.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={period} onValueChange={(value) => setPeriod(value as typeof period)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="7d">آخر 7 أيام</SelectItem>

              <SelectItem value="30d">آخر 30 يومًا</SelectItem>

              <SelectItem value="90d">آخر 90 يومًا</SelectItem>

              <SelectItem value="all">كل الفترة</SelectItem>
            </SelectContent>
          </Select>

          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="العملة" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="all">كل العملات</SelectItem>

              {currencies.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortKey)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="orders">عدد المبيعات</SelectItem>

              <SelectItem value="revenue" disabled={mixedCurrencies}>
                قيمة المبيعات
              </SelectItem>

              <SelectItem value="products">المنتجات المباعة</SelectItem>

              <SelectItem value="customers">عدد العملاء</SelectItem>

              <SelectItem value="response">سرعة الرد</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          سرعة الرد: من فتح الفرصة إلى أول رسالة واتساب ناجحة أرسلها المندوب الحالي؛ تُستبعد الرسائل
          الداخلية والفاشلة. الفترة بتوقيت UTC.
        </span>
        <button
          type="button"
          className="border rounded px-3 py-2"
          disabled={isFetching}
          onClick={() => refetch()}
        >
          {isFetching ? "جارِ التحديث..." : "تحديث الأداء"}
        </button>
      </div>
      {mixedCurrencies && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          توجد أكثر من عملة. اختر عملة محددة إذا أردت ترتيب المندوبين حسب قيمة المبيعات.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive p-4"
        >
          {error instanceof Error
            ? /تعذر/.test(error.message)
              ? error.message
              : "تعذر تحميل الأداء؛ تحقق من اتصالك وصلاحياتك"
            : "تعذر تحميل التقرير"}
          <button type="button" className="block mt-3 underline" onClick={() => refetch()}>
            إعادة المحاولة
          </button>
        </div>
      )}

      {!error && !isLoading && (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <StatCard
              icon={<Users className="h-5 w-5" />}
              title="المندوبون"
              value={formatNumber(data?.summary.reps ?? 0)}
            />

            <StatCard
              icon={<ShoppingCart className="h-5 w-5" />}
              title="المبيعات المؤكدة"
              value={formatNumber(data?.summary.orders ?? 0)}
            />

            <StatCard
              icon={<Package className="h-5 w-5" />}
              title="الوحدات المباعة"
              value={formatNumber(data?.summary.products ?? 0)}
            />

            <StatCard
              icon={<Users className="h-5 w-5" />}
              title="العملاء"
              value={formatNumber(data?.summary.customers ?? 0)}
            />

            <StatCard
              icon={<DollarSign className="h-5 w-5" />}
              title="قيمة المبيعات"
              value={
                currency === "all" && currencies.length === 0
                  ? "لا توجد مبيعات"
                  : mixedCurrencies
                    ? "اختر العملة"
                    : formatMoney(
                        data?.summary.revenue ?? 0,
                        currency !== "all" ? currency : (currencies[0] ?? "USD"),
                      )
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Medal className="h-5 w-5" />
                ترتيب فريق المبيعات
              </CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-16 text-center text-muted-foreground">
                  جارِ تحميل أداء المندوبين...
                </div>
              ) : rows.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  لا توجد بيانات لمندوبي المبيعات في هذه الفترة.
                </div>
              ) : (
                <div className="divide-y">
                  {rows.map((row, index) => (
                    <div
                      key={row.userId}
                      className="p-4 md:p-5 grid gap-4 lg:grid-cols-[70px_1.4fr_repeat(5,1fr)] lg:items-center hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {index === 0 && hasLeader ? (
                          <Crown className="h-5 w-5 text-amber-500" />
                        ) : (
                          <span className="h-8 w-8 rounded-full bg-muted flex items-center justify-center font-bold">
                            {index + 1}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                          {row.avatarUrl ? (
                            <img
                              src={row.avatarUrl}
                              alt={row.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="font-bold text-primary">{row.name.charAt(0)}</span>
                          )}
                        </div>

                        <div>
                          <div className="font-semibold">{row.name}</div>

                          <Badge variant="secondary" className="mt-1">
                            مندوب مبيعات
                          </Badge>
                        </div>
                      </div>

                      <Metric label="المبيعات" value={formatNumber(row.confirmedOrders)} />

                      <Metric label="الوحدات" value={formatNumber(row.productsSold)} />

                      <Metric label="العملاء" value={formatNumber(row.customers)} />

                      <Metric
                        label="قيمة المبيعات"
                        value={
                          currency === "all" && currencies.length === 0
                            ? "—"
                            : mixedCurrencies
                              ? Object.entries(row.revenueByCurrency)
                                  .map(([curr, value]) => formatMoney(Number(value), curr))
                                  .join(" · ") || "—"
                              : formatMoney(
                                  row.revenue,
                                  currency !== "all" ? currency : (currencies[0] ?? "USD"),
                                )
                        }
                      />

                      <div>
                        <div className="text-xs text-muted-foreground mb-1">متوسط سرعة الرد</div>

                        <div className="flex items-center gap-1.5 font-medium">
                          <Clock3 className="h-4 w-4" />

                          {responseTimeLabel(row.avgResponseMinutes)}
                        </div>

                        <div className="text-[11px] text-muted-foreground mt-1">
                          {row.responseSamples} استجابة محسوبة
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {isLoading && <p role="status">جارِ تحميل أداء المندوبين...</p>}
    </div>
  );
}

function StatCard({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}

          <span className="text-sm">{title}</span>
        </div>

        <div className="text-xl font-bold mt-2">{value}</div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>

      <div className="font-semibold">{value}</div>
    </div>
  );
}
