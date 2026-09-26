import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  getDashboardKpis,
  getDashboardRevenueTrend,
  getDashboardStageDistribution,
  getDashboardActivityBreakdown,
  getDashboardAgentPerformance,
  getDashboardDepartmentPerformance,
  getDashboardRecentActivities,
  getDashboardUpcomingTasks,
  getDashboardOverdueTasks,
} from "@/modules/dashboard/dashboard.functions";
import { listDepartments } from "@/modules/organization";
import { listPipelines } from "@/modules/crm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  TrendingUp, TrendingDown, DollarSign, Users, Trophy, XCircle,
  Target, Activity, Clock, Percent, Calendar, AlertTriangle,
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
    from.setMonth(0, 1); from.setHours(0, 0, 0, 0);
  } else {
    const days = RANGE_PRESETS.find((p) => p.key === preset)?.days ?? 30;
    from.setDate(from.getDate() - days);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("ar", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v || 0);
}

function DeltaBadge({ value }: { value: number }) {
  if (!value) return null;
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <Badge variant="outline" className={`gap-1 ${positive ? "text-emerald-600 border-emerald-200" : "text-red-600 border-red-200"}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value)}%
    </Badge>
  );
}

function Dashboard() {
  const [range, setRange] = useState("30d");
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [pipelineId, setPipelineId] = useState<string | undefined>();

  const filters = useMemo(() => ({ ...isoRange(range), departmentId, pipelineId }), [range, departmentId, pipelineId]);

  const kpisFn = useServerFn(getDashboardKpis);
  const revenueFn = useServerFn(getDashboardRevenueTrend);
  const stageFn = useServerFn(getDashboardStageDistribution);
  const activityFn = useServerFn(getDashboardActivityBreakdown);
  const agentFn = useServerFn(getDashboardAgentPerformance);
  const deptFn = useServerFn(getDashboardDepartmentPerformance);
  const recentFn = useServerFn(getDashboardRecentActivities);
  const upcomingFn = useServerFn(getDashboardUpcomingTasks);
  const overdueFn = useServerFn(getDashboardOverdueTasks);
  const depsFn = useServerFn(listDepartments);
  const pipsFn = useServerFn(listPipelines);

  const { data: deps } = useQuery({ queryKey: ["departments"], queryFn: () => depsFn() });
  const { data: pips } = useQuery({ queryKey: ["pipelines"], queryFn: () => pipsFn() });

  const { data: kpis } = useQuery({ queryKey: ["dash-kpis", filters], queryFn: () => kpisFn({ data: filters }) });
  const { data: revenueTrend } = useQuery({ queryKey: ["dash-revtrend", filters], queryFn: () => revenueFn({ data: filters }) });
  const { data: stageDist } = useQuery({ queryKey: ["dash-stage", filters], queryFn: () => stageFn({ data: filters }) });
  const { data: activityBreak } = useQuery({ queryKey: ["dash-act", filters], queryFn: () => activityFn({ data: filters }) });
  const { data: agents } = useQuery({ queryKey: ["dash-agents", filters], queryFn: () => agentFn({ data: filters }) });
  const { data: departments } = useQuery({ queryKey: ["dash-depts", filters], queryFn: () => deptFn({ data: filters }) });
  const { data: recent } = useQuery({ queryKey: ["dash-recent"], queryFn: () => recentFn() });
  const { data: upcoming } = useQuery({ queryKey: ["dash-upcoming"], queryFn: () => upcomingFn() });
  const { data: overdue } = useQuery({ queryKey: ["dash-overdue"], queryFn: () => overdueFn() });

  const kpiCards = [
    { label: "الإيرادات", value: formatCurrency(kpis?.revenue.value ?? 0), delta: kpis?.revenue.delta ?? 0, icon: DollarSign, color: "text-emerald-600 bg-emerald-500/10" },
    { label: "عملاء جدد", value: kpis?.newLeads.value ?? 0, delta: kpis?.newLeads.delta ?? 0, icon: Users, color: "text-primary bg-primary/10" },
    { label: "صفقات ناجحة", value: kpis?.wonDeals.value ?? 0, delta: kpis?.wonDeals.delta ?? 0, icon: Trophy, color: "text-amber-600 bg-amber-500/10" },
    { label: "صفقات مفقودة", value: kpis?.lostDeals.value ?? 0, delta: kpis?.lostDeals.delta ?? 0, icon: XCircle, color: "text-red-600 bg-red-500/10" },
    { label: "قيمة الأنبوب", value: formatCurrency(kpis?.pipelineValue.value ?? 0), delta: 0, icon: Target, color: "text-blue-600 bg-blue-500/10" },
    { label: "الإيراد المتوقع", value: formatCurrency(kpis?.forecastRevenue.value ?? 0), delta: 0, icon: TrendingUp, color: "text-violet-600 bg-violet-500/10" },
    { label: "الأنشطة", value: kpis?.activities.value ?? 0, delta: kpis?.activities.delta ?? 0, icon: Activity, color: "text-cyan-600 bg-cyan-500/10" },
    { label: "متوسط الصفقة", value: formatCurrency(kpis?.avgDealSize.value ?? 0), delta: 0, icon: DollarSign, color: "text-fuchsia-600 bg-fuchsia-500/10" },
    { label: "دورة المبيعات (يوم)", value: kpis?.avgSalesCycleDays.value ?? 0, delta: 0, icon: Clock, color: "text-orange-600 bg-orange-500/10" },
    { label: "نسبة التحويل", value: `${kpis?.conversionRate.value ?? 0}%`, delta: 0, icon: Percent, color: "text-teal-600 bg-teal-500/10" },
    { label: "نسبة الفوز", value: `${kpis?.winRate.value ?? 0}%`, delta: 0, icon: Trophy, color: "text-lime-600 bg-lime-500/10" },
    { label: "زمن الرد (د)", value: kpis?.leadResponseMinutes.value ?? 0, delta: 0, icon: Clock, color: "text-rose-600 bg-rose-500/10" },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">لوحة التحكم</h1>
          <p className="text-muted-foreground mt-1">مؤشرات الأداء وتحليل المبيعات.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((p) => (
                <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={departmentId ?? "all"} onValueChange={(v) => setDepartmentId(v === "all" ? undefined : v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="القسم" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأقسام</SelectItem>
              {(deps ?? []).map((d: any) => (<SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={pipelineId ?? "all"} onValueChange={(v) => setPipelineId(v === "all" ? undefined : v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="القناة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل القنوات</SelectItem>
              {(pips ?? []).map((p: any) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
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
              <div className="text-xl font-bold mt-1 truncate">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">اتجاه الإيرادات</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">توزيع المراحل</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stageDist ?? []} dataKey="value" nameKey="stage" cx="50%" cy="50%" outerRadius={80} label>
                  {(stageDist ?? []).map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">أنواع الأنشطة</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activityBreak ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="type" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">أداء الأقسام</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={departments ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="revenue" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader><CardTitle className="text-base">أداء المندوبين</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-xs text-muted-foreground">
                <th className="p-3 text-right">المندوب</th>
                <th className="p-3">الفرص</th>
                <th className="p-3">فوز</th>
                <th className="p-3">فقد</th>
                <th className="p-3">الإيرادات</th>
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
                  <td className="p-3 text-center">{formatCurrency(a.revenue)}</td>
                  <td className="p-3 text-center">{a.winRate}%</td>
                  <td className="p-3 text-center">{a.avgResponseMinutes}</td>
                  <td className="p-3 text-center">{a.tasksCompleted}</td>
                  <td className="p-3 text-center">{a.activitiesPerDay}</td>
                </tr>
              ))}
              {!agents?.length && (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">لا توجد بيانات</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> أحدث الأنشطة</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(recent ?? []).map((r: any) => (
              <div key={r.id} className="text-sm border-b pb-2 last:border-b-0">
                <div className="font-medium truncate">{r.title}</div>
                <div className="text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleString("ar")}</div>
              </div>
            ))}
            {!recent?.length && <div className="text-sm text-muted-foreground">لا شيء</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calendar className="h-4 w-4" /> مهام قادمة</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(upcoming ?? []).map((t: any) => (
              <div key={t.id} className="text-sm border-b pb-2 last:border-b-0 flex justify-between gap-2">
                <span className="truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(t.due_at).toLocaleDateString("ar")}</span>
              </div>
            ))}
            {!upcoming?.length && <div className="text-sm text-muted-foreground">لا مهام</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2 text-red-600"><AlertTriangle className="h-4 w-4" /> مهام متأخرة</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(overdue ?? []).map((t: any) => (
              <div key={t.id} className="text-sm border-b pb-2 last:border-b-0 flex justify-between gap-2">
                <span className="truncate">{t.title}</span>
                <span className="text-xs text-red-600 shrink-0">{new Date(t.due_at).toLocaleDateString("ar")}</span>
              </div>
            ))}
            {!overdue?.length && <div className="text-sm text-muted-foreground">لا شيء</div>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
