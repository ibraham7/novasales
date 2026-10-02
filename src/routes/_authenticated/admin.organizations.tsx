import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listOrganizations, createOrganization, createUser } from "@/modules/superadmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, UserPlus } from "lucide-react";
import { toast } from "@/lib/toast";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/organizations")({
  component: OrgsPage,
});

const ROLES = [
  { value: "owner", label: "مالك المؤسسة" },
  { value: "admin", label: "مشرف عام (على المنصة)" },
  { value: "supervisor", label: "مشرف قسم" },
  { value: "sales", label: "مندوب مبيعات" },
] as const;

function OrgsPage() {
  const qc = useQueryClient();
  const fn = useServerFn(listOrganizations);
  const createOrg = useServerFn(createOrganization);
  const createUsr = useServerFn(createUser);

  const q = useQuery({ queryKey: ["sa-orgs"], queryFn: () => fn() });

  const [orgOpen, setOrgOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [busy, setBusy] = useState(false);

  const [userOpen, setUserOpen] = useState(false);
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [uForm, setUForm] = useState({ full_name: "", email: "", password: "", role: "sales" as string });

  async function submitOrg() {
    if (!orgName.trim()) return;
    setBusy(true);
    try {
      await createOrg({ data: { name: orgName.trim(), slug: orgSlug.trim() || undefined } });
      toast.success("تم إنشاء المؤسسة");
      setOrgOpen(false); setOrgName(""); setOrgSlug("");
      qc.invalidateQueries({ queryKey: ["sa-orgs"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  function openAddUser(orgId: string) {
    setUserOrgId(orgId);
    setUForm({ full_name: "", email: "", password: "", role: "sales" });
    setUserOpen(true);
  }

  async function submitUser() {
    if (!uForm.full_name || !uForm.email || !uForm.password) {
      toast.error("املأ الحقول");
      return;
    }
    setBusy(true);
    try {
      await createUsr({ data: { ...uForm, role: uForm.role as any, organization_id: userOrgId ?? undefined } });
      toast.success("تم إنشاء المستخدم");
      setUserOpen(false);
      qc.invalidateQueries({ queryKey: ["sa-orgs"] });
      qc.invalidateQueries({ queryKey: ["sa-users"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>المؤسسات ({q.data?.length ?? 0})</CardTitle>
        <Button size="sm" onClick={() => setOrgOpen(true)}>
          <Plus className="h-4 w-4 ml-1" /> إضافة مؤسسة
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-right text-muted-foreground border-b">
              <tr>
                <th className="py-2 px-2">الاسم</th>
                <th className="py-2 px-2">Slug</th>
                <th className="py-2 px-2">الأعضاء</th>
                <th className="py-2 px-2">الخطة</th>
                <th className="py-2 px-2">الحالة</th>
                <th className="py-2 px-2">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((o: any) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="py-2 px-2 font-medium">
                    <Link to="/admin/organizations/$id" params={{ id: o.id }} className="hover:underline">
                      {o.name}
                    </Link>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{o.slug}</td>
                  <td className="py-2 px-2">{o.member_count}</td>
                  <td className="py-2 px-2">{o.subscription?.plan?.name ?? "—"}</td>
                  <td className="py-2 px-2">
                    {o.subscription ? <Badge variant="secondary">{o.subscription.status}</Badge> : <Badge variant="outline">لا يوجد</Badge>}
                  </td>
                  <td className="py-2 px-2">
                    <Button size="sm" variant="ghost" onClick={() => openAddUser(o.id)} title="إضافة مستخدم">
                      <UserPlus className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={orgOpen} onOpenChange={setOrgOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>مؤسسة جديدة</DialogTitle>
            <DialogDescription>أدخل اسم المؤسسة. الـ Slug اختياري وسيُولّد تلقائياً.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم</Label><Input required aria-label="اسم المؤسسة" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="اسم الشركة" /></div>
            <div><Label>Slug (اختياري)</Label><Input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} placeholder="acme" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrgOpen(false)}>إلغاء</Button>
            <Button validate onClick={submitOrg} disabled={busy}>إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={userOpen} onOpenChange={setUserOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة مستخدم للمؤسسة</DialogTitle>
            <DialogDescription>سيتم إنشاء الحساب وربطه بهذه المؤسسة مباشرة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم الظاهر</Label><Input required aria-label="الاسم الكامل" value={uForm.full_name} onChange={(e) => setUForm({ ...uForm, full_name: e.target.value })} /></div>
            <div><Label>البريد الإلكتروني (اسم المستخدم)</Label><Input required aria-label="البريد الإلكتروني" type="email" value={uForm.email} onChange={(e) => setUForm({ ...uForm, email: e.target.value })} /></div>
            <div><Label>كلمة المرور</Label><Input required aria-label="كلمة المرور" type="text" value={uForm.password} onChange={(e) => setUForm({ ...uForm, password: e.target.value })} placeholder="6 أحرف على الأقل" /></div>
            <div>
              <Label>الصلاحية</Label>
              <Select value={uForm.role} onValueChange={(v) => setUForm({ ...uForm, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserOpen(false)}>إلغاء</Button>
            <Button validate onClick={submitUser} disabled={busy}>إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
