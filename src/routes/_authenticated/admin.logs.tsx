import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAuditLog, listImpersonationSessions } from "@/modules/superadmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/logs")({
  component: LogsPage,
});

function LogsPage() {
  const auditFn = useServerFn(listAuditLog);
  const impFn = useServerFn(listImpersonationSessions);
  const auditQ = useQuery({ queryKey: ["sa-audit"], queryFn: () => auditFn({ data: { limit: 200 } }) });
  const impQ = useQuery({ queryKey: ["sa-imp"], queryFn: () => impFn() });

  return (
    <Tabs defaultValue="audit" dir="rtl">
      <TabsList>
        <TabsTrigger value="audit">سجل الأحداث</TabsTrigger>
        <TabsTrigger value="imp">جلسات التنكر</TabsTrigger>
      </TabsList>
      <TabsContent value="audit">
        <Card>
          <CardHeader><CardTitle>السجل ({auditQ.data?.length ?? 0})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-[600px] overflow-y-auto text-sm">
              {(auditQ.data ?? []).map((row: any) => (
                <div key={row.id} className="flex items-center gap-3 p-2 border-b last:border-0">
                  <Badge variant="outline" className="shrink-0">{row.action}</Badge>
                  <div className="flex-1 text-muted-foreground text-xs">
                    {row.target_type}: {row.target_id ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString("ar")}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="imp">
        <Card>
          <CardHeader><CardTitle>جلسات التنكر ({impQ.data?.length ?? 0})</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-right text-muted-foreground border-b">
                  <tr>
                    <th className="py-2">المشرف</th><th>المستهدف</th><th>السبب</th><th>البدء</th><th>الانتهاء</th>
                  </tr>
                </thead>
                <tbody>
                  {(impQ.data ?? []).map((s: any) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 text-xs">{s.admin_user_id?.slice(0, 8)}</td>
                      <td className="text-xs">{s.target_user_id?.slice(0, 8)}</td>
                      <td>{s.reason ?? "—"}</td>
                      <td className="text-xs text-muted-foreground">{new Date(s.started_at).toLocaleString("ar")}</td>
                      <td className="text-xs">{s.ended_at ? new Date(s.ended_at).toLocaleString("ar") : <Badge>نشطة</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
