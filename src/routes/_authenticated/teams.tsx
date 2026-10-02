import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Building2, Plus, Trash2, UserPlus, Users, Phone, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePermission } from "@/platform/rbac/use-permission";
import { Badge } from "@/components/ui/badge";
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listMembers,
  listOrgUsers,
  addMember,
  removeMember,
  updateMember,
  assignAccountToDepartment,
} from "@/modules/organization";
import { listInstances } from "@/modules/channels";

function accountLabel(account: any) {
  const phone = account?.phone_number ? `+${account.phone_number}` : "رقم غير متزامن";
  return account?.display_name ? `${account.display_name} — ${phone}` : phone;
}

export const Route = createFileRoute("/_authenticated/teams")({
  head: () => ({
    meta: [
      { title: "الأقسام والفرق - NovaSales" },
      { name: "description", content: "إدارة أقسام وفرق المبيعات." },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  const canManage = usePermission("department.manage");
  const canManageOrg = usePermission("org.manage");
  const editable = canManage || canManageOrg;
  const qc = useQueryClient();
  const listDepts = useServerFn(listDepartments);
  const createDept = useServerFn(createDepartment);
  const updateDept = useServerFn(updateDepartment);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [numberFilter, setNumberFilter] = useState("all");
  const removeDept = useServerFn(deleteDepartment);
  const listInst = useServerFn(listInstances);
  const linkAcc = useServerFn(assignAccountToDepartment);

  const deptsQ = useQuery({ queryKey: ["departments"], queryFn: () => listDepts() });
  const instQ = useQuery({ queryKey: ["instances-teams"], queryFn: () => listInst() });

  const [openNew, setOpenNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShortCode, setNewShortCode] = useState("");
  const [newSubtitle, setNewSubtitle] = useState("");
  const [newTz, setNewTz] = useState("Asia/Dubai");
  const [activeDept, setActiveDept] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (d: { name: string; shortCode?: string; subtitle?: string; timezone: string }) =>
      editId ? updateDept({ data: { id: editId, ...d } }) : createDept({ data: d }),
    onSuccess: () => {
      toast.success(editId ? "تم تعديل القسم" : "تم إنشاء القسم");
      setOpenNew(false);
      setEditId(null);
      setNewName("");
      setNewShortCode("");
      setNewSubtitle("");
      qc.invalidateQueries({ queryKey: ["departments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => removeDept({ data: { id } }),
    onSuccess: () => {
      toast.success("تم حذف القسم");
      qc.invalidateQueries({ queryKey: ["departments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const linkMut = useMutation({
    mutationFn: (v: {
      accountId: string;
      departmentId: string | null;
      action?: "link" | "unlink";
    }) => linkAcc({ data: { ...v, action: v.action ?? "link" } }),
    onSuccess: async () => {
      toast.success("تم التحديث");
      await qc.invalidateQueries({ queryKey: ["instances-teams"] });
      await qc.refetchQueries({ queryKey: ["instances-teams"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-w-0" dir="rtl">
      <div className="flex flex-wrap gap-3 items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" /> الأقسام والفرق
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            أدر أقسام المبيعات والمناديب المسؤولين عن كل قسم.
          </p>
        </div>
        <Button
          disabled={!editable}
          onClick={() => {
            setEditId(null);
            setNewName("");
            setNewShortCode("");
            setNewSubtitle("");
            setOpenNew(true);
          }}
        >
          <Plus className="h-4 w-4 ml-1" /> قسم جديد
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          className="w-full sm:w-64"
          placeholder="بحث باسم القسم أو الاختصار"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="فلترة أرقام القسم"
          className="border rounded-md p-2"
          value={numberFilter}
          onChange={(e) => setNumberFilter(e.target.value)}
        >
          <option value="all">كل الأقسام</option>
          <option value="linked">مع أرقام واتساب</option>
          <option value="unlinked">بدون أرقام واتساب</option>
        </select>
        <Button
          variant="outline"
          onClick={() => {
            deptsQ.refetch();
            instQ.refetch();
          }}
        >
          تحديث
        </Button>
      </div>
      {deptsQ.isPending && <Card className="p-8">جارٍ تحميل الأقسام…</Card>}
      {deptsQ.isError && (
        <Card className="p-8 text-destructive">
          تعذر تحميل الأقسام. <Button onClick={() => deptsQ.refetch()}>إعادة المحاولة</Button>
        </Card>
      )}
      {instQ.isError && (
        <Card className="p-4 text-destructive mb-4">
          تعذر تحميل أرقام واتساب. <Button onClick={() => instQ.refetch()}>إعادة المحاولة</Button>
        </Card>
      )}
      {deptsQ.isSuccess && deptsQ.data?.length === 0 && (
        <Card className="p-8 text-center">لا توجد أقسام بعد. اضغط قسم جديد للبدء.</Card>
      )}
      <div className="grid gap-4">
        {(deptsQ.data ?? [])
          .filter((d: any) => {
            const linked = (instQ.data ?? []).some(
              (i: any) => i.department_ids?.includes(d.id) || i.department_id === d.id,
            );
            return (
              (d.name + " " + (d.short_code ?? "")).toLowerCase().includes(search.toLowerCase()) &&
              (numberFilter === "all" || (numberFilter === "linked" ? linked : !linked))
            );
          })
          .map((d: any) => {
            const isLinked = (i: any) =>
              Array.isArray(i.department_ids)
                ? i.department_ids.includes(d.id)
                : i.department_id === d.id;
            const linkedNumbers = (instQ.data ?? []).filter(isLinked);
            const availableNumbers = (instQ.data ?? []).filter((i: any) => !isLinked(i));
            return (
              <Card key={d.id} className="p-4">
                {/* Header */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold leading-tight">{d.name}</h2>
                      {d.subtitle && (
                        <div className="text-xs text-muted-foreground mt-0.5">{d.subtitle}</div>
                      )}
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {d.short_code && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {d.short_code}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">
                          {d.timezone}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {linkedNumbers.length} أرقام
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={!editable || createMut.isPending}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditId(d.id);
                        setNewName(d.name);
                        setNewShortCode(d.short_code ?? "");
                        setNewSubtitle(d.subtitle ?? "");
                        setNewTz(d.timezone);
                        setOpenNew(true);
                      }}
                    >
                      تعديل
                    </Button>
                    <Button
                      variant={activeDept === d.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setActiveDept(activeDept === d.id ? null : d.id)}
                    >
                      <Users className="h-4 w-4 ml-1" />
                      الأعضاء
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!editable || deleteMut.isPending}
                      onClick={() => {
                        if (confirm(`حذف قسم ${d.name}؟`)) deleteMut.mutate(d.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Two-column body: members (right) + numbers (left) */}
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {/* Members column */}
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">الأعضاء</div>
                    {activeDept === d.id ? (
                      <MembersPanel departmentId={d.id} editable={editable} embedded />
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        اضغط "الأعضاء" لعرض وإدارة أعضاء هذا القسم.
                      </div>
                    )}
                  </div>

                  {/* Numbers column */}
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">
                      أرقام واتساب المرتبطة
                    </div>
                    {linkedNumbers.length === 0 ? (
                      <div className="text-xs text-muted-foreground mb-2">
                        لا يوجد أرقام مرتبطة بعد.
                      </div>
                    ) : (
                      <div className="space-y-1.5 mb-3">
                        {linkedNumbers.map((i: any) => (
                          <div
                            key={i.id}
                            className="flex items-center gap-2 text-sm bg-background rounded p-2 border"
                          >
                            <Phone className="h-3.5 w-3.5 text-emerald-600" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {i.display_name ?? "جلسة واتساب"}
                              </div>
                              <div
                                className="text-[10px] text-muted-foreground font-mono truncate"
                                dir="ltr"
                              >
                                {i.phone_number ? `+${i.phone_number}` : "رقم غير متزامن"}
                              </div>
                            </div>
                            <Button
                              validate
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[11px]"
                              disabled={!editable || linkMut.isPending}
                              onClick={() =>
                                linkMut.mutate({
                                  accountId: i.id,
                                  departmentId: d.id,
                                  action: "unlink",
                                })
                              }
                            >
                              إلغاء الربط
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {availableNumbers.length > 0 && (
                      <div className="flex gap-1.5 items-center">
                        <Select
                          disabled={!editable || linkMut.isPending}
                          onValueChange={(v) =>
                            linkMut.mutate({ accountId: v, departmentId: d.id, action: "link" })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="+ إضافة رقم للقسم" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableNumbers.map((i: any) => (
                              <SelectItem key={i.id} value={i.id} className="text-xs">
                                {accountLabel(i)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
      </div>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editId ? "تعديل القسم" : "قسم جديد"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الاسم</Label>
              <Input
                required
                aria-label="اسم القسم"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="مثال: قسم المالية أو دبي"
              />
            </div>
            <div>
              <Label>الاختصار (اختياري)</Label>
              <Input
                value={newShortCode}
                onChange={(e) => setNewShortCode(e.target.value)}
                placeholder="مثال: FIN"
              />
            </div>
            <div>
              <Label>العنوان الفرعي (اختياري)</Label>
              <Input
                value={newSubtitle}
                onChange={(e) => setNewSubtitle(e.target.value)}
                placeholder="مثال: يهتم بالفواتير والتحصيل"
              />
            </div>
            <div>
              <Label>المنطقة الزمنية</Label>
              <Select value={newTz} onValueChange={setNewTz}>
                <SelectTrigger required aria-label="المنطقة الزمنية">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(
                    new Set([
                      newTz,
                      "Europe/Istanbul",
                      "Asia/Damascus",
                      "Asia/Riyadh",
                      "Asia/Dubai",
                      "Africa/Cairo",
                      "Africa/Casablanca",
                      "Europe/Berlin",
                      "UTC",
                    ]),
                  ).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              validate
              onClick={() =>
                createMut.mutate({
                  name: newName.trim(),
                  shortCode: newShortCode.trim() || undefined,
                  subtitle: newSubtitle.trim() || undefined,
                  timezone: newTz.trim(),
                })
              }
              disabled={createMut.isPending || !editable}
            >
              {editId ? "حفظ التعديلات" : "إنشاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MembersPanel({
  departmentId,
  editable,
  embedded = false,
}: {
  departmentId: string;
  editable: boolean;
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const listM = useServerFn(listMembers);
  const addM = useServerFn(addMember);
  const rmM = useServerFn(removeMember);
  const listInst = useServerFn(listInstances);
  const listUsers = useServerFn(listOrgUsers);
  const membersQ = useQuery({
    queryKey: ["members", departmentId],
    queryFn: () => listM({ data: { departmentId } }),
  });
  const usersQ = useQuery({ queryKey: ["org-users"], queryFn: () => listUsers() });
  const instQ = useQuery({ queryKey: ["instances-teams"], queryFn: () => listInst() });
  const [openAdd, setOpenAdd] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [isSup, setIsSup] = useState(false);
  const [accId, setAccId] = useState<string>("none");

  const addMut = useMutation({
    mutationFn: () =>
      addM({
        data: {
          departmentId,
          userId,
          isSupervisor: isSup,
          defaultChannelAccountId: accId === "none" ? undefined : accId,
        },
      }),
    onSuccess: () => {
      toast.success("تم إضافة العضو");
      setOpenAdd(false);
      setUserId("");
      setIsSup(false);
      setAccId("none");
      qc.invalidateQueries({ queryKey: ["members", departmentId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rmMut = useMutation({
    mutationFn: (id: string) => rmM({ data: { id } }),
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["members", departmentId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className={embedded ? "" : "mt-4 pt-4 border-t"}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">أعضاء القسم</span>
        <Button disabled={!editable} size="sm" variant="outline" onClick={() => setOpenAdd(true)}>
          <UserPlus className="h-4 w-4 ml-1" /> إضافة عضو
        </Button>
      </div>
      {membersQ.isPending && <p>جارٍ تحميل الأعضاء…</p>}
      {membersQ.isError && (
        <p className="text-destructive">
          تعذر تحميل الأعضاء <Button onClick={() => membersQ.refetch()}>إعادة المحاولة</Button>
        </p>
      )}
      {membersQ.data && membersQ.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا يوجد أعضاء بعد.</p>
      ) : (
        <div className="space-y-1">
          {(membersQ.data ?? []).map((m: any) => (
            <div
              key={m.id}
              className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-muted/50"
            >
              <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                {(m.display_name ?? m.profile_name ?? "?").charAt(0)}
              </div>
              <span className="font-medium">{m.display_name ?? m.profile_name}</span>
              {m.is_supervisor && <Badge variant="default">مشرف</Badge>}
              {!m.is_supervisor && <Badge variant="secondary">مندوب</Badge>}
              {m.channel_account_name && (
                <span className="text-xs text-muted-foreground">
                  · رقمه: {m.channel_account_name}
                </span>
              )}
              <div className="flex-1" />
              <WelcomeTemplateButton member={m} departmentId={departmentId} editable={editable} />
              <Button
                validate
                size="icon"
                variant="ghost"
                disabled={!editable || rmMut.isPending}
                onClick={() => {
                  if (confirm("إزالة العضو من هذا القسم؟")) rmMut.mutate(m.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={openAdd} onOpenChange={setOpenAdd}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة عضو للقسم</DialogTitle>
          </DialogHeader>
          {(usersQ.isError || instQ.isError) && (
            <p className="text-destructive">
              تعذر تحميل المستخدمين أو الأرقام{" "}
              <Button
                onClick={() => {
                  usersQ.refetch();
                  instQ.refetch();
                }}
              >
                إعادة المحاولة
              </Button>
            </p>
          )}
          <div className="space-y-3">
            <div>
              {usersQ.isSuccess &&
                !(usersQ.data ?? []).some(
                  (u: any) => !(membersQ.data ?? []).some((m: any) => m.user_id === u.id),
                ) && (
                  <p className="text-muted-foreground">
                    لا يوجد مستخدمون متاحون للإضافة لهذا القسم.
                  </p>
                )}
              <Label>المستخدم</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger required aria-label="المستخدم">
                  <SelectValue placeholder="اختر مستخدماً موجوداً" />
                </SelectTrigger>
                <SelectContent>
                  {(usersQ.data ?? [])
                    .filter((u: any) => !(membersQ.data ?? []).some((m: any) => m.user_id === u.id))
                    .map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                لإنشاء مستخدم جديد استخدم صفحة المستخدمين — هنا نضيف مستخدمين موجودين فقط.
              </p>
            </div>

            <div className="flex items-center justify-between p-3 rounded border">
              <div>
                <div className="text-sm font-medium">مشرف القسم</div>
                <div className="text-xs text-muted-foreground">
                  يوزع العملاء على المناديب؛ يجب تعيين دور مشرف مناسب من صفحة المستخدمين أولًا
                </div>
              </div>
              <Switch checked={isSup} onCheckedChange={setIsSup} />
            </div>
            <div>
              <Label>رقم واتساب الخاص (اختياري)</Label>
              <Select value={accId} onValueChange={setAccId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون رقم" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون —</SelectItem>
                  {(instQ.data ?? []).map((i: any) => (
                    <SelectItem key={i.id} value={i.id}>
                      {accountLabel(i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              validate
              onClick={() => addMut.mutate()}
              disabled={addMut.isPending || !editable || usersQ.isPending || usersQ.isError}
            >
              إضافة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const DEFAULT_WELCOME =
  "مرحباً {{contact_name}} 👋\nمعك {{agent_name}} من {{department_name}}. سأتابع طلبك معك.";

function WelcomeTemplateButton({
  member,
  departmentId,
  editable,
}: {
  member: any;
  departmentId: string;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const upd = useServerFn(updateMember);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string>(member.welcome_template_override ?? "");

  const mut = useMutation({
    mutationFn: (value: string | null) =>
      upd({ data: { id: member.id, welcomeTemplateOverride: value } }),
    onSuccess: () => {
      toast.success("تم حفظ الرسالة الترحيبية");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["members", departmentId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        disabled={!editable}
        title="الرسالة الترحيبية"
        onClick={() => {
          setText(member.welcome_template_override ?? "");
          setOpen(true);
        }}
      >
        <MessageSquare
          className={`h-3.5 w-3.5 ${member.welcome_template_override ? "text-primary" : "text-muted-foreground"}`}
        />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              الرسالة الترحيبية — {member.display_name ?? member.profile_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>نص الرسالة التي تُرسل تلقائياً للعميل عند الإسناد</Label>
            <Textarea
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={DEFAULT_WELCOME}
            />
            <p className="text-xs text-muted-foreground">
              المتغيرات المتاحة: {"{{contact_name}}"} · {"{{agent_name}}"} · {"{{department_name}}"}{" "}
              · {"{{org_name}}"}
            </p>
            <p className="text-xs text-muted-foreground">
              اتركه فارغاً لاستخدام رسالة القسم الافتراضية.
            </p>
          </div>
          <DialogFooter className="gap-2">
            {member.welcome_template_override && (
              <Button
                validate
                variant="outline"
                onClick={() => mut.mutate(null)}
                disabled={mut.isPending}
              >
                إعادة للافتراضي
              </Button>
            )}
            <Button validate onClick={() => mut.mutate(text)} disabled={mut.isPending}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
