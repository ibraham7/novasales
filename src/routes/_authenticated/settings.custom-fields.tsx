import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Plus, Trash2, Pencil, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { listFieldDefs, upsertFieldDef, deleteFieldDef } from "@/modules/crm";

export const Route = createFileRoute("/_authenticated/settings/custom-fields")({
  head: () => ({ meta: [{ title: "الحقول المخصصة - NovaSales" }] }),
  component: CustomFieldsPage,
});

const ENTITIES = [
  { key: "lead", label: "العملاء المحتملون" },
  { key: "opportunity", label: "الفرص" },
  { key: "contact", label: "جهات الاتصال" },
];

const TYPES = [
  { value: "text", label: "نص" },
  { value: "number", label: "رقم" },
  { value: "date", label: "تاريخ" },
  { value: "select", label: "قائمة" },
  { value: "multiselect", label: "قائمة متعددة" },
  { value: "boolean", label: "نعم / لا" },
  { value: "phone", label: "هاتف" },
  { value: "email", label: "بريد إلكتروني" },
];

const VISIBILITIES = [
  { value: "everyone", label: "الجميع" },
  { value: "agent", label: "المندوبون فما فوق" },
  { value: "supervisor", label: "المشرفون فما فوق" },
  { value: "admin", label: "المسؤولون" },
  { value: "owner", label: "المالك فقط" },
];

interface FieldRow {
  id: string;
  key: string;
  label: string;
  field_type: string;
  field_group: string;
  visibility: string;
  is_required: boolean;
  read_only: boolean;
  is_active: boolean;
  is_searchable: boolean;
  is_filterable: boolean;
  system_field: boolean;
  ord: number;
  options: Array<{ value: string; label: string }>;
  validation: Record<string, unknown>;
  default_value: unknown;
}

function CustomFieldsPage() {
  const [entity, setEntity] = useState("lead");
  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h2 className="text-xl font-semibold">الحقول المخصصة</h2>
        <p className="text-sm text-muted-foreground">أضف حقولاً ديناميكية للعملاء، الفرص، وجهات الاتصال.</p>
      </div>
      <Tabs value={entity} onValueChange={setEntity}>
        <TabsList>
          {ENTITIES.map((e) => (<TabsTrigger key={e.key} value={e.key}>{e.label}</TabsTrigger>))}
        </TabsList>
        {ENTITIES.map((e) => (
          <TabsContent key={e.key} value={e.key}>
            <FieldList entityType={e.key} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function FieldList({ entityType }: { entityType: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listFieldDefs);
  const upsertFn = useServerFn(upsertFieldDef);
  const deleteFn = useServerFn(deleteFieldDef);
  const [editing, setEditing] = useState<Partial<FieldRow> | null>(null);

  const { data: fields = [] } = useQuery({
    queryKey: ["field-defs", entityType],
    queryFn: () => listFn({ data: { entityType } }) as Promise<FieldRow[]>,
  });

  const save = useMutation({
    mutationFn: (payload: any) => upsertFn({ data: payload }),
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["field-defs", entityType] });
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الحفظ"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["field-defs", entityType] });
    },
    onError: (e: any) => toast.error(e.message ?? "فشل الحذف"),
  });

  // Group by field_group
  const grouped = fields.reduce<Record<string, FieldRow[]>>((acc, f) => {
    (acc[f.field_group] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ field_type: "text", visibility: "everyone", field_group: "General", is_active: true })}>
          <Plus className="h-4 w-4 ml-2" /> حقل جديد
        </Button>
      </div>

      {Object.entries(grouped).length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">لا توجد حقول بعد.</Card>
      )}

      {Object.entries(grouped).map(([group, items]) => (
        <div key={group} className="space-y-2">
          <div className="text-sm font-semibold text-muted-foreground">{group}</div>
          <Card className="divide-y">
            {items.map((f) => (
              <div key={f.id} className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{f.label}</span>
                    <code className="text-xs text-muted-foreground">{f.key}</code>
                    {f.system_field && <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" /> نظامي</Badge>}
                    {!f.is_active && <Badge variant="outline">معطل</Badge>}
                  </div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <Badge variant="outline">{TYPES.find((t) => t.value === f.field_type)?.label}</Badge>
                    {f.is_required && <Badge variant="outline">مطلوب</Badge>}
                    {f.read_only && <Badge variant="outline">قراءة فقط</Badge>}
                    <Badge variant="outline">{VISIBILITIES.find((v) => v.value === f.visibility)?.label}</Badge>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setEditing(f)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  disabled={f.system_field}
                  onClick={() => { if (confirm("حذف هذا الحقل؟")) remove.mutate(f.id); }}
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            ))}
          </Card>
        </div>
      ))}

      {editing && (
        <FieldEditor
          entityType={entityType}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(payload) => save.mutate(payload)}
          saving={save.isPending}
        />
      )}
    </div>
  );
}

