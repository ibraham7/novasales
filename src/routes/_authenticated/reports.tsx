import { createFileRoute } from "@tanstack/react-router";

import { useQuery } from "@tanstack/react-query";

import { useServerFn } from "@tanstack/react-start";

import { useState } from "react";

import { BarChart3, Building2, DollarSign, Package, ShoppingCart, Tag, Users } from "lucide-react";

import { getSalesReports } from "@/modules/commerce";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      {
        title: "التقارير والمحاسبة - NovaSales",
      },
      {
        name: "description",
        content: "تقارير المبيعات والإيرادات والخصومات وأداء المنتجات والمندوبين.",
      },
    ],
  }),

  component: ReportsPage,
});

function ReportsPage() {
  const fetchReports = useServerFn(getSalesReports);

  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");

  const [filters, setFilters] = useState({
    repId: "",
    departmentId: "",
    productId: "",
    currency: "",
  });
  const { data, isError, error, refetch, isFetching, isLoading } = useQuery({
    queryKey: ["sales-reports", period, filters],

    queryFn: () =>
      fetchReports({
        data: {
          period,
          repId: filters.repId || undefined,
          departmentId: filters.departmentId || undefined,
          productId: filters.productId || undefined,
          currency: filters.currency || undefined,
        },
      }),
  });

  const summary = data?.summary;

  return (
    <div className="p-3 sm:p-4 md:p-8 max-w-7xl mx-auto space-y-6" dir="rtl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />

            <h1 className="text-2xl md:text-3xl font-bold">التقارير والمحاسبة</h1>
          </div>

          <p className="text-sm text-muted-foreground mt-1">
            متابعة المبيعات والإيرادات والخصومات وأداء المنتجات والمندوبين.
          </p>
        </div>

        <Select value={period} onValueChange={(value) => setPeriod(value as typeof period)}>
          <SelectTrigger className="w-full sm:w-[170px]">
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="7d">آخر 7 أيام</SelectItem>

            <SelectItem value="30d">آخر 30 يومًا</SelectItem>

            <SelectItem value="90d">آخر 90 يومًا</SelectItem>

            <SelectItem value="all">كل الفترة</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(
          [
            ["repId", "المندوب", data?.options.reps ?? []],
            ["departmentId", "القسم", data?.options.departments ?? []],
            ["productId", "المنتج", data?.options.products ?? []],
            [
              "currency",
              "العملة",
              (data?.options.currencies ?? []).map((id) => ({ id, name: id })),
            ],
          ] as const
        ).map(([key, label, options]) => (
          <label key={key} className="space-y-1 text-sm">
            <span>{label}</span>
            <select
              className="h-9 w-full rounded-md border bg-background px-2"
              value={filters[key]}
              onChange={(e) => setFilters((old) => ({ ...old, [key]: e.target.value }))}
            >
              <option value="">الكل</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          الفترة حتى وقت تحديث التقرير؛ الحركة اليومية بتوقيت UTC. عند اختيار منتج تُحسب قيم بنوده
          فقط.
        </span>
        <button
          type="button"
          className="border rounded-md px-3 py-2"
          onClick={() => setFilters({ repId: "", departmentId: "", productId: "", currency: "" })}
        >
          مسح الفلاتر
        </button>
        <button
          type="button"
          className="border rounded-md px-3 py-2"
          disabled={isFetching}
          onClick={() => refetch()}
        >
          {isFetching ? "جارِ التحديث..." : "تحديث التقرير"}
        </button>
      </div>
      {isError ? (
        <Card>
          <CardContent role="alert" className="py-10 text-center space-y-3">
            <p>
              تعذر تحميل التقارير.{" "}
              {error instanceof Error && /تعذر/.test(error.message)
                ? error.message
                : "تحقق من اتصالك وصلاحية عرض التقارير."}
            </p>
            <button type="button" className="border rounded-md px-3 py-2" onClick={() => refetch()}>
              إعادة المحاولة
            </button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-20 text-center text-muted-foreground">
            جارِ تحميل التقارير...
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
            <SummaryCard
              icon={<ShoppingCart className="h-5 w-5" />}
              label="الطلبات المؤكدة"
              value={summary?.orders ?? 0}
            />

            <SummaryCard
              icon={<Users className="h-5 w-5" />}
              label="العملاء"
              value={summary?.customers ?? 0}
            />

            <SummaryCard
              icon={<Package className="h-5 w-5" />}
              label="الوحدات المباعة"
              value={summary?.unitsSold ?? 0}
            />

            <SummaryCard
              icon={<Tag className="h-5 w-5" />}
              label="الخصومات"
              value={formatCurrencyMap(summary?.discounts ?? {})}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-5 w-5 text-primary" />
                إجمالي الإيرادات
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="text-2xl md:text-3xl font-bold">
                {formatCurrencyMap(summary?.currencies ?? {})}
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                يتم إبقاء كل عملة منفصلة ولا يتم جمع العملات المختلفة بدون سعر تحويل.
              </p>
            </CardContent>
          </Card>

          <div className="grid xl:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">المبيعات حسب المندوب</CardTitle>
              </CardHeader>

              <CardContent className="p-0">
                <div className="divide-y">
                  {(data?.reps ?? []).length === 0 ? (
                    <Empty />
                  ) : (
                    data?.reps.map((rep, index) => (
                      <div key={rep.id} className="p-4 flex items-center gap-3">
                        <div className="w-8 text-sm font-bold text-muted-foreground">
                          #{index + 1}
                        </div>

                        <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                          {rep.name.charAt(0).toUpperCase()}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">{rep.name}</div>

                          <div className="text-xs text-muted-foreground mt-1">
                            {rep.orders} طلب · {rep.customers} عميل · {rep.units} وحدة
                          </div>
                        </div>

                        <div className="font-semibold text-sm text-left" dir="ltr">
                          {formatCurrencyMap(rep.currencies)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">المبيعات حسب المنتج</CardTitle>
              </CardHeader>

              <CardContent className="p-0">
                <div className="divide-y">
                  {(data?.products ?? []).length === 0 ? (
                    <Empty />
                  ) : (
                    data?.products.map((product, index) => (
                      <div
                        key={`${product.productId}-${product.name}`}
                        className="p-4 flex items-center gap-3"
                      >
                        <div className="w-8 text-sm font-bold text-muted-foreground">
                          #{index + 1}
                        </div>

                        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">{product.name}</div>

                          <div className="text-xs text-muted-foreground mt-1">
                            {product.units} وحدة · {product.orders} طلب
                          </div>
                        </div>

                        <div className="font-semibold text-sm text-left" dir="ltr">
                          {formatCurrencyMap(product.currencies)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-5 w-5 text-primary" />
                المبيعات حسب القسم
              </CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              <div className="divide-y">
                {(data?.departments ?? []).length === 0 ? (
                  <Empty />
                ) : (
                  data?.departments.map((department) => (
                    <div
                      key={department.id}
                      className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-center"
                    >
                      <div className="col-span-2 md:col-span-1 font-semibold">
                        {department.name}
                      </div>

                      <SmallStat label="الطلبات" value={department.orders} />

                      <SmallStat label="العملاء" value={department.customers} />

                      <SmallStat label="الوحدات" value={department.units} />

                      <SmallStat label="الإيراد" value={formatCurrencyMap(department.currencies)} />
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الحركة اليومية</CardTitle>
            </CardHeader>

            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full min-w-[650px] text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="text-right p-3">التاريخ</th>

                    <th className="text-right p-3">الطلبات</th>

                    <th className="text-right p-3">الوحدات</th>

                    <th className="text-right p-3">الإيراد</th>

                    <th className="text-right p-3">الخصومات</th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {(data?.daily ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        لا توجد بيانات.
                      </td>
                    </tr>
                  ) : (
                    data?.daily
                      .slice()
                      .reverse()
                      .map((row) => (
                        <tr key={row.date}>
                          <td className="p-3 font-medium">
                            {new Date(`${row.date}T00:00:00`).toLocaleDateString("ar")}
                          </td>

                          <td className="p-3">{row.orders}</td>

                          <td className="p-3">{row.units}</td>

                          <td className="p-3 font-semibold">{formatCurrencyMap(row.currencies)}</td>

                          <td className="p-3">{formatCurrencyMap(row.discounts)}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
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
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}

          <span className="text-xs sm:text-sm">{label}</span>
        </div>

        <div className="font-bold text-xl md:text-2xl mt-2">{value}</div>
      </CardContent>
    </Card>
  );
}

function SmallStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>

      <div className="font-semibold mt-1">{value}</div>
    </div>
  );
}

function Empty() {
  return <div className="p-10 text-center text-muted-foreground">لا توجد بيانات حتى الآن.</div>;
}

function formatCurrencyMap(values: Record<string, number>) {
  const entries = Object.entries(values).filter(([, value]) => Number(value) !== 0);

  if (entries.length === 0) {
    return "0";
  }

  return entries
    .map(([currency, value]) => {
      try {
        return new Intl.NumberFormat("ar", {
          style: "currency",

          currency,

          maximumFractionDigits: 2,
        }).format(Number(value));
      } catch {
        return `${Number(value).toFixed(2)} ${currency}`;
      }
    })
    .join(" · ");
}
