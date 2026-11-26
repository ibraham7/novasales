import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Globe, Loader2, Mail, MapPin, MessageCircle, Phone, Sparkles, Star } from "lucide-react";
import { resolveMarketingSuggestion, enrichMarketingProspects, updateMarketingProspects } from "@/modules/marketing/marketing.functions";
import { MANUAL_STATUSES, PROSPECT_STATUS_LABELS } from "@/modules/marketing/statuses";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "./status-badge";

const selectClass = "w-full rounded-md border bg-background p-2 text-sm";

export type ProspectRow = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  phone_kind: "mobile" | "landline" | "unknown";
  website: string | null;
  maps_url: string | null;
  rating: number | null;
  ratings_count: number | null;
  status: string;
  notes: string | null;
  emails: string[] | null;
  socials: Record<string, string> | null;
  site_whatsapp: string | null;
  site_phones: string[] | null;
  discovered: { website?: { url: string; confidence: string }; socials?: Record<string, { url: string; confidence: string }> } | null;
  enrich_status: "done" | "failed" | "no_website" | null;
  enriched_at: string | null;
  enrich_error: string | null;
  created_at: string;
  expires_at: string;
};

const SOCIAL_LABELS: Record<string, string> = { instagram: "إنستغرام", facebook: "فيسبوك", tiktok: "تيك توك", linkedin: "لينكدإن", x: "X", youtube: "يوتيوب" };
const PHONE_KIND_LABEL = { mobile: "جوال محتمل", landline: "ثابت", unknown: "" } as const;

