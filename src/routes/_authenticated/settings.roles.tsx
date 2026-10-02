import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Save } from "lucide-react";
import { listRoles, listPermissions, createRole, deleteRole, setRolePermissions } from "@/modules/rbac";

export const Route = createFileRoute("/_authenticated/settings/roles")({
  component: RolesPage,
});

function RolesPage() {
  const qc = useQueryClient();
  const listR = useServerFn(listRoles);
  const listP = useServerFn(listPermissions);
  const create = useServerFn(createRole);
  const remove = useServerFn(deleteRole);
  const setPerms = useServerFn(setRolePermissions);

  const rolesQ = useQuery({ queryKey: ["org-roles"], queryFn: () => listR() });
  const permsQ = useQuery({ queryKey: ["all-permissions"], queryFn: () => listP() });

  const [open, setOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nKey, setNKey] = useState("");
  const [editing, setEditing] = useState<{ id: string; permissions: string[] } | null>(null);

  const createMut = useMutation({
    mutationFn: () => create({ data: { name: nName.trim(), key: nKey.trim(), permissions: [] } }),
    onSuccess: () => {
      toast.success("تم إنشاء الدور");
      setOpen(false); setNName(""); setNKey("");
      qc.invalidateQueries({ queryKey: ["org-roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rmMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["org-roles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveMut = useMutation({
    mutationFn: (v: { roleId: string; permissions: string[] }) => setPerms({ data: v }),
    onSuccess: () => {
      toast.success("تم الحفظ");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["org-roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">الأدوار والصلاحيات</h2>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 ml-1" /> دور مخصص
        </Button>
      </div>

      <div className="space-y-3">
        {(rolesQ.data ?? []).map((r: any) => {
          const isEditing = editing !== null && editing.id === r.id;
          const currentEditing = isEditing ? editing! : null;
          const permsList: string[] = currentEditing ? currentEditing.permissions : r.permissions;
          return (
            <div key={r.id} className="p-4 rounded border">
              <div className="flex items-center gap-2 mb-2">
                <div className="font-semibold">{r.name}</div>
                <Badge variant="outline">{r.key}</Badge>
                {r.is_system && <Badge variant="secondary">نظام</Badge>}
                <div className="flex-1" />
                {!r.is_system && !currentEditing && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: r.id, permissions: r.permissions })}>
                      تعديل الصلاحيات
                    </Button>
                    <Button validate size="icon" variant="ghost" onClick={() => { if (confirm(`حذف الدور ${r.name}؟`)) rmMut.mutate(r.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </>
                )}
                {currentEditing && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
                    <Button validate size="sm" onClick={() => saveMut.mutate({ roleId: r.id, permissions: currentEditing.permissions })}>
                      <Save className="h-4 w-4 ml-1" /> حفظ
                    </Button>
                  </>
                )}
              </div>
              {currentEditing ? (
                <div className="grid grid-cols-2 gap-2">
                  {(permsQ.data ?? []).map((p: any) => {
                    const checked = currentEditing.permissions.includes(p.key);
                    return (
                      <label key={p.key} className="flex items-center gap-2 text-sm p-2 rounded hover:bg-muted cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            const next = v
                              ? [...currentEditing.permissions, p.key]
                              : currentEditing.permissions.filter((x) => x !== p.key);
                            setEditing({ id: currentEditing.id, permissions: next });
                          }}
                        />
                        <div>
                          <div className="font-mono text-xs">{p.key}</div>

                          <div className="text-xs text-muted-foreground">{p.description}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {permsList.length === 0 ? (
                    <span className="text-xs text-muted-foreground">لا صلاحيات</span>
                  ) : (
                    permsList.map((p: string) => (
                      <Badge key={p} variant="secondary" className="font-mono text-xs">{p}</Badge>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>دور مخصص جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>اسم الدور</Label>
              <Input required aria-label="اسم الصلاحية" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Team Lead" />
            </div>
            <div>
              <Label>المعرّف</Label>
              <Input required aria-label="مفتاح الصلاحية" value={nKey} onChange={(e) => setNKey(e.target.value.toLowerCase())} placeholder="team_lead" />
            </div>
          </div>
          <DialogFooter>
            <Button validate onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
