import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSpreadsheet, Search, Users, X } from "lucide-react";
import { importCampaignAudience, searchCampaignContacts } from "@/modules/campaigns";
import { audienceFromRows, parseCsv, readAudienceFile, type AudienceFileResult } from "@/modules/campaigns/audience-file";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type AudienceChoice = {
  mode: "file" | "contacts" | "stage";
  /** Contacts from the imported file, or the contacts chosen from the system. */
  contactIds: string[];
  lifecycle: string;
};

const MODES: [AudienceChoice["mode"], string][] = [
  ["file", "ملف Excel / أرقام"],
  ["contacts", "جهات الاتصال"],
  ["stage", "حسب المرحلة"],
];

/** Who receives the campaign: numbers from an Excel/CSV file or pasted, chosen contacts, or a stage. */
export function CampaignAudiencePicker({ value, onChange }: { value: AudienceChoice; onChange: (value: AudienceChoice) => void }) {
  return (
    <div className="space-y-3">
      <Label>المستلمون</Label>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="مصدر المستلمين">
        {MODES.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value.mode === mode}
            className={`rounded-lg border p-2 text-sm font-medium transition-colors ${value.mode === mode ? "border-primary bg-primary/5 text-primary" : "hover:bg-accent"}`}
            onClick={() => onChange({ ...value, mode, contactIds: [] })}
          >
            {label}
          </button>
        ))}
      </div>
      {value.mode === "file" && <FileAudience onReady={(contactIds) => onChange({ ...value, contactIds })} />}
      {value.mode === "contacts" && <ContactsAudience selected={value.contactIds} onChange={(contactIds) => onChange({ ...value, contactIds })} />}
      {value.mode === "stage" && (
        <select
          aria-label="مرحلة العميل"
          className="w-full rounded-md border bg-background p-2 text-sm"
          value={value.lifecycle}
          onChange={(e) => onChange({ ...value, lifecycle: e.target.value })}
        >
          <option value="lead">Lead</option>
          <option value="qualified">مؤهل</option>
          <option value="customer">عميل</option>
        </select>
      )}
    </div>
  );
}