/** Details of one business, with its status and the team's notes. */
export function ProspectSheet({ row, onClose }: { row: ProspectRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateMarketingProspects);
  const enrichFn = useServerFn(enrichMarketingProspects);
  const [status, setStatus] = useState("new");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setStatus(row?.status ?? "new");
    setNotes(row?.notes ?? "");
  }, [row?.id, row?.status, row?.notes]);

  const save = useMutation({
    mutationFn: () => {
      const manual = (MANUAL_STATUSES as readonly string[]).includes(status);
      return updateFn({ data: { ids: [row!.id], ...(manual && status !== row!.status ? { status: status as any } : {}), notes } });
    },
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Suggested pages found by the web search: kept here while a person accepts or ignores each one.
  const resolveFn = useServerFn(resolveMarketingSuggestion);
  const [suggested, setSuggested] = useState<ProspectRow["discovered"]>(null);
  useEffect(() => setSuggested(row?.discovered ?? null), [row?.id]);
  const resolve = useMutation({
    mutationFn: (input: { kind: "website" | "social"; platform?: string; accept: boolean }) => resolveFn({ data: { id: row!.id, ...input } }),
    onSuccess: (_r, input) => {
      toast.success(input.accept ? "تم اعتماد الاقتراح" : "تم تجاهل الاقتراح");
      setSuggested((current) => {
        const next = { ...(current ?? {}) };
        if (input.kind === "website") delete next.website;
        else if (input.platform) next.socials = Object.fromEntries(Object.entries(next.socials ?? {}).filter(([k]) => k !== input.platform));
        return next;
      });
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const enrich = useMutation({
    mutationFn: () => enrichFn({ data: { ids: [row!.id] } }),
    onSuccess: (r) => {
      toast.success(r.failed ? "تعذّر قراءة الموقع" : r.withEmail || r.withSocial || r.withWhatsapp ? "تم العثور على بيانات تواصل" : "لم نجد بيانات تواصل منشورة في الموقع");
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const locked = row ? !(MANUAL_STATUSES as readonly string[]).includes(row.status) : false;

  return (
    <Sheet open={!!row} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-md" dir="rtl">
        {row && (
          <>
            <SheetHeader className="text-right">
              <SheetTitle>{row.name}</SheetTitle>
              <SheetDescription>{row.category || "نشاط تجاري"}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <StatusBadge status={row.status} />
                {row.rating != null && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {Number(row.rating).toFixed(1)} ({row.ratings_count ?? 0})
                  </span>
                )}
              </div>

              <dl className="space-y-3">
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{row.address || "لا يوجد عنوان"}</span>
                </div>
                <div className="flex gap-2">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {row.phone_raw ? (
                    <span dir="ltr" className="select-all">
                      {row.phone_raw} {PHONE_KIND_LABEL[row.phone_kind] && <span className="text-xs text-muted-foreground">· {PHONE_KIND_LABEL[row.phone_kind]}</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">لا يوجد رقم منشور</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {row.website ? (
                    <a href={row.website} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline" dir="ltr">
                      {row.website}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">لا يوجد موقع إلكتروني</span>
                  )}
                </div>
                {row.maps_url && (
                  <a href={row.maps_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> فتح في خرائط Google
                  </a>
                )}
              </dl>

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">بيانات من موقعهم</span>
                  {row.website && (
                    <Button size="sm" variant="outline" disabled={enrich.isPending} onClick={() => enrich.mutate()}>
                      {enrich.isPending ? <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="ml-1 h-3.5 w-3.5" />}
                      {row.enriched_at ? "تحديث" : "إثراء من الموقع"}
                    </Button>
                  )}
                </div>
                {!row.website && <p className="text-xs text-muted-foreground">{row.maps_url ? "لا يوجد موقع مسجّل لهذه الجهة في خرائط قوقل" : "لا يوجد موقع إلكتروني لهذه الجهة"}، فلا يوجد ما يُقرأ. غالباً لها صفحة على إنستغرام أو فيسبوك؛ ابحث عنها باسمها وأضفها يدوياً.</p>}
                {row.website && !row.enriched_at && <p className="text-xs text-muted-foreground">لم تُقرأ بيانات الموقع بعد.</p>}
                {row.enrich_status === "failed" && <p className="text-xs text-destructive">تعذّرت القراءة: {row.enrich_error}</p>}
                {row.enrich_status === "done" && !(row.emails?.length || row.site_whatsapp || row.site_phones?.length || Object.keys(row.socials ?? {}).length) && (
                  <p className="text-xs text-muted-foreground">قرأنا الموقع ولم نجد بريداً أو رقماً أو حسابات منشورة. قد يكون الموقع يعرض بياناته بسكربت لا نقرؤه.</p>
                )}
                {(row.site_phones ?? []).map((phone) => (
                  <div key={phone} className="flex items-center gap-2">
                    <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <a href={`tel:+${phone}`} dir="ltr" className="select-all text-primary hover:underline">+{phone}</a>
                    <span className="text-xs text-muted-foreground">رقم منشور في الموقع</span>
                  </div>
                ))}
                {(row.emails ?? []).map((e) => (
                  <div key={e} className="flex items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <a href={`mailto:${e}`} dir="ltr" className="break-all text-primary hover:underline">{e}</a>
                  </div>
                ))}
                {row.site_whatsapp && (
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span dir="ltr" className="select-all">{row.site_whatsapp}</span>
                    <span className="text-xs text-muted-foreground">واتساب منشور</span>
                  </div>
                )}
                {Object.entries(row.socials ?? {}).map(([k, url]) => (
                  <div key={k} className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{SOCIAL_LABELS[k] ?? k}</a>
                  </div>
                ))}
                {row.enriched_at && <p className="text-xs text-muted-foreground">آخر قراءة: {formatDateTime(row.enriched_at)}. بيانات منشورة علناً على موقع الجهة.</p>}
                {(suggested?.website || Object.keys(suggested?.socials ?? {}).length > 0) && (
                  <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/60 p-2.5">
                    <p className="text-xs font-medium text-sky-900">اقتراحات من البحث على الإنترنت</p>
                    <p className="text-xs text-muted-foreground">الاسم والمدينة يتطابقان لكن لا دليل قاطع. افتح الرابط وتأكد أنها نفس الجهة قبل الاعتماد.</p>
                    {suggested?.website && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <a href={suggested.website.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all text-primary hover:underline">{suggested.website.url}</a>
                        <span className="text-xs text-muted-foreground">موقع محتمل</span>
                        <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ kind: "website", accept: true })}>اعتماد</Button>
                        <Button size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => resolve.mutate({ kind: "website", accept: false })}>تجاهل</Button>
                      </div>
                    )}
                    {Object.entries(suggested?.socials ?? {}).map(([platform, s]) => (
                      <div key={platform} className="flex flex-wrap items-center gap-2">
                        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <a href={s.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all text-primary hover:underline">{SOCIAL_LABELS[platform] ?? platform}</a>
                        <span className="text-xs text-muted-foreground">محتمل</span>
                        <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ kind: "social", platform, accept: true })}>اعتماد</Button>
                        <Button size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => resolve.mutate({ kind: "social", platform, accept: false })}>تجاهل</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="ps-status">الحالة</Label>
                <select id="ps-status" className={selectClass} value={status} disabled={locked} onChange={(e) => setStatus(e.target.value)}>
                  {locked && <option value={row.status}>{PROSPECT_STATUS_LABELS[row.status as keyof typeof PROSPECT_STATUS_LABELS] ?? row.status}</option>}
                  {MANUAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROSPECT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                {locked && <p className="text-xs text-muted-foreground">هذه الجهة بدأت محادثة، فتتغير حالتها من النظام وليس يدوياً.</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ps-notes">ملاحظات الفريق</Label>
                <Textarea id="ps-notes" rows={4} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: المسؤول اسمه أحمد، يفضّل التواصل صباحاً" />
              </div>

              <p className="text-xs text-muted-foreground">
                {row.maps_url
                  ? <>اكتُشفت {formatDateTime(row.created_at)}. بيانات Google مخزَّنة مؤقتاً وتنتهي صلاحيتها في {formatDateTime(row.expires_at)}.</>
                  : <>أُضيفت يدوياً {formatDateTime(row.created_at)}.</>}
              </p>
              <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
                حفظ
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
