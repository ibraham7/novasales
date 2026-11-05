import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Filter, Globe, Inbox, Loader2, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { deleteMarketingProspects, enrichMarketingProspects, listMarketingProspects, listMarketingSearches, updateMarketingProspects } from "@/modules/marketing/marketing.functions";
import { PROSPECT_STATUS_LABELS, PROSPECT_STATUSES, type ManualStatus } from "@/modules/marketing/statuses";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProspectSheet, type ProspectRow } from "./prospect-sheet";
import { StatusBadge } from "./status-badge";

const selectClass = "w-full rounded-md border bg-background p-2 text-sm";
const PAGE_SIZE = 25;

type Filters = { q: string; statuses: string[]; hasPhone: boolean; mobileOnly: boolean; hasWebsite: boolean; minRating: number; searchId: string; sort: "recent" | "rating" | "name" };
const EMPTY: Filters = { q: "", statuses: [], hasPhone: false, mobileOnly: false, hasWebsite: false, minRating: 0, searchId: "", sort: "recent" };

const BULK: { status: ManualStatus; label: string; variant: "default" | "outline" }[] = [
  { status: "qualified", label: "مؤهل", variant: "outline" },
  { status: "approved", label: "اعتماد للتواصل", variant: "default" },
  { status: "review", label: "يحتاج مراجعة", variant: "outline" },
  { status: "excluded", label: "استبعاد", variant: "outline" },
];