function FieldEditor({ entityType, initial, onClose, onSave, saving }: {
  entityType: string;
  initial: Partial<FieldRow>;
  onClose: () => void;
  onSave: (payload: any) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<FieldRow>>(initial);
  const optionsText = (form.options ?? []).map((o) => `${o.value}|${o.label}`).join("\n");
  const isEdit = !!initial.id;
  const isSystem = !!initial.system_field;

  const submit = () => {
    if (!form.label || !form.field_type) {
      toast.error("التسمية والنوع مطلوبان");
      return;
    }
    if (!form.key && !isEdit) {
      toast.error("المفتاح مطلوب");
      return;
    }
    onSave({
      id: initial.id,
      entityType,
      key: form.key ?? initial.key,
      label: form.label,
      fieldType: form.field_type,
      fieldGroup: form.field_group ?? "General",
      options: form.options ?? [],
      defaultValue: form.default_value ?? null,
      validation: form.validation ?? {},
      visibility: form.visibility ?? "everyone",
      isRequired: !!form.is_required,
      readOnly: !!form.read_only,
      isSearchable: !!form.is_searchable,
      isFilterable: !!form.is_filterable,
      isActive: form.is_active ?? true,
      ord: form.ord ?? 0,
    });
  };

  const showOptions = form.field_type === "select" || form.field_type === "multiselect";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل حقل" : "حقل جديد"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>التسمية</Label>
              <Input required aria-label="اسم الحقل" value={form.label ?? ""} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div>
              <Label>المفتاح (بالإنجليزية)</Label>
              <Input required aria-label="مفتاح الحقل"
                value={form.key ?? ""}
                disabled={isEdit}
                placeholder="my_field"
                onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>النوع</Label>
              <Select value={form.field_type} disabled={isSystem} onValueChange={(v) => setForm({ ...form, field_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>المجموعة</Label>
              <Input value={form.field_group ?? "General"} onChange={(e) => setForm({ ...form, field_group: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>الرؤية</Label>
            <Select value={form.visibility ?? "everyone"} onValueChange={(v) => setForm({ ...form, visibility: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{VISIBILITIES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {showOptions && (
            <div>
              <Label>الخيارات (سطر لكل خيار بصيغة قيمة|تسمية)</Label>
              <textarea
                className="w-full min-h-24 rounded-md border p-2 text-sm bg-background"
                value={optionsText}
                onChange={(e) => {
                  const opts = e.target.value.split("\n").map((l) => {
                    const [value, label] = l.split("|");
                    return value ? { value: value.trim(), label: (label ?? value).trim() } : null;
                  }).filter(Boolean) as Array<{ value: string; label: string }>;
                  setForm({ ...form, options: opts });
                }}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2">
              <Switch checked={!!form.is_required} onCheckedChange={(v) => setForm({ ...form, is_required: v })} />
              <span className="text-sm">مطلوب</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={!!form.read_only} onCheckedChange={(v) => setForm({ ...form, read_only: v })} />
              <span className="text-sm">للقراءة فقط</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={!!form.is_searchable} onCheckedChange={(v) => setForm({ ...form, is_searchable: v })} />
              <span className="text-sm">قابل للبحث</span>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={!!form.is_filterable} onCheckedChange={(v) => setForm({ ...form, is_filterable: v })} />
              <span className="text-sm">قابل للفلترة</span>
            </label>
            <label className="flex items-center gap-2 col-span-2">
              <Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <span className="text-sm">مفعّل</span>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button validate onClick={submit} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
