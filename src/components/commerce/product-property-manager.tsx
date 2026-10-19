import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deleteProductAttribute,
  listProductAttributes,
  listReadyValueLists,
  saveReadyValueLists,
  saveProductAttribute,
  setProductAttributeHidden,
} from "@/modules/commerce/stock.functions";
import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import { READY_PROPERTIES, toggleReadyList, type ReadyValueList } from "@/modules/commerce/product-options";
import { usePermission } from "@/platform/rbac/use-permission";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Kind = AttributeDefinition["kind"];
type Scope = AttributeDefinition["scope"];

// Ordered so the common choices come first.
export const TYPES: [Kind, string][] = [
  ["select", "اختيار من قائمة"],
  ["multiselect", "اختيار عدة قيم من قائمة"],
  ["text", "نص حر"],
  ["number", "رقم"],
  ["money", "مبلغ / سعر"],
  ["date", "تاريخ"],
  ["boolean", "نعم / لا"],
  ["url", "رابط"],
  ["file", "رابط ملف"],
];
const typeLabel = (kind: Kind) => TYPES.find(([k]) => k === kind)?.[1] ?? kind;
export const isList = (kind: Kind) => kind === "select" || kind === "multiselect";

export const SCOPES: Record<Scope, { title: string; hint: string; newLabel: string }> = {
  variant: { title: "خيارات لها كمية", hint: "مثل اللون والمقاس — لكل تركيبة كميتها", newLabel: "خيار جديد" },
  product: { title: "مواصفات المنتج", hint: "مثل الخامة أو الضمان — بدون كمية", newLabel: "مواصفة جديدة" },
};

type Form = { id?: string; name: string; kind: Kind; scope: Scope; isPriceFloor: boolean; options: string[] };
const newForm = (scope: Scope): Form => ({ name: "", kind: "select", scope, isPriceFloor: false, options: [] });

/**
 * The organization's product properties in two plain groups: options with stock (اللون، المقاس) and
 * product specifications (الخامة، الضمان). All nine value types and the price floor stay available.
 * Opened from the product dialog (onSaved given), it goes straight to a new property of defaultScope.
 */