/** The saved businesses: filters on one side, a table with checkboxes on the other, bulk actions on top. */
export function ProspectsPanel({ focusSearchId }: { focusSearchId: string | null }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMarketingProspects);
  const searchesFn = useServerFn(listMarketingSearches);
  const updateFn = useServerFn(updateMarketingProspects);
  const enrichFn = useServerFn(enrichMarketingProspects);
  const deleteFn = useServerFn(deleteMarketingProspects);

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<ProspectRow | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(timer);
  }, [filters.q]);
  // A search that just finished is shown first.
  useEffect(() => {
    if (focusSearchId) setFilters((f) => ({ ...EMPTY, searchId: focusSearchId, sort: f.sort }));
  }, [focusSearchId]);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debouncedQ, filters.statuses, filters.hasPhone, filters.mobileOnly, filters.hasWebsite, filters.minRating, filters.searchId, filters.sort]);

  const query = useMemo(
    () => ({
      q: debouncedQ || undefined,
      statuses: filters.statuses.length ? (filters.statuses as any) : undefined,
      hasPhone: filters.hasPhone || undefined,
      mobileOnly: filters.mobileOnly || undefined,
      hasWebsite: filters.hasWebsite || undefined,
      minRating: filters.minRating || undefined,
      searchId: filters.searchId || undefined,
      sort: filters.sort,
      page,
      pageSize: PAGE_SIZE,
    }),
    [debouncedQ, filters, page],
  );
  const list = useQuery({ queryKey: ["marketing-prospects", query], queryFn: () => listFn({ data: query }), placeholderData: keepPreviousData });
  const searches = useQuery({ queryKey: ["marketing-searches"], queryFn: () => searchesFn(), staleTime: 60_000 });

  const rows = (list.data?.rows ?? []) as ProspectRow[];
  const total = list.data?.total ?? 0;
  const counts = (list.data?.counts ?? {}) as Record<string, number>;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const toggleStatus = (s: string) => set("statuses", filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s]);
  const activeFilters = filters.statuses.length + Number(filters.hasPhone) + Number(filters.mobileOnly) + Number(filters.hasWebsite) + Number(filters.minRating > 0) + Number(!!filters.searchId);

  const bulk = useMutation({
    mutationFn: (status: ManualStatus) => updateFn({ data: { ids: [...selected], status } }),
    onSuccess: (r, status) => {
      toast.success(`تم تحديث ${r.changed} جهة إلى «${PROSPECT_STATUS_LABELS[status]}»`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { ids: [...selected] } }),
    onSuccess: (r) => {
      toast.success(`حُذفت ${r.deleted} جهة نهائياً`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const enrich = useMutation({
    mutationFn: () => enrichFn({ data: { ids: [...selected].slice(0, 25) } }),
    onSuccess: (r) => {
      toast.success(`قُرئ ${r.done} موقع: بريد عند ${r.withEmail}، حسابات عند ${r.withSocial}، واتساب عند ${r.withWhatsapp}${r.failed ? ` · تعذّر ${r.failed}` : ""}${r.noWebsite ? ` · بلا موقع ${r.noWebsite}` : ""}`);
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const filterBox = (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="mk-q">بحث في القائمة</Label>
        <div className="relative">
          <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input id="mk-q" className="pr-8" placeholder="اسم، عنوان، رقم" value={filters.q} onChange={(e) => set("q", e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">بيانات التواصل</p>
        {(
          [
            ["hasPhone", "لديه رقم هاتف"],
            ["mobileOnly", "رقم جوال محتمل (واتساب)"],
            ["hasWebsite", "لديه موقع إلكتروني"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <Checkbox checked={filters[key]} onCheckedChange={(v) => set(key, v === true)} />
            {label}
          </label>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor="mk-minr">أقل تقييم</Label>
        <select id="mk-minr" className={selectClass} value={filters.minRating} onChange={(e) => set("minRating", Number(e.target.value))}>
          <option value={0}>الكل</option>
          {[3, 3.5, 4, 4.5].map((v) => (
            <option key={v} value={v}>
              {v}+
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">الحالة</p>
        {PROSPECT_STATUSES.filter((s) => counts[s] || filters.statuses.includes(s)).map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm">
            <Checkbox checked={filters.statuses.includes(s)} onCheckedChange={() => toggleStatus(s)} />
            <span className="flex-1">{PROSPECT_STATUS_LABELS[s]}</span>
            <span className="text-xs text-muted-foreground">{counts[s] ?? 0}</span>
          </label>
        ))}
        {Object.keys(counts).length === 0 && <p className="text-xs text-muted-foreground">لا توجد جهات بعد.</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="mk-search">عملية البحث</Label>
        <select id="mk-search" className={selectClass} value={filters.searchId} onChange={(e) => set("searchId", e.target.value)}>
          <option value="">كل عمليات البحث</option>
          {(searches.data ?? []).map((s: any) => (
            <option key={s.id} value={s.id}>
              {[s.params?.what, s.params?.city].filter(Boolean).join(" - ")} ({s.results_count})
            </option>
          ))}
        </select>
      </div>
      {activeFilters > 0 || filters.q ? (
        <Button variant="ghost" size="sm" onClick={() => setFilters({ ...EMPTY, sort: filters.sort })}>
          مسح الفلاتر
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card className="hidden h-fit p-4 lg:block">{filterBox}</Card>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="ml-1 h-4 w-4" /> الفلاتر{activeFilters > 0 && ` (${activeFilters})`}
          </Button>
          <p className="text-sm text-muted-foreground">
            {list.isFetching && !list.isPending ? <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin" /> : null}
            {total} جهة
          </p>
          <div className="mr-auto flex items-center gap-2">
            <Label htmlFor="mk-sort" className="text-xs text-muted-foreground">
              الترتيب
            </Label>
            <select id="mk-sort" className="rounded-md border bg-background p-1.5 text-sm" value={filters.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])}>
              <option value="recent">الأحدث</option>
              <option value="rating">الأعلى تقييماً</option>
              <option value="name">الاسم</option>
            </select>
          </div>
        </div>
        {showFilters && <Card className="p-4 lg:hidden">{filterBox}</Card>}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            <span className="text-sm font-medium">تم تحديد {selected.size}</span>
            {BULK.map((b) => (
              <Button key={b.status} size="sm" variant={b.variant} disabled={bulk.isPending} onClick={() => bulk.mutate(b.status)}>
                {b.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" disabled={enrich.isPending} onClick={() => enrich.mutate()}>
              {enrich.isPending ? <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="ml-1 h-3.5 w-3.5" />}
              إثراء من المواقع{selected.size > 25 ? " (أول 25)" : ""}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`حذف ${selected.size} جهة نهائياً؟ لا يمكن التراجع. (أرقام «لا ترسل» تبقى محفوظة)`)) remove.mutate();
              }}
            >
              {remove.isPending ? <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="ml-1 h-3.5 w-3.5" />}
              حذف نهائي
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              إلغاء التحديد
            </Button>
            <p className="w-full text-xs text-muted-foreground">«اعتماد للتواصل» لا يرسل شيئاً؛ الإرسال يكون لاحقاً من حملة تعتمدها أنت.</p>
          </div>
        )}

        <Card className="overflow-hidden">
          {list.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <p className="p-6 text-sm text-destructive">{(list.error as Error).message}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <p className="text-sm">{activeFilters || filters.q ? "لا توجد جهات تطابق الفلاتر." : "لا توجد جهات بعد. ابدأ ببحث جديد من الأعلى."}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="تحديد كل الصفحة"
                      checked={allOnPage}
                      onCheckedChange={(v) => setSelected(v === true ? new Set([...selected, ...rows.map((r) => r.id)]) : new Set([...selected].filter((id) => !rows.some((r) => r.id === id))))}
                    />
                  </TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>الهاتف</TableHead>
                  <TableHead className="hidden md:table-cell">الموقع</TableHead>
                  <TableHead className="hidden sm:table-cell">التقييم</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" data-state={selected.has(r.id) ? "selected" : undefined} onClick={() => setOpen(r)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`تحديد ${r.name}`}
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) => setSelected((old) => {
                          const next = new Set(old);
                          if (v === true) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })}
                      />
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{[r.category, r.address].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell>
                      {r.phone_raw ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <span dir="ltr" className="whitespace-nowrap text-sm">
                            {r.phone_raw}
                          </span>
                          {r.phone_kind === "mobile" && <Badge variant="outline" className="text-[10px]">جوال</Badge>}
                          {r.phone_kind === "landline" && <Badge variant="outline" className="text-[10px] text-muted-foreground">ثابت</Badge>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.website ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <a href={r.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            <Globe className="h-3.5 w-3.5" /> فتح
                          </a>
                          {r.emails?.length ? <Badge variant="outline" className="text-[10px]">بريد</Badge> : null}
                          {r.site_whatsapp ? <Badge variant="outline" className="text-[10px]">واتساب</Badge> : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {r.rating != null ? (
                        <span className="inline-flex items-center gap-1 text-sm">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {Number(r.rating).toFixed(1)}
                          <span className="text-xs text-muted-foreground">({r.ratings_count ?? 0})</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-3 text-sm">
            <Button variant="outline" size="icon" aria-label="الصفحة التالية" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>
              صفحة {page} من {pages}
            </span>
            <Button variant="outline" size="icon" aria-label="الصفحة السابقة" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <ProspectSheet row={open} onClose={() => setOpen(null)} />
    </div>
  );
}