function FileAudience({ onReady }: { onReady: (contactIds: string[]) => void }) {
  const importFn = useServerFn(importCampaignAudience);
  const [table, setTable] = useState<string[][] | null>(null);
  const [source, setSource] = useState("");
  const [pasted, setPasted] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [imported, setImported] = useState<{ count: number; created: number } | null>(null);
  const result: AudienceFileResult | null = table ? audienceFromRows(table, countryCode) : null;

  const load = (rows: string[][], name: string) => {
    setTable(rows);
    setSource(name);
    setImported(null);
    onReady([]);
  };
  const importMut = useMutation({
    mutationFn: () => importFn({ data: { rows: result!.rows } }),
    onSuccess: (r) => {
      setImported({ count: r.contactIds.length, created: r.created });
      onReady(r.contactIds);
      toast.success(`تم اعتماد ${r.contactIds.length} رقم`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          <FileSpreadsheet className="h-4 w-4" />
          اختيار ملف Excel أو CSV
          <input
            type="file"
            accept=".xlsx,.csv,.txt"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                load(await readAudienceFile(file), file.name);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "تعذر قراءة الملف");
              }
            }}
          />
        </label>
        {source && <span className="text-xs text-muted-foreground">{source}</span>}
      </div>
      <Textarea
        rows={3}
        dir="ltr"
        placeholder={"أو الصق الأرقام هنا، رقم في كل سطر\n966501234567"}
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        onBlur={() => pasted.trim() && load(parseCsv(pasted), "أرقام ملصقة")}
      />
      <div className="flex items-center gap-2">
        <Label htmlFor="country-code" className="shrink-0 text-xs">
          رمز الدولة للأرقام التي تبدأ بـ 0
        </Label>
        <Input
          id="country-code"
          dir="ltr"
          className="h-8 w-24"
          inputMode="numeric"
          placeholder="966"
          value={countryCode}
          onChange={(e) => {
            setCountryCode(e.target.value.replace(/\D/g, "").slice(0, 4));
            setImported(null);
            onReady([]);
          }}
        />
      </div>
      {result && (
        <div className="space-y-2 text-sm">
          <p>
            <b>{result.rows.length}</b> رقم صالح
            {result.duplicates > 0 && <> · {result.duplicates} مكرر حُذف</>}
            {result.invalid.length > 0 && <> · {result.invalid.length} غير صالح</>}
          </p>
          {result.invalid.length > 0 && (
            <p className="text-xs text-destructive" dir="ltr">
              {result.invalid.slice(0, 5).join("، ")}
              {result.invalid.length > 5 && " …"}
            </p>
          )}
          {result.rows.length > 0 && (
            <p className="text-xs text-muted-foreground" dir="ltr">
              {result.rows
                .slice(0, 3)
                .map((r) => (r.name ? `${r.name} (${r.phone})` : r.phone))
                .join("، ")}
              {result.rows.length > 3 && " …"}
            </p>
          )}
          {imported ? (
            <p className="text-primary">
              تم اعتماد {imported.count} رقم{imported.created > 0 && ` (منها ${imported.created} جهة اتصال جديدة)`}
            </p>
          ) : (
            <Button type="button" size="sm" disabled={!result.rows.length || importMut.isPending} onClick={() => importMut.mutate()}>
              {importMut.isPending ? "جارٍ الاعتماد..." : `اعتماد ${result.rows.length} رقم`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ContactsAudience({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const searchFn = useServerFn(searchCampaignContacts);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  // The results close after a choice and open again when searching.
  const [open, setOpen] = useState(selected.length === 0);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const q = useQuery({ queryKey: ["campaign-contacts", term], queryFn: () => searchFn({ data: { search: term } }) });
  const results = q.data ?? [];
  const reachable = results.filter((c) => !c.unknown);
  const toggle = (c: { id: string; name: string | null; phone: string | null }) => {
    setNames((old) => ({ ...old, [c.id]: c.name || c.phone || "" }));
    const adding = !selected.includes(c.id);
    onChange(adding ? [...selected, c.id] : selected.filter((id) => id !== c.id));
    if (adding) setOpen(false);
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="relative">
        <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pr-8"
          placeholder="ابحث بالاسم أو الرقم"
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium">
            <Users className="ml-1 inline h-3.5 w-3.5" />
            {selected.length} محدد
          </span>
          {selected.slice(0, 12).map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {names[id] || "جهة اتصال"}
              <button type="button" aria-label="إزالة" onClick={() => onChange(selected.filter((x) => x !== id))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selected.length > 12 && <span className="text-xs text-muted-foreground">+{selected.length - 12}</span>}
        </div>
      )}
      {open ? (
        <>
          <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {q.isLoading && <p className="p-3 text-xs text-muted-foreground">جارٍ البحث...</p>}
            {q.isError && <p className="p-3 text-xs text-destructive">تعذر تحميل جهات الاتصال</p>}
            {!q.isLoading && !results.length && <p className="p-3 text-xs text-muted-foreground">لا توجد نتائج</p>}
            {results.map((c) => (
              <label
                key={c.id}
                className={`flex items-center gap-2 p-2 text-sm ${c.unknown ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-accent"}`}
                title={c.unknown ? "واتساب لا يعرض رقم هذا الشخص؛ لا يمكن إرسال حملة له" : undefined}
              >
                <input type="checkbox" disabled={c.unknown} checked={selected.includes(c.id)} onChange={() => toggle(c)} />
                <span className="flex-1 truncate">{c.name || "بدون اسم"}</span>
                <span className="text-xs text-muted-foreground" dir={c.unknown ? undefined : "ltr"}>
                  {c.unknown ? "رقم غير معروف" : c.phone}
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {reachable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setNames((old) => ({ ...old, ...Object.fromEntries(reachable.map((c) => [c.id, c.name || c.phone || ""])) }));
                  onChange([...new Set([...selected, ...reachable.map((c) => c.id)])]);
                  setOpen(false);
                }}
              >
                تحديد كل النتائج ({reachable.length})
              </Button>
            )}
            {selected.length > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                إخفاء القائمة
              </Button>
            )}
          </div>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          إضافة جهات اتصال أخرى
        </Button>
      )}
    </div>
  );
}
