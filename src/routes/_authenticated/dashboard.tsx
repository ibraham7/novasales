import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getDashboardOverview } from "@/modules/dashboard/dashboard.functions";
import { Button } from "@/components/ui/button";
import { currencyName } from "@/modules/commerce/currencies";
import { usePlatformSettings } from "@/modules/superadmin/use-platform-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Trophy,
  XCircle,
  Target,
  Activity,
  Clock,
  Percent,
  Calendar,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "لوحة التحكم - Sales Ops" },
      { name: "description", content: "مؤشرات الأداء ونتائج المبيعات والأنشطة." },
      { property: "og:title", content: "لوحة التحكم - Sales Ops" },
      { property: "og:description", content: "مؤشرات الأداء ونتائج المبيعات والأنشطة." },
    ],
  }),
  component: Dashboard,
});

const RANGE_PRESETS = [
  { key: "7d", label: "آخر 7 أيام", days: 7 },
  { key: "30d", label: "آخر 30 يوم", days: 30 },
  { key: "90d", label: "آخر 90 يوم", days: 90 },
  { key: "ytd", label: "منذ بداية السنة", days: 0 },
];

function isoRange(preset: string) {
  const to = new Date();
  const from = new Date();
  if (preset === "ytd") {
    from.setUTCMonth(0, 1);
    from.setUTCHours(0, 0, 0, 0);
  } else {
    const days = RANGE_PRESETS.find((p) => p.key === preset)?.days ?? 30;
    from.setUTCDate(from.getUTCDate() - (days - 1));
    from.setUTCHours(0, 0, 0, 0);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

const COLORS = [
  "var(--primary)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatCurrency(v: number, currency = "USD") {
  return new Intl.NumberFormat("ar", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(v || 0);
}

function DeltaBadge({ value }: { value: number | null }) {
  if (!value) return null;
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <Badge
      variant="outline"
      className={`gap-1 ${positive ? "text-emerald-600 border-emerald-200" : "text-red-600 border-red-200"}`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(value)}%
    </Badge>
  );
}

function Dashboard() {
  const platform = usePlatformSettings();
  const [currency, setCurrency] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState("30d");
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [pipelineId, setPipelineId] = useState<string | undefined>();

  const filters = useMemo(
    () => ({
      ...isoRange(range),
      departmentId,
      pipelineId,
      currency: currency ?? platform.default_currency,
    }),
    [range, departmentId, pipelineId, currency, platform.default_currency, revision],
  );
  const load = useServerFn(getDashboardOverview);
  const query = useQuery({
    queryKey: ["dashboard-overview", filters],
    queryFn: () => load({ data: filters }),
  });
  const {
    kpis,
    revenueTrend,
    stageDist,
    activityBreak,
    agents,
    departments,
    recent,
    upcoming,
    overdue,
  } = query.data ?? {};
  const deps = query.data?.departmentOptions ?? [];
  const pips = query.data?.pipelineOptions ?? [];
  const selectedCurrency = query.data?.currency ?? filters.currency;
  const money = (value: number) => formatCurrency(value, selectedCurrency);
  if (query.isPending)
    return <p className="p-6 text-muted-foreground">جارٍ تحميل إحصاءات لوحة التحكم…</p>;
  if (query.isError)
    return (
      <div className="p-6 space-y-3">
        <p role="alert">
          {query.error instanceof Error ? query.error.message : "تعذر تحميل لوحة التحكم"}
        </p>
        <Button onClick={() => query.refetch()}>إعادة المحاولة</Button>
      </div>
    );

  const kpiCards = [
    {
      label: "قيمة الفرص الناجحة",
      value: money(kpis?.revenue.value ?? 0),
      delta: kpis?.revenue.delta ?? null,
      icon: DollarSign,
      color: "text-emerald-600 bg-emerald-500/10",
    },
    {
      label: "عملاء جدد",
      value: kpis?.newLeads.value ?? 0,
      delta: kpis?.newLeads.delta ?? null,
      icon: Users,
      color: "text-primary bg-primary/10",
    },
    {
      label: "صفقات ناجحة",
      value: kpis?.wonDeals.value ?? 0,
      delta: kpis?.wonDeals.delta ?? null,
      icon: Trophy,
      color: "text-amber-600 bg-amber-500/10",
    },
    {
      label: "صفقات مفقودة",
      value: kpis?.lostDeals.value ?? 0,
      delta: kpis?.lostDeals.delta ?? null,
      icon: XCircle,
      color: "text-red-600 bg-red-500/10",
    },
    {
      label: "قيمة الفرص المفتوحة",
      value: money(kpis?.pipelineValue.value ?? 0),
      delta: 0,
      icon: Target,
      color: "text-blue-600 bg-blue-500/10",
    },
    {
      label: "الإيراد المتوقع",
      value: money(kpis?.forecastRevenue.value ?? 0),
      delta: 0,
      icon: TrendingUp,
      color: "text-violet-600 bg-violet-500/10",
    },
    {
      label: "الأنشطة",
      value: kpis?.activities.value ?? 0,
      delta: kpis?.activities.delta ?? null,
      icon: Activity,
      color: "text-cyan-600 bg-cyan-500/10",
    },
    {
      label: "متوسط الصفقة",
      value: money(kpis?.avgDealSize.value ?? 0),
      delta: 0,
      icon: DollarSign,
      color: "text-fuchsia-600 bg-fuchsia-500/10",
    },
    {
      label: "دورة المبيعات (يوم)",
      value: kpis?.avgSalesCycleDays.value ?? 0,
      delta: 0,
      icon: Clock,
      color: "text-orange-600 bg-orange-500/10",
    },
    {
      label: "نسبة التحويل",
      value: `${kpis?.conversionRate.value ?? 0}%`,
      delta: 0,
      icon: Percent,
      color: "text-teal-600 bg-teal-500/10",
    },
    {
      label: "نسبة الفوز",
      value: `${kpis?.winRate.value ?? 0}%`,
      delta: 0,
      icon: Trophy,
      color: "text-lime-600 bg-lime-500/10",
    },
    {
      label: "زمن الرد (د)",
      value: kpis?.leadResponseMinutes.value ?? "لا توجد ردود مسجلة",
      delta: 0,
      icon: Clock,
      color: "text-rose-600 bg-rose-500/10",
    },
  ];

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">لوحة التحكم</h1>
          <p className="text-muted-foreground mt-1">
            مؤشرات الفرص والأنشطة. المبالغ تخص العملة المختارة؛ أعداد الفرص والعملاء تشمل جميع
            العملات.
          </p>
        </div>
        <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => setRevision((v) => v + 1)}
          >
            تحديث
          </Button>
          <Select value={selectedCurrency} onValueChange={setCurrency}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                ...new Set([
                  platform.default_currency,
                  selectedCurrency,
                  ...(query.data?.currencies ?? []),
                ]),
              ].map((code) => (
                <SelectItem key={code} value={code}>
                  {currencyName(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-full min-w-32 flex-1 sm:w-40 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={departmentId ?? "all"}
            onValueChange={(v) => setDepartmentId(v === "all" ? undefined : v)}
          >
            <SelectTrigger className="w-full min-w-32 flex-1 sm:w-44 sm:flex-none">
              <SelectValue placeholder="القسم" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأقسام</SelectItem>
              {(deps ?? []).map((d: any) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={pipelineId ?? "all"}
            onValueChange={(v) => setPipelineId(v === "all" ? undefined : v)}
          >
            <SelectTrigger className="w-full min-w-32 flex-1 sm:w-44 sm:flex-none">
              <SelectValue placeholder="مسار المبيعات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل مسارات المبيعات</SelectItem>
              {(pips ?? []).map((p: any) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {kpiCards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${c.color}`}>
                  <c.icon className="h-4 w-4" />
                </div>
                <DeltaBadge value={c.delta} />
              </div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="text-lg font-bold mt-1 break-words">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">اتجاه قيمة الفرص الناجحة</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(value: any) => money(Number(value))} />
                <Line
                  name="قيمة الفرص الناجحة"
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">توزيع المراحل</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {stageDist?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stageDist ?? []}
                    dataKey="count"
                    nameKey="stage"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                  >
                    {(stageDist ?? []).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">
                لا توجد فرص مفتوحة ضمن الفلاتر المختارة
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">أنواع الأنشطة</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {activityBreak?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityBreak ?? []}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="type"
                    tickFormatter={(value) =>
                      (
                        ({
                          call: "مكالمة",
                          meeting: "اجتماع",
                          message: "رسالة",
                          email: "بريد",
                          note: "ملاحظة",
                          system: "نظام",
                          custom: "مخصص",
                        }) as Record<string, string>
                      )[value] ?? value
                    }
                    fontSize={11}
                  />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Bar
                    name="عدد الأنشطة"
                    dataKey="count"
                    fill="var(--chart-2)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد أنشطة مسجلة في هذه الفترة</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">أداء الأقسام</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {departments?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={departments ?? []}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip formatter={(value: any) => money(Number(value))} />
                  <Bar
                    name="قيمة الفرص الناجحة"
                    dataKey="revenue"
                    fill="var(--chart-3)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد بيانات للأقسام ضمن هذه الفترة</p>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">أداء المندوبين</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-xs text-muted-foreground">
                <th className="p-3 text-right">المندوب</th>
                <th className="p-3">الفرص</th>
                <th className="p-3">فوز</th>
                <th className="p-3">فقد</th>
                <th className="p-3">قيمة الفرص الناجحة</th>
                <th className="p-3">نسبة الفوز</th>
                <th className="p-3">زمن الرد (د)</th>
                <th className="p-3">مهام</th>
                <th className="p-3">أنشطة/يوم</th>
              </tr>
            </thead>
            <tbody>
              {(agents ?? []).map((a: any) => (
                <tr key={a.user_id} className="border-t hover:bg-muted/20">
                  <td className="p-3 text-right font-medium">{a.name}</td>
                  <td className="p-3 text-center">{a.opps}</td>
                  <td className="p-3 text-center text-emerald-600">{a.won}</td>
                  <td className="p-3 text-center text-red-600">{a.lost}</td>
                  <td className="p-3 text-center">{money(a.revenue)}</td>
                  <td className="p-3 text-center">{a.winRate}%</td>
                  <td className="p-3 text-center">{a.avgResponseMinutes ?? "لا توجد ردود"}</td>
                  <td className="p-3 text-center">{a.tasksCompleted}</td>
                  <td className="p-3 text-center">{a.activitiesPerDay}</td>
                </tr>
              ))}
              {!agents?.length && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    لا توجد بيانات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        المهام القادمة والمتأخرة حسب الوقت الحالي ونطاق القسم والمسار؛ أحدث الأنشطة حسب الفترة
        المختارة. الأنشطة تعني السجلات المسجلة داخل إدارة العملاء؛ المهام غير المرتبطة بعميل أو فرصة
        لا تدخل في فلتر القسم أو المسار. الفرص المفتوحة تُعرض بحالتها الحالية. جميع تواريخ الإحصاءات
        بتوقيت UTC.
      </p>
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> أحدث الأنشطة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(recent ?? []).map((r: any) => (
              <div key={r.id} className="text-sm border-b pb-2 last:border-b-0">
                <div className="font-medium truncate">{r.title}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.occurred_at).toLocaleString("ar")}
                </div>
              </div>
            ))}
            {!recent?.length && <div className="text-sm text-muted-foreground">لا شيء</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" /> مهام قادمة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(upcoming ?? []).map((t: any) => (
              <div
                key={t.id}
                className="text-sm border-b pb-2 last:border-b-0 flex justify-between gap-2"
              >
                <span className="truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(t.due_at).toLocaleDateString("ar")}
                </span>
              </div>
            ))}
            {!upcoming?.length && <div className="text-sm text-muted-foreground">لا مهام</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-4 w-4" /> مهام متأخرة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(overdue ?? []).map((t: any) => (
              <div
                key={t.id}
                className="text-sm border-b pb-2 last:border-b-0 flex justify-between gap-2"
              >
                <span className="truncate">{t.title}</span>
                <span className="text-xs text-red-600 shrink-0">
                  {new Date(t.due_at).toLocaleDateString("ar")}
                </span>
              </div>
            ))}
            {!overdue?.length && <div className="text-sm text-muted-foreground">لا شيء</div>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
