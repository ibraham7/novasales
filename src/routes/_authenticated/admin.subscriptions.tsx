import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listSubscriptions } from "@/modules/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/subscriptions")({
  component: SubsPage,
});

function SubsPage() {
  const fn = useServerFn(listSubscriptions);
  const q = useQuery({ queryKey: ["sa-subs"], queryFn: () => fn() });

  return (
    <Card>
      <CardHeader><CardTitle>الاشتراكات ({q.data?.length ?? 0})</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-right text-muted-foreground border-b">
              <tr>
                <th className="py-2 px-2">المؤسسة</th>
                <th className="py-2 px-2">الخطة</th>
                <th className="py-2 px-2">الحالة</th>
                <th className="py-2 px-2">الفترة</th>
                <th className="py-2 px-2">تنتهي في</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((s: any) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="py-2 px-2 font-medium">
                    <Link to="/admin/organizations/$id" params={{ id: s.organization_id }} className="hover:underline">
                      {s.organization?.name ?? s.organization_id}
                    </Link>
                  </td>
                  <td className="py-2 px-2">{s.plan?.name ?? "—"}</td>
                  <td className="py-2 px-2"><Badge variant="secondary">{s.status}</Badge></td>
                  <td className="py-2 px-2">{s.billing_period}</td>
                  <td className="py-2 px-2 text-muted-foreground">
                    {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("ar") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
