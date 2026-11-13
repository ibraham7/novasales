import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Filter, Globe, Inbox, Loader2, PanelRightClose, PanelRightOpen, Sparkles, Star, Trash2, UserPlus, X } from "lucide-react";
import { deleteMarketingProspects, deleteSavedSearchFn, enrichMarketingProspects, listMarketingProspects, listMarketingSearches, listSavedSearches, promoteMarketingProspects, saveSearchFn, updateMarketingProspects } from "@/modules/marketing/marketing.functions";
import { EMPTY_FILTERS, countActiveFilters, decodeFilters, encodeFilters, filterChips, type Filters } from "@/modules/marketing/filters";
import { PROSPECT_STATUS_LABELS, type ManualStatus } from "@/modules/marketing/statuses";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FiltersSidebar } from "./filters-sidebar";
import { PresetsMenu } from "./presets-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProspectSheet, type ProspectRow } from "./prospect-sheet";
import { StatusBadge } from "./status-badge";

const PAGE_SIZE = 25;

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
  const promoteFn = useServerFn(promoteMarketingProspects);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debounced, setDebounced] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<ProspectRow | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const saveFn = useServerFn(saveSearchFn);
  const savedFn = useServerFn(listSavedSearches);
  const removeSavedFn = useServerFn(deleteSavedSearchFn);

  // A shared link opens with its filters (the «f» parameter).
  useEffect(() => {
    const fromUrl = decodeFilters(new URLSearchParams(window.location.search).get("f"));
    setFilters(fromUrl);
    setDebounced(fromUrl);
    setReady(true);
  }, []);
  // Text typing waits a moment; everything else applies at once through the same timer.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(filters), 250);
    return () => clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const encoded = encodeFilters(filters);
    if (encoded) url.searchParams.set("f", encoded);
    else url.searchParams.delete("f");
    window.history.replaceState(null, "", url);
  }, [filters, ready]);
  // A search that just finished is shown first.
  useEffect(() => {
    if (focusSearchId) setFilters((f) => ({ ...EMPTY_FILTERS, searchId: focusSearchId, sort: f.sort }));
  }, [focusSearchId]);
  const debouncedKey = JSON.stringify(debounced);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debouncedKey]);

  const query = useMemo(() => ({ filters: debounced, page, pageSize: PAGE_SIZE }), [debounced, page]);
  const list = useQuery({ queryKey: ["marketing-prospects", query], queryFn: () => listFn({ data: query }), placeholderData: keepPreviousData, enabled: ready });
  const searches = useQuery({ queryKey: ["marketing-searches"], queryFn: () => searchesFn(), staleTime: 60_000 });

  const rows = (list.data?.rows ?? []) as ProspectRow[];
  const total = list.data?.total ?? 0;
  const counts = (list.data?.counts ?? {}) as Record<string, number>;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const activeFilters = countActiveFilters(filters);
  const chips = filterChips(filters);
  const saved = useQuery({ queryKey: ["marketing-saved-searches"], queryFn: () => savedFn(), staleTime: 60_000 });
  const saveSearch = useMutation({
    mutationFn: (name: string) => saveFn({ data: { name, filters } }),
    onSuccess: () => {
      toast.success("حُفظ البحث");
      qc.invalidateQueries({ queryKey: ["marketing-saved-searches"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeSaved = useMutation({
    mutationFn: (id: string) => removeSavedFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing-saved-searches"] }),
    onError: (error: Error) => toast.error(error.message),
  });
  const searchOptions = (searches.data ?? []).map((x: any) => ({ id: x.id as string, label: `${[x.params?.what, x.params?.city].filter(Boolean).join(" - ")} (${x.results_count})` }));
  const sidebar = <FiltersSidebar filters={filters} onChange={setFilters} counts={counts} searches={searchOptions} />;

  const bulk = useMutation({
    mutationFn: (status: ManualStatus) => updateFn({ data: { ids: [...selected], status } }),
    onSuccess: (r, status) => {
      if (r.changed) toast.success(`تم تحديث ${r.changed} جهة إلى «${PROSPECT_STATUS_LABELS[status]}»`);
      if (r.stopped) toast.error(`${r.stopped} جهة ألغت اشتراكها ورقمها بقائمة «لا ترسل»؛ احذف الرقم من تبويب «لا ترسل» أولاً لتتمكن من اعتمادها`);
      else if (!r.changed) toast.error("لم تتغير أي جهة: حالتها الحالية لا تسمح بالتغيير اليدوي");
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const promote = useMutation({
    mutationFn: () => promoteFn({ data: { ids: [...selected].slice(0, 50) } }),
    onSuccess: (r) => {
      const done = r.promoted + r.linked;
      const skipped = [r.already && `${r.already} منقولة سابقاً`, r.blocked && `${r.blocked} ألغت الاشتراك`, r.noPhone && `${r.noPhone} بلا رقم`, r.notReady && `${r.notReady} لم تعتمد بعد`].filter(Boolean).join(" · ");
      if (done) toast.success(`نُقلت ${done} جهة إلى العملاء المحتملين${r.linked ? ` (${r.linked} كانت موجودة بالـCRM وارتبطت بها)` : ""}${skipped ? ` · ${skipped}` : ""}`);
      else toast.error(skipped || "لم تُنقل أي جهة");
      if (r.failed.length) toast.error(`تعذّر نقل ${r.failed.length}: ${r.failed[0]!.error}`);
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

  return (
    <div className={sidebarOpen ? "grid gap-4 lg:grid-cols-[17rem_1fr]" : "grid gap-4"}>
      {sidebarOpen && <Card className="hidden h-fit max-h-[80vh] overflow-y-auto p-4 lg:block">{sidebar}</Card>}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="ml-1 h-4 w-4" /> الفلاتر{activeFilters > 0 && ` (${activeFilters})`}
          </Button>
          <Button variant="outline" size="sm" className="hidden lg:inline-flex" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <PanelRightClose className="ml-1 h-4 w-4" /> : <PanelRightOpen className="ml-1 h-4 w-4" />}
            {sidebarOpen ? "إخفاء الفلاتر" : `الفلاتر${activeFilters > 0 ? ` (${activeFilters})` : ""}`}
          </Button>
          <p className="text-sm text-muted-foreground">
            {list.isFetching && !list.isPending ? <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin" /> : null}
            {total} جهة
          </p>
          <div className="mr-auto flex items-center gap-2">
            <Label htmlFor="mk-sort" className="text-xs text-muted-foreground">
              الترتيب
            </Label>
            <select id="mk-sort" className="rounded-md border bg-background p-1.5 text-sm" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as Filters["sort"] })}>
              <option value="recent">الأحدث</option>
              <option value="rating">الأعلى تقييماً</option>
              <option value="name">الاسم</option>
            </select>
          </div>
        </div>
        {showFilters && <Card className="max-h-[70vh] overflow-y-auto p-4 lg:hidden">{sidebar}</Card>}

        <PresetsMenu
          current={filters}
          active={activeFilters > 0}
          saved={(saved.data ?? []) as { id: string; name: string; filters: Filters }[]}
          onApply={(f) => setFilters(f)}
          onSave={(name) => saveSearch.mutate(name)}
          onDelete={(id) => removeSaved.mutate(id)}
          saving={saveSearch.isPending}
        />

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c.id}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${c.tone === "include" ? "border-emerald-500/40 bg-emerald-500/10" : c.tone === "exclude" ? "border-red-500/40 bg-red-500/10" : "bg-muted"}`}
              >
                {c.label}
                <button type="button" aria-label={`إزالة ${c.label}`} onClick={() => setFilters(c.remove(filters))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })}>
              مسح الكل
            </Button>
          </div>
        )}

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
            <Button size="sm" variant="outline" disabled={promote.isPending} onClick={() => promote.mutate()}>
              {promote.isPending ? <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="ml-1 h-3.5 w-3.5" />}
              نقل إلى العملاء المحتملين
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
              <p className="text-sm">{activeFilters ? "لا توجد جهات تطابق الفلاتر." : "لا توجد جهات بعد. ابدأ ببحث جديد من الأعلى."}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-start [&:has([role=checkbox])]:pr-3">
                    <Checkbox
                      aria-label="تحديد كل الصفحة"
                      checked={allOnPage}
                      onCheckedChange={(v) => setSelected(v === true ? new Set([...selected, ...rows.map((r) => r.id)]) : new Set([...selected].filter((id) => !rows.some((r) => r.id === id))))}
                    />
                  </TableHead>
                  <TableHead className="text-start">الجهة</TableHead>
                  <TableHead className="w-44 text-start">الهاتف</TableHead>
                  <TableHead className="hidden w-28 text-start md:table-cell">الموقع</TableHead>
                  <TableHead className="hidden w-28 text-start sm:table-cell">التقييم</TableHead>
                  <TableHead className="w-32 text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" data-state={selected.has(r.id) ? "selected" : undefined} onClick={() => setOpen(r)}>
                    <TableCell className="[&:has([role=checkbox])]:pr-3" onClick={(e) => e.stopPropagation()}>
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
                    <TableCell className="max-w-[16rem] text-start">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{[r.category, r.address].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell>
                      {r.phone_raw ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <span dir="ltr" className="whitespace-nowrap text-sm tabular-nums">
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
