import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPlatformStats, getRevenueChart } from "@/modules/superadmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, CreditCard, DollarSign, MessageSquare, TrendingUp, Sparkles, Zap } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: OverviewPage,
});

function OverviewPage() {
  const stats = useServerFn(getPlatformStats);
  const revenue = useServerFn(getRevenueChart);
  const statsQ = useQuery({ queryKey: ["sa-stats"], queryFn: () => stats() });
  const revQ = useQuery({ queryKey: ["sa-revenue"], queryFn: () => revenue() });

  const s = statsQ.data;
  const kpis = [
    { label: "المؤسسات", value: s?.organizations ?? 0, icon: Building2 },
    { label: "المستخدمون", value: s?.users ?? 0, icon: Users },
    { label: "اشتراكات نشطة", value: s?.activeSubscriptions ?? 0, icon: CreditCard },
    { label: "MRR", value: `$${(s?.mrr ?? 0).toLocaleString()}`, icon: DollarSign },
    { label: "الإيرادات الكلية", value: `$${(s?.revenueTotal ?? 0).toLocaleString()}`, icon: TrendingUp },
    { label: "تجارب", value: s?.trialingSubscriptions ?? 0, icon: Sparkles },
    { label: "الرسائل", value: (s?.messages ?? 0).toLocaleString(), icon: MessageSquare },
    { label: "أتمتات فعّالة", value: s?.activeWorkflows ?? 0, icon: Zap },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                <k.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className="text-xl font-bold">{k.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الإيرادات - آخر 12 شهر</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revQ.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
