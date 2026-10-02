import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { toast } from "@/lib/toast";
import { Users2, Plus, Trash2, ArrowRightLeft, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  listLeadPage,
  getLeadOptions,
  createLead,
  updateLead,
  deleteLead,
  convertLeadToOpportunity,
} from "@/modules/crm";
import { CustomFieldInput } from "@/components/crm/custom-field-input";
import { leadCreateSchema, leadUpdateSchema } from "@/modules/crm/lead-input";
export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({ meta: [{ title: "العملاء المحتملون - NovaSales" }] }),
  component: LeadsPage,
});
const LABELS: Record<string, string> = {
  new: "جديد",
  working: "قيد المتابعة",
  qualified: "مؤهل",
  unqualified: "غير مؤهل",
  converted: "تم التحويل",
  lost: "خاسر",
};
const COLORS: Record<string, string> = {
  new: "bg-slate-500",
  working: "bg-blue-500",
  qualified: "bg-purple-500",
  unqualified: "bg-orange-500",
  converted: "bg-emerald-600",
  lost: "bg-red-500",
};
const EMPTY = {
  contactName: "",
  phone: "",
  email: "",
  source: "",
  notes: "",
  status: "new",
  departmentId: "",
  ownerUserId: "",
  customFields: {} as Record<string, unknown>,
};
function LeadsPage() {
  const qc = useQueryClient(),
    list = useServerFn(listLeadPage),
    options = useServerFn(getLeadOptions),
    create = useServerFn(createLead),
    update = useServerFn(updateLead),
    remove = useServerFn(deleteLead),
    convert = useServerFn(convertLeadToOpportunity);
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [status, setStatus] = useState("all"),
    [department, setDepartment] = useState(""),
    [owner, setOwner] = useState(""),
    [page, setPage] = useState(1);
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<any>(null),
    [form, setForm] = useState(EMPTY),
    [deleting, setDeleting] = useState<any>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const opts = useQuery({ queryKey: ["lead-options"], queryFn: () => options() });
  const q = useQuery({
    queryKey: ["leads", status, debounced, department, owner, page],
    queryFn: () =>
      list({
        data: {
          status: status === "all" ? undefined : (status as any),
          search: debounced || undefined,
          departmentId: department || undefined,
          ownerId: owner || undefined,
          page,
          pageSize: 25,
        },
      }),
  });
  const can = (key: string) =>
    !!opts.data && (opts.data.isSuperAdmin || opts.data.permissions.includes(key));
  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["leads"] }),
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] }),
      qc.invalidateQueries({ queryKey: ["contacts"] }),
      qc.invalidateQueries({ queryKey: ["pipeline-board"] }),
      qc.invalidateQueries({ queryKey: ["opportunities"] }),
      qc.invalidateQueries({ queryKey: ["opp"] }),
      qc.invalidateQueries({ queryKey: ["opp-contact"] }),
      qc.invalidateQueries({ queryKey: ["timeline"] }),
    ]);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (opts.data?.scope === "department" && !form.departmentId)
        throw new Error("القسم إلزامي؛ اختر قسمًا قبل الحفظ");
      const payload = {
        ...form,
        departmentId: form.departmentId || null,
        ownerUserId: form.ownerUserId || null,
        status: form.status as any,
      };
      if (editing)
        return update({ data: leadUpdateSchema.parse({ ...payload, leadId: editing.id }) });
      return create({ data: leadCreateSchema.parse(payload) });
    },
    onSuccess: () => {
      toast.success(editing ? "تم تعديل العميل المحتمل" : "تم إنشاء العميل المحتمل");
      setOpen(false);
      setEditing(null);
      setForm(EMPTY);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => remove({ data: { leadId: id } }),
    onSuccess: () => {
      setDeleting(null);
      setPage(1);
      toast.success("تم حذف العميل المحتمل مع الاحتفاظ بجهة الاتصال");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const convertMut = useMutation({
    mutationFn: (id: string) => convert({ data: { leadId: id } }),
    onSuccess: () => {
      toast.success("تم تحويل العميل إلى فرصة مبيعات");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = save.isPending || removeMut.isPending || convertMut.isPending;
  const field = (key: keyof typeof EMPTY, value: any) => setForm((f) => ({ ...f, [key]: value }));
  const show = (lead?: any) => {
    setEditing(lead ?? null);
    setForm(
      lead
        ? {
            contactName: lead.contact_name,
            phone: lead.contact_phone ?? "",
            email: lead.contact_email ?? "",
            source: lead.source ?? "",
            notes: lead.notes ?? "",
            status: lead.status,
            departmentId: lead.department_id ?? "",
            ownerUserId: lead.owner_user_id ?? "",
            customFields: lead.custom_fields ?? {},
          }
        : {
            ...EMPTY,
            ownerUserId: opts.data?.users.some((u) => u.id === opts.data?.userId)
              ? opts.data.userId
              : "",
            departmentId:
              opts.data?.scope === "department" ? (opts.data.departments[0]?.id ?? "") : "",
          },
    );
    setOpen(true);
  };
  const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const filteredUsers = (opts.data?.users ?? []).filter(
    (u) =>
      !form.departmentId ||
      u.id === opts.data?.userId ||
      opts.data?.departmentMembers.some(
        (m) => m.user_id === u.id && m.department_id === form.departmentId,
      ),
  );
  return (
    <div className="p-3 sm:p-6 space-y-5 min-w-0" dir="rtl">
      <header className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users2 />
            العملاء المحتملون
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            متابعة العملاء وتعيينهم وتحويلهم إلى فرص مبيعات.
          </p>
        </div>
        {can("crm.leads.create") && (
          <Button disabled={busy} onClick={() => show()}>
            <Plus className="h-4 w-4" />
            عميل محتمل جديد
          </Button>
        )}
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <Label htmlFor="lead-search">البحث</Label>
          <Input
            id="lead-search"
            placeholder="الاسم أو الهاتف أو البريد أو المصدر"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="lead-status-filter">الحالة</Label>
          <select
            id="lead-status-filter"
            className={selectClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">كل الحالات</option>
            {Object.entries(LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="lead-department-filter">القسم</Label>
          <select
            id="lead-department-filter"
            className={selectClass}
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل الأقسام المتاحة</option>
            {opts.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="lead-owner-filter">المندوب</Label>
          <select
            id="lead-owner-filter"
            className={selectClass}
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setPage(1);
            }}
          >
            <option value="">كل المندوبين المتاحين</option>
            {opts.data?.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ?? "مستخدم"}
              </option>
            ))}
          </select>
        </div>
      </div>
      {q.isError || opts.isError ? (
        <Card className="p-5 space-y-3">
          <p role="alert">
            تعذر تحميل العملاء المحتملين أو خيارات الصفحة. أعد المحاولة، وتأكد من تطبيق تحديث قاعدة
            البيانات.
          </p>
          <Button
            onClick={() => {
              q.refetch();
              opts.refetch();
            }}
          >
            إعادة المحاولة
          </Button>
        </Card>
      ) : q.isPending || opts.isPending ? (
        <p className="p-5 text-muted-foreground">جارٍ تحميل العملاء المحتملين…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <span className="text-sm text-muted-foreground">النتائج: {q.data?.total ?? 0}</span>
            <Button
              variant="outline"
              disabled={q.isFetching}
              onClick={() => {
                setSearch("");
                setStatus("all");
                setDepartment("");
                setOwner("");
                setPage(1);
              }}
            >
              مسح الفلاتر
            </Button>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {[
                    "الاسم والتواصل",
                    "الحالة",
                    "القسم / المندوب",
                    "المصدر",
                    "تاريخ الإنشاء",
                    "الإجراءات",
                  ].map((label) => (
                    <th key={label} className="text-right p-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data?.rows.map((l: any) => (
                  <tr key={l.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <span className="font-medium">{l.contact_name}</span>
                      {l.contact_phone && (
                        <div dir="ltr" className="text-right text-xs text-muted-foreground">
                          {l.contact_phone}
                        </div>
                      )}
                      {l.contact_email && (
                        <div dir="ltr" className="text-right text-xs text-muted-foreground">
                          {l.contact_email}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge className={COLORS[l.status]}>{LABELS[l.status]}</Badge>
                    </td>
                    <td className="p-3 text-xs">
                      {opts.data?.departments.find((d) => d.id === l.department_id)?.name ??
                        "بدون قسم"}
                      <div className="text-muted-foreground">
                        {opts.data?.users.find((u) => u.id === l.owner_user_id)?.full_name ??
                          "غير معين"}
                      </div>
                    </td>
                    <td className="p-3">{l.source || "—"}</td>
                    <td className="p-3 whitespace-nowrap">
                      {new Date(l.opened_at).toLocaleDateString("ar")}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        {can("crm.leads.update") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => show(l)}
                          >
                            <Pencil className="h-3 w-3" />
                            تعديل
                          </Button>
                        )}
                        {can("crm.leads.update") && can("crm.opportunities.create") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={l.status === "converted" || busy}
                            onClick={() => convertMut.mutate(l.id)}
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                            {convertMut.isPending && convertMut.variables === l.id
                              ? "جارٍ التحويل…"
                              : "تحويل إلى فرصة"}
                          </Button>
                        )}
                        {can("crm.leads.delete") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`حذف ${l.contact_name}`}
                            disabled={busy || l.status === "converted"}
                            onClick={() => setDeleting(l)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!q.data?.rows.length && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-muted-foreground">
                      لا يوجد عملاء مطابقون للفلاتر
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              disabled={page === 1 || q.isFetching}
              onClick={() => setPage((p) => p - 1)}
            >
              السابق
            </Button>
            <span className="text-sm">
              صفحة {page} من {Math.max(1, Math.ceil((q.data?.total ?? 0) / 25))}
            </span>
            <Button
              variant="outline"
              disabled={page * 25 >= (q.data?.total ?? 0) || q.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              التالي
            </Button>
          </div>
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!save.isPending) setOpen(value);
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل العميل المحتمل" : "عميل محتمل جديد"}</DialogTitle>
          </DialogHeader>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <fieldset className="space-y-3 min-w-0" disabled={save.isPending}>
              <div>
                <Label htmlFor="lead-name">الاسم (إلزامي)</Label>
                <Input
                  id="lead-name"
                  required
                  maxLength={200}
                  value={form.contactName}
                  onChange={(e) => field("contactName", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-phone">الهاتف (اختياري)</Label>
                  <Input
                    id="lead-phone"
                    type="tel"
                    dir="ltr"
                    placeholder="+905xxxxxxxxx"
                    value={form.phone}
                    onChange={(e) => field("phone", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="lead-email">البريد (اختياري)</Label>
                  <Input
                    id="lead-email"
                    type="email"
                    dir="ltr"
                    value={form.email}
                    onChange={(e) => field("email", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-edit-status">الحالة</Label>
                  <select
                    id="lead-edit-status"
                    className={selectClass}
                    disabled={editing?.status === "converted"}
                    value={form.status}
                    onChange={(e) => field("status", e.target.value)}
                  >
                    {Object.entries(LABELS)
                      .filter(([key]) => key !== "converted" || editing?.status === "converted")
                      .map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="lead-source">المصدر (اختياري)</Label>
                  <Input
                    id="lead-source"
                    maxLength={100}
                    value={form.source}
                    onChange={(e) => field("source", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lead-edit-department">
                    القسم {opts.data?.scope === "department" ? "(إلزامي)" : "(اختياري)"}
                  </Label>
                  <select
                    id="lead-edit-department"
                    className={selectClass}
                    disabled={!!editing && !can("crm.leads.assign") && !can("org.manage")}
                    value={form.departmentId}
                    onChange={(e) => {
                      field("departmentId", e.target.value);
                      field("ownerUserId", opts.data?.userId ?? "");
                    }}
                  >
                    <option value="">بدون قسم</option>
                    {opts.data?.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="lead-edit-owner">المندوب</Label>
                  <select
                    id="lead-edit-owner"
                    className={selectClass}
                    disabled={!can("crm.leads.assign") && !can("org.manage")}
                    value={form.ownerUserId}
                    onChange={(e) => field("ownerUserId", e.target.value)}
                  >
                    <option value="">غير معين</option>
                    {filteredUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name ?? "مستخدم"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor="lead-notes">الملاحظات (اختياري)</Label>
                <Textarea
                  id="lead-notes"
                  maxLength={2000}
                  value={form.notes}
                  onChange={(e) => field("notes", e.target.value)}
                />
              </div>
              {opts.data?.fields.map((def) => (
                <CustomFieldInput
                  key={def.id}
                  def={def}
                  value={form.customFields[def.key]}
                  onChange={(value) =>
                    field("customFields", { ...form.customFields, [def.key]: value })
                  }
                />
              ))}
            </fieldset>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => setOpen(false)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "جارٍ الحفظ…" : "حفظ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!removeMut.isPending && !value) setDeleting(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف العميل المحتمل؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف سجل «{deleting?.contact_name}» والمهام والأنشطة المرتبطة به، وستبقى جهة
              الاتصال. لا يمكن التراجع عن الحذف.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMut.isPending}>إلغاء</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={removeMut.isPending}
              onClick={() => removeMut.mutate(deleting.id)}
            >
              {removeMut.isPending ? "جارٍ الحذف…" : "تأكيد الحذف"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
