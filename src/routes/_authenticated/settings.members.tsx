import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { UserX, UserCheck, Trash2, Shield, KeyRound } from "lucide-react";
import {
  listMembers,
  deactivateMember,
  activateMember,
  removeMember,
  setMemberRoles,
  updateMemberCredentials,
  myMemberRole,
} from "@/modules/members";
import { listRoles } from "@/modules/rbac";
import { ROLE_RANK, ROLE_LABELS } from "@/modules/members/role-rank";

export const Route = createFileRoute("/_authenticated/settings/members")({
  component: MembersPage,
});

function MembersPage() {
  const qc = useQueryClient();
  const listM = useServerFn(listMembers);
  const deact = useServerFn(deactivateMember);
  const act = useServerFn(activateMember);
  const rm = useServerFn(removeMember);
  const setRoles = useServerFn(setMemberRoles);
  const listR = useServerFn(listRoles);
  const updCreds = useServerFn(updateMemberCredentials);
  const myRoleFn = useServerFn(myMemberRole);

  const membersQ = useQuery({ queryKey: ["org-members"], queryFn: () => listM() });
  const rolesQ = useQuery({ queryKey: ["org-roles"], queryFn: () => listR() });
  const myRoleQ = useQuery({ queryKey: ["my-member-role"], queryFn: () => myRoleFn() });

  const myRank = myRoleQ.data?.rank ?? 0;
  const canManageCreds = myRank >= 3;

  const [editUser, setEditUser] = useState<{ userId: string; roleId: string | null } | null>(null);
  const [credUser, setCredUser] = useState<{ userId: string; username: string; password: string } | null>(null);

  const deactMut = useMutation({
    mutationFn: (id: string) => deact({ data: { membershipId: id } }),
    onSuccess: () => { toast.success("تم التعطيل"); qc.invalidateQueries({ queryKey: ["org-members"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const actMut = useMutation({
    mutationFn: (id: string) => act({ data: { membershipId: id } }),
    onSuccess: () => { toast.success("تم التفعيل"); qc.invalidateQueries({ queryKey: ["org-members"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rmMut = useMutation({
    mutationFn: (userId: string) => rm({ data: { userId } }),
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["org-members"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rolesMut = useMutation({
    mutationFn: (v: { userId: string; roleId: string | null }) =>
      setRoles({ data: { userId: v.userId, roleIds: v.roleId ? [v.roleId] : [] } }),
    onSuccess: () => {
      toast.success("تم تحديث الدور");
      setEditUser(null);
      qc.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const credsMut = useMutation({
    mutationFn: (v: { userId: string; username?: string; password?: string }) => updCreds({ data: v }),
    onSuccess: () => { toast.success("تم تحديث بيانات الدخول"); setCredUser(null); qc.invalidateQueries({ queryKey: ["org-members"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // الأدوار المسموح منحها = أقل من مرتبة المستخدم الحالي فقط
  const assignableRoles = (rolesQ.data ?? []).filter(
    (r: any) => (ROLE_RANK[r.key] ?? 0) > 0 && (ROLE_RANK[r.key] ?? 0) < myRank,
  );

  function memberRank(m: any) {
    return Math.max(0, ...(m.roles ?? []).map((r: any) => ROLE_RANK[r.key] ?? 0));
  }

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">أعضاء المؤسسة</h2>
      </div>
      <div className="space-y-2">
        {(membersQ.data ?? []).map((m: any) => {
          const canEdit = memberRank(m) < myRank;
          return (
            <div key={m.id} className="flex items-center gap-3 p-3 rounded border">
              <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                {(m.full_name ?? "?").charAt(0)}
              </div>
              <div className="flex-1">
                <div className="font-medium">{m.full_name ?? "بلا اسم"}</div>
                <div className="text-xs text-muted-foreground">{m.username ?? "—"}</div>
                <div className="flex gap-1 mt-1">
                  {(m.roles ?? []).map((r: any) => (
                    <Badge key={r.id} variant="secondary">{ROLE_LABELS[r.key]?.name ?? r.name}</Badge>
                  ))}
                  {(m.roles ?? []).length === 0 && <Badge variant="outline">بلا دور</Badge>}
                  {!m.is_active && <Badge variant="destructive">معطل</Badge>}
                </div>
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditUser({ userId: m.user_id, roleId: (m.roles ?? [])[0]?.id ?? null })}
                >
                  <Shield className="h-4 w-4 ml-1" /> الدور
                </Button>
              )}
              {canManageCreds && canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCredUser({ userId: m.user_id, username: m.username ?? "", password: "" })}
                >
                  <KeyRound className="h-4 w-4 ml-1" /> بيانات الدخول
                </Button>
              )}
              {canEdit && (m.is_active ? (
                <Button validate size="icon" variant="ghost" onClick={() => deactMut.mutate(m.id)}>
                  <UserX className="h-4 w-4" />
                </Button>
              ) : (
                <Button validate size="icon" variant="ghost" onClick={() => actMut.mutate(m.id)}>
                  <UserCheck className="h-4 w-4" />
                </Button>
              ))}
              {canEdit && (
                <Button validate size="icon" variant="ghost" onClick={() => { if (confirm("إزالة العضو من المؤسسة؟")) rmMut.mutate(m.user_id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          );
        })}
        {(membersQ.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">لا يوجد أعضاء بعد. أرسل دعوة من تبويب الدعوات.</p>
        )}
      </div>

      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تحديد دور العضو</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">لكل عضو دور واحد فقط.</p>
            {assignableRoles.map((r: any) => {
              const checked = editUser?.roleId === r.id;
              const info = ROLE_LABELS[r.key];
              return (
                <label
                  key={r.id}
                  className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${checked ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                >
                  <input
                    type="radio"
                    name="member-role"
                    className="mt-1 accent-[hsl(var(--primary))]"
                    checked={checked}
                    onChange={() => editUser && setEditUser({ ...editUser, roleId: r.id })}
                  />
                  <div>
                    <div className="text-sm font-semibold">{info?.name ?? r.name}</div>
                    <div className="text-xs text-muted-foreground leading-5">{info?.description ?? r.description ?? ""}</div>
                  </div>
                </label>
              );
            })}
            {assignableRoles.length === 0 && (
              <p className="text-sm text-muted-foreground">لا توجد أدوار يمكنك منحها.</p>
            )}
          </div>
          <DialogFooter>
            <Button validate onClick={() => editUser && rolesMut.mutate(editUser)} disabled={rolesMut.isPending || !editUser?.roleId}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!credUser} onOpenChange={(o) => !o && setCredUser(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تغيير بيانات الدخول</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>اسم المستخدم</Label>
              <Input
                value={credUser?.username ?? ""}
                onChange={(e) => credUser && setCredUser({ ...credUser, username: e.target.value })}
                placeholder="أي نص أو أرقام"
              />
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور الجديدة</Label>
              <Input
                value={credUser?.password ?? ""}
                onChange={(e) => credUser && setCredUser({ ...credUser, password: e.target.value })}
                placeholder="اتركها فارغة لعدم التغيير"
              />
            </div>
          </div>
          <DialogFooter>
            <Button validate
              disabled={credsMut.isPending}
              onClick={() =>
                credUser &&
                credsMut.mutate({
                  userId: credUser.userId,
                  username: credUser.username.trim() || undefined,
                  password: credUser.password.trim() || undefined,
                })
              }
            >
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
