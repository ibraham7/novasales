import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Lock, Minus, Plus, Search, X } from "lucide-react";
import { COUNTRY_OPTIONS, LANGUAGES, LOCKED_FILTERS, STATUS_OPTIONS, TECHNOLOGIES, countActiveFilters, incExcCount, type Filters, type IncExc } from "@/modules/marketing/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const selectClass = "w-full rounded-md border bg-background p-2 text-sm";

/** A filter's block: a title with how many values are set, opening and closing. */
export function FilterSection({ title, count = 0, defaultOpen = false, children }: { title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen || count > 0);
  return (
    <div className="border-b py-2">
      <button type="button" className="flex w-full items-center gap-2 py-1 text-sm font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flex-1 text-right">{title}</span>
        {count > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{count}</Badge>}
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="space-y-2 pb-2 pt-1">{children}</div>}
    </div>
  );
}

const tone = (side: "include" | "exclude") => (side === "include" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300");

/** Typed values as tags, each included or excluded. Enter adds; the toggle picks the side. */
export function TagField({ value, onChange, placeholder, label = (v) => v }: { value: IncExc; onChange: (v: IncExc) => void; placeholder: string; label?: (v: string) => string }) {
  const [text, setText] = useState("");
  const [side, setSide] = useState<"include" | "exclude">("include");
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const other = side === "include" ? "exclude" : "include";
    if (!value[side].includes(t)) onChange({ ...value, [side]: [...value[side], t].slice(0, 50), [other]: value[other].filter((x) => x !== t) });
    setText("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <Input value={text} maxLength={80} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        <Button type="button" size="icon" variant="outline" className={cn("shrink-0", tone(side))} aria-label={side === "include" ? "تضمين" : "استثناء"} title={side === "include" ? "تضمين (اضغط للتحويل إلى استثناء)" : "استثناء (اضغط للتحويل إلى تضمين)"} onClick={() => setSide(side === "include" ? "exclude" : "include")}>
          {side === "include" ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {(["include", "exclude"] as const).flatMap((s) =>
          value[s].map((v) => (
            <span key={`${s}:${v}`} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", tone(s))}>
              {s === "exclude" && <Minus className="h-3 w-3" />}
              {label(v)}
              <button type="button" aria-label={`إزالة ${label(v)}`} onClick={() => onChange({ ...value, [s]: value[s].filter((x) => x !== v) })}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )),
        )}
      </div>
    </div>
  );
}

/** A searchable list; each option can be included (+) or excluded (−). */
export function OptionList({ options, value, onChange, counts, searchable = true }: { options: { key: string; label: string }[]; value: IncExc; onChange: (v: IncExc) => void; counts?: Record<string, number>; searchable?: boolean }) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()) || o.key.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (key: string, side: "include" | "exclude") => {
    const other = side === "include" ? "exclude" : "include";
    const on = value[side].includes(key);
    onChange({ ...value, [side]: on ? value[side].filter((x) => x !== key) : [...value[side], key], [other]: value[other].filter((x) => x !== key) });
  };
  return (
    <div className="space-y-1.5">
      {searchable && (
        <div className="relative">
          <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-8 pr-8 text-xs" placeholder="ابحث في الخيارات" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="max-h-52 space-y-0.5 overflow-y-auto pl-1">
        {shown.map((o) => {
          const inc = value.include.includes(o.key);
          const exc = value.exclude.includes(o.key);
          return (
            <div key={o.key} className={cn("flex items-center gap-1.5 rounded px-1.5 py-1 text-sm", inc && "bg-emerald-500/10", exc && "bg-red-500/10")}>
              <span className={cn("flex-1 truncate", exc && "line-through opacity-70")}>{o.label}</span>
              {counts && <span className="text-xs text-muted-foreground">{counts[o.key] ?? 0}</span>}
              <button type="button" aria-label={`تضمين ${o.label}`} aria-pressed={inc} className={cn("rounded border p-0.5", inc ? "border-emerald-600 bg-emerald-600 text-white" : "text-muted-foreground")} onClick={() => toggle(o.key, "include")}>
                <Check className="h-3 w-3" />
              </button>
              <button type="button" aria-label={`استثناء ${o.label}`} aria-pressed={exc} className={cn("rounded border p-0.5", exc ? "border-red-600 bg-red-600 text-white" : "text-muted-foreground")} onClick={() => toggle(o.key, "exclude")}>
                <Minus className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="py-1 text-xs text-muted-foreground">لا نتائج.</p>}
      </div>
    </div>
  );
}

function Flag({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

const numberOrNull = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) || Number(text) < 0 ? null : Math.floor(Number(text)));

/** Filters that need people / company data we do not hold yet: shown locked, never empty-looking. */
export function LockedFilters({ groups }: { groups: ("people" | "company" | "signals")[] }) {
  const items = LOCKED_FILTERS.filter((f) => groups.includes(f.group));
  return (
    <FilterSection title="فلاتر تتطلب مصدر بيانات" defaultOpen={false}>
      <p className="text-xs text-muted-foreground">هذه الفلاتر تحتاج بيانات أشخاص وشركات لا تعرضها خرائط Google. تتفعّل عند ربط مصدر بيانات (مثل Apollo).</p>
      <ul className="space-y-1">
        {items.map((f) => (
          <li key={f.key} className="flex items-center gap-2 rounded border border-dashed px-2 py-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> {f.label}
          </li>
        ))}
      </ul>
    </FilterSection>
  );
}

export function FiltersSidebar({ filters: f, onChange, counts, searches }: { filters: Filters; onChange: (next: Filters) => void; counts: Record<string, number>; searches: { id: string; label: string }[] }) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...f, [key]: value });
  const active = countActiveFilters(f);
  return (
    <div>
      <div className="flex items-center justify-between pb-2">
        <span className="text-sm font-semibold">الفلاتر{active > 0 && <Badge className="mr-2 h-5 px-1.5 text-[11px]">{active} مفعّل</Badge>}</span>
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...f, q: "", name: { include: [], exclude: [] }, country: { include: [], exclude: [] }, city: { include: [], exclude: [] }, keywords: { include: [], exclude: [] }, tech: { include: [], exclude: [] }, status: { include: [], exclude: [] }, lang: [], minRating: 0, ratingsMin: null, ratingsMax: null, hasPhone: false, mobileOnly: false, hasWebsite: false, hasEmail: false, hasSocial: false, operatingOnly: false, excludeContacted: false, excludeInCrm: false, searchId: "" })}>
            مسح الكل
          </Button>
        )}
      </div>
      <FilterSection title="بحث سريع" count={f.q.trim() ? 1 : 0} defaultOpen>
        <div className="relative">
          <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pr-8" placeholder="اسم، عنوان، رقم" value={f.q} maxLength={80} onChange={(e) => set("q", e.target.value)} />
        </div>
      </FilterSection>
      <FilterSection title="الشركة (الاسم أو الدومين)" count={incExcCount(f.name)}>
        <TagField value={f.name} onChange={(v) => set("name", v)} placeholder="مثال: clinic.com" />
      </FilterSection>
      <FilterSection title="موقع الشركة (Location)" count={incExcCount(f.country) + incExcCount(f.city)}>
        <p className="text-xs text-muted-foreground">الدولة</p>
        <OptionList options={COUNTRY_OPTIONS} value={f.country} onChange={(v) => set("country", v)} />
        <p className="pt-1 text-xs text-muted-foreground">المدينة (بالعربية أو الإنجليزية)</p>
        <TagField value={f.city} onChange={(v) => set("city", v)} placeholder="مثال: Riyadh أو الرياض" />
      </FilterSection>
      <FilterSection title="النشاط والكلمات (Industry & Keywords)" count={incExcCount(f.keywords)}>
        <TagField value={f.keywords} onChange={(v) => set("keywords", v)} placeholder="مثال: dental" />
        <p className="text-xs text-muted-foreground">تُبحث الكلمات في الاسم والتصنيف والعنوان.</p>
      </FilterSection>
      <FilterSection title="التقنيات (Technologies)" count={incExcCount(f.tech)}>
        <OptionList options={TECHNOLOGIES} value={f.tech} onChange={(v) => set("tech", v)} />
        <p className="text-xs text-muted-foreground">تُكتشف من موقع الجهة بعد «إثراء من المواقع».</p>
      </FilterSection>
      <FilterSection title="لغة الموقع" count={f.lang.length}>
        {LANGUAGES.map((l) => (
          <Flag key={l.key} label={l.label} checked={f.lang.includes(l.key)} onChange={(on) => set("lang", on ? [...f.lang, l.key] : f.lang.filter((x) => x !== l.key))} />
        ))}
      </FilterSection>
      <FilterSection title="بيانات التواصل" count={[f.hasPhone, f.mobileOnly, f.hasWebsite, f.hasEmail, f.hasSocial].filter(Boolean).length} defaultOpen>
        <Flag label="لديه رقم هاتف" checked={f.hasPhone} onChange={(v) => set("hasPhone", v)} />
        <Flag label="رقم جوال محتمل (واتساب)" checked={f.mobileOnly} onChange={(v) => set("mobileOnly", v)} />
        <Flag label="لديه موقع إلكتروني" checked={f.hasWebsite} onChange={(v) => set("hasWebsite", v)} />
        <Flag label="لديه إيميل" checked={f.hasEmail} onChange={(v) => set("hasEmail", v)} />
        <Flag label="لديه حسابات تواصل" checked={f.hasSocial} onChange={(v) => set("hasSocial", v)} />
      </FilterSection>
      <FilterSection title="التقييم والسمعة" count={Number(f.minRating > 0) + Number(f.ratingsMin != null || f.ratingsMax != null) + Number(f.operatingOnly)}>
        <select className={selectClass} aria-label="أقل تقييم" value={f.minRating} onChange={(e) => set("minRating", Number(e.target.value))}>
          <option value={0}>أقل تقييم: الكل</option>
          {[3, 3.5, 4, 4.5].map((v) => (
            <option key={v} value={v}>{v}+</option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <Input type="number" min={0} className="h-8 text-xs" placeholder="عدد التقييمات من" value={f.ratingsMin ?? ""} onChange={(e) => set("ratingsMin", numberOrNull(e.target.value))} />
          <Input type="number" min={0} className="h-8 text-xs" placeholder="إلى" value={f.ratingsMax ?? ""} onChange={(e) => set("ratingsMax", numberOrNull(e.target.value))} />
        </div>
        <Flag label="يعمل حالياً (غير مغلق)" checked={f.operatingOnly} onChange={(v) => set("operatingOnly", v)} />
      </FilterSection>
      <FilterSection title="الحالة (Stage)" count={incExcCount(f.status)}>
        <OptionList options={STATUS_OPTIONS} value={f.status} onChange={(v) => set("status", v)} counts={counts} searchable={false} />
      </FilterSection>
      <FilterSection title="عملية البحث (Lists)" count={f.searchId ? 1 : 0}>
        <select className={selectClass} value={f.searchId} onChange={(e) => set("searchId", e.target.value)}>
          <option value="">كل عمليات البحث</option>
          {searches.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </FilterSection>
      <FilterSection title="الاستثناءات (Exclusions)" count={Number(f.excludeContacted) + Number(f.excludeInCrm)}>
        <Flag label="استثناء من تم التواصل معهم سابقاً" checked={f.excludeContacted} onChange={(v) => set("excludeContacted", v)} />
        <Flag label="استثناء الموجودين في CRM" checked={f.excludeInCrm} onChange={(v) => set("excludeInCrm", v)} />
      </FilterSection>
      <LockedFilters groups={["company", "signals"]} />
    </div>
  );
}
