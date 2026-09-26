import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Trash2, Plus } from "lucide-react";
import { createInvitation, listInvitations, revokeInvitation } from "@/modules/invitations";
import { listRoles } from "@/modules/rbac";
import { listDepartments } from "@/modules/organization";

export const Route = createFileRoute("/_authenticated/settings/invitations")({
  component: InvitationsPage,
});

function InvitationsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listInvitations);
  const create = useServerFn(createInvitation);
  const revoke = useServerFn(revokeInvitation);
  const listR = useServerFn(listRoles);
  const listD = useServerFn(listDepartments);

  const invQ = useQuery({ queryKey: ["invitations"], queryFn: () => list() });
  const rolesQ = useQuery({ queryKey: ["org-roles"], queryFn: () => listR() });
  const deptsQ = useQuery({ queryKey: ["departments"], queryFn: () => listD() });

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [deptId, setDeptId] = useState<string>("none");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          email: email.trim(),
          roleId,
          departmentId: deptId === "none" ? null : deptId,
        },
      }),
    onSuccess: (res: any) => {
      const url = `${window.location.origin}/invite/${res.token}`;
      setLastLink(url);
      toast.success("تم إنشاء الدعوة — انسخ الرابط");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["invitations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => {
      toast.success("تم إلغاء الدعوة");
      qc.invalidateQueries({ queryKey: ["invitations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">الدعوات</h2>
        <Button onClick={() => { setOpen(true); setLastLink(null); }}>
          <Plus className="h-4 w-4 ml-1" /> دعوة جديدة
        </Button>
      </div>

      {lastLink && (
        <div className="mb-4 p-3 rounded bg-muted flex items-center gap-2">
          <div className="text-xs flex-1 break-all font-mono">{lastLink}</div>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(lastLink); toast.success("تم النسخ"); }}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {(invQ.data ?? []).map((i: any) => {
          const expired = new Date(i.expires_at) < new Date();
          const status = i.accepted_at ? "مقبولة" : i.revoked_at ? "ملغاة" : expired ? "منتهية" : "معلقة";
          const variant = i.accepted_at ? "default" : i.revoked_at || expired ? "destructive" : "secondary";
          return (
            <div key={i.id} className="flex items-center gap-3 p-3 rounded border">
              <div className="flex-1">
                <div className="font-medium text-sm">{i.email}</div>
                <div className="text-xs text-muted-foreground">
                  {i.role_name} · تنتهي {new Date(i.expires_at).toLocaleDateString("ar")}
                </div>
              </div>
              <Badge variant={variant as any}>{status}</Badge>
              {!i.accepted_at && !i.revoked_at && !expired && (
                <Button size="icon" variant="ghost" onClick={() => revokeMut.mutate(i.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          );
        })}
        {(invQ.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">لا توجد دعوات.</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>دعوة عضو جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>البريد الإلكتروني</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <div>
              <Label>الدور</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger><SelectValue placeholder="اختر دوراً" /></SelectTrigger>
                <SelectContent>
                  {(rolesQ.data ?? []).map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>القسم (اختياري)</Label>
              <Select value={deptId} onValueChange={setDeptId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون —</SelectItem>
                  {(deptsQ.data ?? []).map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!email.trim() || !roleId || createMut.isPending}
            >
              إنشاء الدعوة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
