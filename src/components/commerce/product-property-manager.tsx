import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Pencil, Plus, X } from "lucide-react";
import { listProductAttributes, saveProductAttribute } from "@/modules/commerce/stock.functions";
import type { AttributeDefinition } from "@/modules/commerce/product-attributes";
import { usePermission } from "@/platform/rbac/use-permission";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Kind = AttributeDefinition["kind"];
type Scope = AttributeDefinition["scope"];

// Ordered so the common choices come first.
const TYPES: [Kind, string][] = [
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
const isList = (kind: Kind) => kind === "select" || kind === "multiselect";

const SCOPES: Record<Scope, { title: string; hint: string; newLabel: string }> = {
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
        const items = definitions.filter((d) => d.scope === scope);
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
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
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

  return (
    <section className="space-y-4" data-validation-scope>
      {onBack && (
        <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={onBack}>
          <ArrowRight className="h-3.5 w-3.5" />
          رجوع للقائمة
        </button>
      )}

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

      <div className="space-y-1">
        <Label htmlFor="property-name">الاسم</Label>
        <Input
          id="property-name"
          required
          placeholder={form.scope === "variant" ? "مثال: اللون، المقاس، السعة" : "مثال: الخامة، الضمان، بلد الصنع"}
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
        />
      </div>

      {!editing && showType && (
        <div className="space-y-1">
          <Label htmlFor="property-kind">نوع القيمة</Label>
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

      {isList(form.kind) && (
        <ValuesInput
          values={form.options}
          locked={lockedValues}
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

/** Values as chips: type and press Enter (or comma). Values already saved cannot be removed. */
function ValuesInput({
  values,
  locked,
  placeholder,
  onChange,
}: {
  values: string[];
  locked: Set<string>;
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const add = (text: string) => {
    const added = text.split(/[،,]/).map((v) => v.trim()).filter(Boolean);
    if (!added.length) return;
    onChange([...new Set([...values, ...added])]);
    setInput("");
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor="property-value">القيم</Label>
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
      {locked.size > 0 && <p className="text-[11px] text-muted-foreground">القيم المحفوظة لا تُحذف لأنها قد تكون مستخدمة في منتجات.</p>}
    </div>
  );
}
