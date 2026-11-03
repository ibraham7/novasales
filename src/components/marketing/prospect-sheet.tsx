import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Globe, Loader2, MapPin, Phone, Star } from "lucide-react";
import { updateMarketingProspects } from "@/modules/marketing/marketing.functions";
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
  created_at: string;
  expires_at: string;
};

const PHONE_KIND_LABEL = { mobile: "جوال محتمل", landline: "ثابت", unknown: "" } as const;

/** Details of one business, with its status and the team's notes. */
export function ProspectSheet({ row, onClose }: { row: ProspectRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateMarketingProspects);
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
                اكتُشفت {formatDateTime(row.created_at)}. بيانات Google مخزَّنة مؤقتاً وتنتهي صلاحيتها في {formatDateTime(row.expires_at)}.
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
