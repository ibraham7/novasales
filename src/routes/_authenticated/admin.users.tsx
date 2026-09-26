import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAllUsers,
  setUserRole,
  toggleUserBan,
  startImpersonation,
  createUser,
  deleteUser,
  addUserToOrganization,
  updateUserCredentials,
  listOrganizations,
} from "@/modules/superadmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Ban, UserCheck, UserCog, Trash2, Plus, Building2, KeyRound } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: UsersPage,
});

const ROLES = [
  { value: "owner", label: "مالك المؤسسة" },
  { value: "supervisor", label: "مشرف عام" },
  { value: "department_supervisor", label: "مشرف قسم" },
  { value: "sales", label: "مندوب مبيعات" },
] as const;

function roleLabel(v: string) {
  if (v === "admin") return "سوبر أدمن";
  if (v === "user") return "مندوب مبيعات";
  return ROLES.find((r) => r.value === v)?.label ?? v;
}

function random7() {
  return String(Math.floor(1000000 + Math.random() * 9000000));
}

function UsersPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllUsers);
  const orgsFn = useServerFn(listOrganizations);
  const setRole = useServerFn(setUserRole);
  const ban = useServerFn(toggleUserBan);
  const imp = useServerFn(startImpersonation);
  const createUsr = useServerFn(createUser);
  const delUsr = useServerFn(deleteUser);
  const addToOrg = useServerFn(addUserToOrganization);
  const updCreds = useServerFn(updateUserCredentials);

  const q = useQuery({ queryKey: ["sa-users"], queryFn: () => listFn() });
  const orgsQ = useQuery({ queryKey: ["sa-orgs"], queryFn: () => orgsFn() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["sa-users"] });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: random7(), password: "", role: "sales" as string, organization_id: "" as string });

  const [credOpen, setCredOpen] = useState(false);
  const [credUser, setCredUser] = useState<any>(null);
  const [credForm, setCredForm] = useState({ username: "", password: "" });

  const [orgOpen, setOrgOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState<string | null>(null);
  const [assignOrgId, setAssignOrgId] = useState("");

  async function submit() {
    if (!form.full_name) { toast.error("أدخل الاسم الكامل"); return; }
    setBusy(true);
    try {
      const res: any = await createUsr({
        data: {
          full_name: form.full_name,
          email: form.email || undefined,
          password: form.password || undefined,
          role: form.role as any,
          organization_id: form.organization_id || undefined,
        },
      });
      toast.success(`تم إنشاء المستخدم — اسم المستخدم: ${res?.username} / كلمة المرور: ${res?.password}`, { duration: 15000 });
      setOpen(false);
      setForm({ full_name: "", email: random7(), password: "", role: "sales", organization_id: "" });
      invalidate();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function submitCreds() {
    if (!credUser) return;
    if (!credForm.username && !credForm.password) { toast.error("أدخل اسم مستخدم أو كلمة مرور"); return; }
    try {
      await updCreds({
        data: {
          user_id: credUser.id,
          username: credForm.username || undefined,
          password: credForm.password || undefined,
        },
      });
      toast.success("تم تحديث بيانات الدخول");
      setCredOpen(false); setCredUser(null); setCredForm({ username: "", password: "" });
      invalidate();
    } catch (e: any) { toast.error(e.message); }
  }

  async function submitAssign() {
    if (!assignUserId || !assignOrgId) return;
    try {
      await addToOrg({ data: { user_id: assignUserId, organization_id: assignOrgId } });
      toast.success("تمت الإضافة للمؤسسة");
      setOrgOpen(false); setAssignOrgId(""); setAssignUserId(null);
      invalidate();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>المستخدمون ({q.data?.length ?? 0})</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 ml-1" /> إنشاء مستخدم
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-right text-muted-foreground border-b">
              <tr>
                <th className="py-2 px-2">الاسم</th>
                <th className="py-2 px-2">الرقم الخاص</th>
                <th className="py-2 px-2">المؤسسات</th>
                <th className="py-2 px-2">الصلاحية</th>
                <th className="py-2 px-2">الحالة</th>
                <th className="py-2 px-2">آخر دخول</th>
                <th className="py-2 px-2">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((u: any) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2 px-2 font-medium">{u.full_name ?? "—"}</td>
                  <td className="py-2 px-2 text-muted-foreground" dir="ltr">{(u.email ?? "").split("@")[0] || "—"}</td>
                  <td className="py-2 px-2 text-xs">
                    {(u.organizations ?? []).map((o: any) => o.name).join("، ") || "—"}
                  </td>
                  <td className="py-2 px-2">
                    <Select
                      value={u.roles?.[0] ?? "user"}
                      onValueChange={async (v) => {
                        await setRole({ data: { user_id: u.id, role: v as any } });
                        toast.success("تم تحديث الصلاحية"); invalidate();
                      }}
                    >
                      <SelectTrigger className="w-40"><SelectValue>{roleLabel(u.roles?.[0] ?? "user")}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 px-2">
                    {u.banned ? <Badge variant="destructive">محظور</Badge> : <Badge variant="secondary">نشط</Badge>}
                  </td>
                  <td className="py-2 px-2 text-muted-foreground text-xs">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("ar") : "—"}
                  </td>
                  <td className="py-2 px-2">
                    <TooltipProvider>
                      <div className="flex gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost"
                              onClick={() => {
                                setCredUser(u);
                                setCredForm({ username: (u.email ?? "").split("@")[0] ?? "", password: "" });
                                setCredOpen(true);
                              }}>
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>تغيير اسم المستخدم / كلمة المرور</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" onClick={() => { setAssignUserId(u.id); setOrgOpen(true); }}>
                              <Building2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>إضافة إلى مؤسسة</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost"
                              onClick={async () => {
                                await ban({ data: { user_id: u.id, banned: !u.banned } }); invalidate();
                              }}>
                              {u.banned ? <UserCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{u.banned ? "إلغاء الحظر" : "حظر"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost"
                              onClick={async () => {
                                const reason = prompt("سبب الدخول بحساب المستخدم (سجل تدقيق):");
                                if (!reason) return;
                                try {
                                  await imp({ data: { target_user_id: u.id, reason } });
                                  toast.success("تم تسجيل جلسة الدخول بحساب المستخدم");
                                } catch (e: any) { toast.error(e.message); }
                              }}><UserCog className="h-4 w-4" /></Button>
                          </TooltipTrigger>
                          <TooltipContent>الدخول بحساب هذا المستخدم (تنكر) — لأغراض الدعم الفني: يسمح لك بمعاينة النظام كما يراه المستخدم دون تعديل بياناته الشخصية</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-destructive"
                              onClick={async () => {
                                if (!confirm(`حذف المستخدم ${u.full_name ?? u.email} نهائياً؟`)) return;
                                try {
                                  await delUsr({ data: { user_id: u.id } });
                                  toast.success("تم الحذف"); invalidate();
                                } catch (e: any) { toast.error(e.message); }
                              }}><Trash2 className="h-4 w-4" /></Button>
                          </TooltipTrigger>
                          <TooltipContent>حذف نهائي</TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>مستخدم جديد</DialogTitle>
            <DialogDescription>سيتم تفعيل الحساب تلقائياً بدون تأكيد بريد.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم الظاهر</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div><Label>اسم المستخدم (أي نص أو أرقام)</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="يُولّد تلقائياً" /></div>
            <div><Label>كلمة المرور</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="تُولّد تلقائياً مثل اسم المستخدم" /></div>
            <div>
              <Label>الصلاحية</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المؤسسة (اختياري)</Label>
              <Select value={form.organization_id || "__none"} onValueChange={(v) => setForm({ ...form, organization_id: v === "__none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="بدون مؤسسة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">بدون مؤسسة</SelectItem>
                  {(orgsQ.data ?? []).map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={busy}>إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={credOpen} onOpenChange={setCredOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>بيانات الدخول — {credUser?.full_name ?? ""}</DialogTitle>
            <DialogDescription>اترك الحقل فارغاً إن لم ترغب بتغييره.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم المستخدم (الرقم الخاص)</Label>
              <Input value={credForm.username} onChange={(e) => setCredForm({ ...credForm, username: e.target.value })} /></div>
            <div><Label>كلمة المرور الجديدة</Label>
              <Input type="text" value={credForm.password} onChange={(e) => setCredForm({ ...credForm, password: e.target.value })} placeholder="بدون تغيير" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCredOpen(false)}>إلغاء</Button>
            <Button onClick={submitCreds}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={orgOpen} onOpenChange={setOrgOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة المستخدم إلى مؤسسة</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>اختر المؤسسة</Label>
            <Select value={assignOrgId} onValueChange={setAssignOrgId}>
              <SelectTrigger><SelectValue placeholder="اختر مؤسسة" /></SelectTrigger>
              <SelectContent>
                {(orgsQ.data ?? []).map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrgOpen(false)}>إلغاء</Button>
            <Button onClick={submitAssign} disabled={!assignOrgId}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