export function ProductPropertyManager({
  onSaved,
  defaultScope = "product",
}: {
  onSaved?: (definition: AttributeDefinition) => void;
  defaultScope?: Scope;
}) {
  const canManage = usePermission("products.manage");
  const qc = useQueryClient();
  const fetch = useServerFn(listProductAttributes);
  const save = useServerFn(saveProductAttribute);
  const q = useQuery({ queryKey: ["product-attributes"], queryFn: () => fetch() });
  const direct = !!onSaved;
  const [form, setForm] = useState<Form | null>(direct ? newForm(defaultScope) : null);
  const definitions = (q.data ?? []) as AttributeDefinition[];
  const original = form?.id ? definitions.find((d) => d.id === form.id) : undefined;
  const remove = useServerFn(deleteProductAttribute);
  const hide = useServerFn(setProductAttributeHidden);
  // The property being deleted; usedBy is set when products use it and it can only be hidden.
  const [removing, setRemoving] = useState<{ definition: AttributeDefinition; usedBy?: number } | null>(null);
  const hidden = definitions.filter((d) => d.is_archived);

  const removeMut = useMutation({
    mutationFn: (definition: AttributeDefinition) => remove({ data: { id: definition.id } }),
    onSuccess: (result, definition) => {
      if (result.deleted) {
        qc.invalidateQueries({ queryKey: ["product-attributes"] });
        toast.success("تم حذف الخاصية");
        setRemoving(null);
      } else setRemoving({ definition, usedBy: result.usedBy });
    },
    onError: (e) => toast.error(e.message),
  });
  const hideMut = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => hide({ data: { id, hidden } }),
    onSuccess: (_, { hidden }) => {
      qc.invalidateQueries({ queryKey: ["product-attributes"] });
      toast.success(hidden ? "تم إخفاء الخاصية" : "تم إظهار الخاصية");
      setRemoving(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const mut = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.name.trim()) throw new Error("اكتب الاسم أولًا");
      const options = [...new Set(f.options.map((v) => v.trim()).filter(Boolean))];
      if (isList(f.kind) && !options.length) throw new Error("أضف قيمة واحدة على الأقل");
      return save({ data: { ...f, name: f.name.trim(), options: isList(f.kind) ? options : [] } });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["product-attributes"] });
      toast.success("تم الحفظ");
      if (direct) onSaved?.(result as AttributeDefinition);
      else setForm(null);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!canManage) return null;
  if (q.isError)
    return (
      <div className="space-y-2">
        <p className="text-destructive">تعذر تحميل الخصائص</p>
        <Button type="button" variant="outline" onClick={() => q.refetch()}>
          إعادة المحاولة
        </Button>
      </div>
    );
  if (q.isPending) return <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>;

  if (form)
    return (
      <PropertyForm
        form={form}
        original={original}
        saving={mut.isPending}
        onChange={setForm}
        onSave={() => mut.mutate(form)}
        onBack={direct ? undefined : () => setForm(null)}
      />
    );

  return (
    <div className="space-y-5">
      {(["variant", "product"] as Scope[]).map((scope) => {
        const items = definitions.filter((d) => d.scope === scope && !d.is_archived);
        return (
          <section key={scope} className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-sm">{SCOPES[scope].title}</h3>
                <p className="text-xs text-muted-foreground">{SCOPES[scope].hint}</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => setForm(newForm(scope))}>
                <Plus className="h-3.5 w-3.5" />
                {SCOPES[scope].newLabel}
              </Button>
            </div>
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">لا يوجد بعد</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {items.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{d.name}</span>
                        {!(scope === "variant" && d.kind === "select") && (
                          <span className="text-[11px] text-muted-foreground">{typeLabel(d.kind)}</span>
                        )}
                        {d.is_price_floor && <span className="text-[11px] text-muted-foreground">· حد أدنى للبيع</span>}
                      </div>
                      {d.options.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.options.slice(0, 10).map((o) => (
                            <span key={o} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                              {o}
                            </span>
                          ))}
                          {d.options.length > 10 && (
                            <span className="text-[11px] text-muted-foreground">+{d.options.length - 10}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      aria-label={`تعديل ${d.name}`}
                      onClick={() =>
                        setForm({ id: d.id, name: d.name, kind: d.kind, scope: d.scope, isPriceFloor: d.is_price_floor, options: [...d.options] })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                      aria-label={`حذف ${d.name}`}
                      onClick={() => setRemoving({ definition: d })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <ReadyListsSection />

      {hidden.length > 0 && (
        <details className="rounded-md border p-2.5">
          <summary className="cursor-pointer text-xs text-muted-foreground">خصائص مخفية ({hidden.length})</summary>
          <ul className="mt-2 divide-y">
            {hidden.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-sm">{d.name}</span>
                <Button type="button" size="sm" variant="outline" disabled={hideMut.isPending} onClick={() => hideMut.mutate({ id: d.id, hidden: false })}>
                  إظهار
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && !removeMut.isPending && !hideMut.isPending && setRemoving(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>{removing?.usedBy ? `«${removing.definition.name}» مستعملة` : `حذف «${removing?.definition.name}»؟`}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.usedBy
                ? `هذه الخاصية مستعملة في ${removing.usedBy} ${removing.usedBy === 1 ? "منتج" : "منتجات"}، لذلك لا يمكن حذفها. يمكنك إخفاؤها من القوائم، وتبقى قيمها في المنتجات كما هي.`
                : "ستُحذف الخاصية نهائيًا إذا لم يكن أي منتج يستعملها."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            {removing?.usedBy ? (
              <Button type="button" disabled={hideMut.isPending} onClick={() => removing && hideMut.mutate({ id: removing.definition.id, hidden: true })}>
                {hideMut.isPending ? "جارٍ الإخفاء..." : "إخفاء"}
              </Button>
            ) : (
              <Button type="button" variant="destructive" disabled={removeMut.isPending} onClick={() => removing && removeMut.mutate(removing.definition)}>
                {removeMut.isPending ? "جارٍ الحذف..." : "حذف"}
              </Button>
            )}
            <AlertDialogCancel disabled={removeMut.isPending || hideMut.isPending}>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PropertyForm({
  form,
  original,
  saving,
  onChange,
  onSave,
  onBack,
}: {
  form: Form;
  original?: AttributeDefinition;
  saving: boolean;
  onChange: (form: Form) => void;
  onSave: () => void;
  onBack?: () => void;
}) {
  const editing = !!form.id;
  // Stock options are normally a single choice; other types stay one click away.
  const [otherType, setOtherType] = useState(form.scope === "variant" && form.kind !== "select");
  const showType = form.scope === "product" || otherType;
  const lockedValues = new Set(original?.options ?? []);
  // Ready-made value lists only add values; the property's name is always typed by the user.
  const templates = useReadyLists().filter((p) => p.stock === (form.scope === "variant"));
  const [applied, setApplied] = useState<string[]>([]);
  const suggestions = [...new Set(templates.filter((p) => applied.includes(p.label)).flatMap((p) => p.values))];

  return (
    <section className="space-y-4" data-validation-scope>
      {onBack && (
        <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={onBack}>
          <ArrowRight className="h-3.5 w-3.5" />
          رجوع للقائمة
        </button>
      )}

      <div className="space-y-1">
        <Label htmlFor="property-name">اسم الخاصية</Label>
        <Input
          id="property-name"
          required
          placeholder={form.scope === "variant" ? "مثال: لون الغطاء، مقاس البنطلون" : "مثال: نوع القماش، مدة الضمان"}
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
        />
      </div>

      {!editing && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="نوع الخاصية">
          {(["variant", "product"] as Scope[]).map((scope) => (
            <button
              key={scope}
              type="button"
              role="radio"
              aria-checked={form.scope === scope}
              className={`rounded-lg border p-2.5 text-start transition-colors ${form.scope === scope ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
              onClick={() => {
                onChange({ ...form, scope, kind: scope === "variant" && form.kind === "money" ? "select" : form.kind, isPriceFloor: scope === "variant" ? false : form.isPriceFloor });
                if (scope === "product") setOtherType(false);
              }}
            >
              <div className="text-sm font-medium">{SCOPES[scope].title}</div>
              <div className="text-[11px] text-muted-foreground">{SCOPES[scope].hint}</div>
            </button>
          ))}
        </div>
      )}
      {editing && (
        <p className="text-xs text-muted-foreground">
          {SCOPES[form.scope].title} · {typeLabel(form.kind)} — يمكن تعديل الاسم وإضافة قيم جديدة.
        </p>
      )}

      {!editing && showType && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="property-kind">نوع القيمة</Label>
            {form.scope === "variant" && (
              <button
                type="button"
                aria-label="إلغاء نوع القيمة المختلف"
                className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  setOtherType(false);
                  onChange({ ...form, kind: "select", isPriceFloor: false });
                }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <select
            id="property-kind"
            className="w-full border rounded-md bg-background p-2 text-sm"
            value={form.kind}
            onChange={(e) => onChange({ ...form, kind: e.target.value as Kind, isPriceFloor: false })}
          >
            {TYPES.filter(([kind]) => form.scope === "product" || kind !== "money").map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {!editing && form.scope === "variant" && !otherType && (
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOtherType(true)}>
          نوع قيمة مختلف (رقم، تاريخ…)
        </button>
      )}

      {!isList(form.kind) && (
        <p className="text-xs text-muted-foreground">القيمة تُكتب لكل منتج عند إضافته.</p>
      )}

      {isList(form.kind) && !form.name.trim() && (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">اكتب اسم الخاصية أولًا، ثم أضف قيمها</p>
      )}

      {isList(form.kind) && form.name.trim() && (
        <ValuesInput
          values={form.options}
          locked={lockedValues}
          suggestions={suggestions}
          templates={templates}
          applied={applied}
          onApply={(template) => {
            const next = toggleReadyList(form.options, applied, template, templates, lockedValues);
            setApplied(next.applied);
            onChange({ ...form, options: next.values });
          }}
          placeholder={form.scope === "variant" ? "مثال: أحمر" : "مثال: قطن"}
          onChange={(options) => onChange({ ...form, options })}
        />
      )}

      {form.kind === "money" && form.scope === "product" && (
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isPriceFloor}
            onChange={(e) => onChange({ ...form, isPriceFloor: e.target.checked })}
          />
          استخدامه حدًا أدنى للبيع (سعر التكلفة)
        </label>
      )}

      <div className="flex gap-2">
        <Button type="button" disabled={saving} onClick={onSave}>
          {saving ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
        {onBack && (
          <Button type="button" variant="ghost" disabled={saving} onClick={onBack}>
            إلغاء
          </Button>
        )}
      </div>
    </section>
  );
}

/** The organization's ready value lists (its own, or the built-in ones until it sets them). */
export function useReadyLists(): ReadyValueList[] {
  const fetchLists = useServerFn(listReadyValueLists);
  const q = useQuery({ queryKey: ["ready-value-lists"], queryFn: () => fetchLists(), staleTime: 5 * 60_000 });
  return q.data?.lists ?? READY_PROPERTIES;
}

/** Values as chips: type and press Enter (or comma). Values already saved cannot be removed. */
export function ValuesInput({
  values,
  locked,
  suggestions,
  templates,
  applied,
  onApply,
  placeholder,
  onChange,
}: {
  values: string[];
  locked: Set<string>;
  suggestions: string[];
  templates: ReadyValueList[];
  applied: string[];
  onApply: (template: ReadyValueList) => void;
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [allTemplates, setAllTemplates] = useState(false);
  // One row of ready lists; the rest behind «المزيد».
  const shownTemplates = allTemplates ? templates : templates.slice(0, 3);
  const add = (text: string) => {
    const added = text.split(/[،,]/).map((v) => v.trim()).filter(Boolean);
    if (!added.length) return;
    onChange([...new Set([...values, ...added])]);
    setInput("");
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor="property-value">القيم</Label>
      {templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">قيم جاهزة:</span>
          {shownTemplates.map((t) => (
            <button
              key={t.label}
              type="button"
              className={`rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent ${applied.includes(t.label) ? "border-primary bg-primary/10 text-primary" : ""}`}
              onClick={() => onApply(t)}
            >
              {t.label}
            </button>
          ))}
          {templates.length > shownTemplates.length && (
            <button type="button" className="px-1 text-xs text-primary hover:underline" onClick={() => setAllTemplates(true)}>
              المزيد…
            </button>
          )}
        </div>
      )}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span key={value} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium">
              {value}
              {!locked.has(value) && (
                <button type="button" aria-label={`إزالة ${value}`} className="rounded-full hover:bg-primary/20" onClick={() => onChange(values.filter((v) => v !== value))}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id="property-value"
          value={input}
          placeholder={`${placeholder} ثم Enter`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(input);
            }
          }}
          onBlur={() => add(input)}
        />
        <Button type="button" variant="outline" onClick={() => add(input)}>
          إضافة
        </Button>
      </div>
      {suggestions.some((v) => !values.includes(v)) && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions
            .filter((v) => !values.includes(v))
            .map((v) => (
              <button key={v} type="button" className="rounded-full border border-dashed px-2.5 py-0.5 text-xs hover:bg-accent" onClick={() => onChange([...values, v])}>
                + {v}
              </button>
            ))}
        </div>
      )}
      {locked.size > 0 && <p className="text-[11px] text-muted-foreground">القيم المحفوظة لا تُحذف لأنها قد تكون مستخدمة في منتجات.</p>}
    </div>
  );
}

/** The ready value lists offered when adding a property; each organization can set its own. */
function ReadyListsSection() {
  const qc = useQueryClient();
  const fetchLists = useServerFn(listReadyValueLists);
  const save = useServerFn(saveReadyValueLists);
  const q = useQuery({ queryKey: ["ready-value-lists"], queryFn: () => fetchLists(), staleTime: 5 * 60_000 });
  const [draft, setDraft] = useState<(ReadyValueList & { key: string })[] | null>(null);
  const mut = useMutation({
    mutationFn: (lists: ReadyValueList[]) => save({ data: { lists } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ready-value-lists"] });
      toast.success("تم حفظ القيم الجاهزة");
      setDraft(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const lists = q.data?.lists ?? READY_PROPERTIES;

  if (!draft)
    return (
      <section className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm">القيم الجاهزة</h3>
            <p className="text-xs text-muted-foreground">
              قوائم تظهر عند إضافة خاصية لتعبئة القيم بضغطة{q.data && !q.data.custom ? " — هذه القوائم الافتراضية، عدّلها لتناسب بضاعتك" : ""}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1 shrink-0"
            onClick={() => setDraft(lists.map((l) => ({ label: l.label, stock: l.stock, values: [...l.values], key: crypto.randomUUID() })))}
          >
            <Pencil className="h-3.5 w-3.5" />
            تعديل
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {lists.map((l) => (
            <span key={l.label} className="rounded-full bg-muted px-2.5 py-0.5 text-[11px]" title={l.values.join("، ")}>
              {l.label} ({l.values.length})
            </span>
          ))}
        </div>
      </section>
    );

  const update = (key: string, patch: Partial<ReadyValueList>) => setDraft(draft.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <section className="space-y-3 rounded-lg border p-3" data-validation-scope>
      <h3 className="font-semibold text-sm">تعديل القيم الجاهزة</h3>
      {draft.map((l) => (
        <div key={l.key} className="space-y-2 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <Input className="h-8" aria-label="اسم القائمة" placeholder="مثال: ألوان العبايات" value={l.label} onChange={(e) => update(l.key, { label: e.target.value })} />
            <select
              aria-label="نوع القائمة"
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={l.stock ? "stock" : "spec"}
              onChange={(e) => update(l.key, { stock: e.target.value === "stock" })}
            >
              <option value="stock">لها كمية</option>
              <option value="spec">مواصفات</option>
            </select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
              aria-label={`حذف قائمة ${l.label}`}
              onClick={() => setDraft(draft.filter((x) => x.key !== l.key))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <ValuesInput
            values={l.values}
            locked={new Set()}
            suggestions={[]}
            templates={[]}
            applied={[]}
            onApply={() => {}}
            placeholder="مثال: كحلي"
            onChange={(values) => update(l.key, { values })}
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1"
        onClick={() => setDraft([...draft, { key: crypto.randomUUID(), label: "", stock: true, values: [] }])}
      >
        <Plus className="h-3.5 w-3.5" />
        قائمة جديدة
      </Button>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={mut.isPending}
          onClick={() => {
            const lists = draft.map(({ label, stock, values }) => ({ label: label.trim(), stock, values })).filter((l) => l.label || l.values.length);
            if (lists.some((l) => !l.label)) return toast.error("اكتب اسمًا لكل قائمة");
            if (lists.some((l) => !l.values.length)) return toast.error("أضف قيمة واحدة على الأقل لكل قائمة");
            mut.mutate(lists);
          }}
        >
          {mut.isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
        <Button type="button" variant="ghost" disabled={mut.isPending} onClick={() => setDraft(null)}>
          إلغاء
        </Button>
        <Button type="button" variant="ghost" className="mr-auto text-xs" disabled={mut.isPending} onClick={() => mut.mutate([])}>
          استرجاع القوائم الافتراضية
        </Button>
      </div>
    </section>
  );
}
