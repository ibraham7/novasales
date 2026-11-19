import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LabelPicker, type TicketLabel } from "@/components/crm/ticket-labels";
import { getTicketQuickEdit, saveTicketQuickEdit, listOppNotes } from "@/modules/crm";
import { parseAmount } from "@/modules/crm/board-money";
import { TicketValueField } from "@/components/crm/ticket-value-field";

/** The window that opens from the customer's circle on a board card: the same fields as «new ticket», for editing. */
export function TicketEditDialog({ oppId, title, defaultCurrency, labels, onCreateLabel, creatingLabel, onClose }: {
  oppId: string;
  title: string;
  /** Shown next to the value when the ticket has no currency yet. */
  defaultCurrency: string;
  labels: TicketLabel[];
  onCreateLabel: (input: { name: string; color: string }) => Promise<TicketLabel | void>;
  creatingLabel?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getTicketQuickEdit);
  const saveFn = useServerFn(saveTicketQuickEdit);
  const notesFn = useServerFn(listOppNotes);
  const detailQ = useQuery({ queryKey: ["ticket-quick-edit", oppId], queryFn: () => getFn({ data: { opportunityId: oppId } }), staleTime: 0, gcTime: 0 });
  const notesQ = useQuery({ queryKey: ["opp-notes", oppId], queryFn: () => notesFn({ data: { opportunityId: oppId } }) });
  const [form, setForm] = useState({ name: "", phone: "", value: "", currency: "", labelIds: [] as string[], note: "" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (detailQ.data && !loaded) {
      setForm({ name: detailQ.data.name, phone: detailQ.data.phone, value: detailQ.data.value > 0 ? String(detailQ.data.value) : "", currency: detailQ.data.currency || defaultCurrency, labelIds: detailQ.data.labelIds, note: "" });
      setLoaded(true);
    }
  }, [detailQ.data, loaded]);

  const amount = parseAmount(form.value);
  const initialAmount = detailQ.data?.value ?? 0;
  const ready = loaded && !!form.name.trim() && (!form.phone.trim() || form.phone.replace(/\D/g, "").length >= 5) && amount !== null;
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          opportunityId: oppId,
          name: form.name,
          // Only a number the user actually changed is sent, so an automatic ticket's WhatsApp id is never rewritten.
          ...(form.phone.trim() && form.phone.trim() !== (detailQ.data?.phone ?? "") ? { phone: form.phone } : {}),
          // Only a changed amount is sent (clearing the box sets it to 0).
          ...(amount !== null && amount !== initialAmount ? { value: amount } : {}),
          ...(form.currency && form.currency !== (detailQ.data?.currency || defaultCurrency) ? { currency: form.currency } : {}),
          labelIds: form.labelIds,
          ...(form.note.trim() ? { note: form.note } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("تم حفظ التعديلات");
      qc.invalidateQueries({ queryKey: ["pipeline-board"] });
      qc.invalidateQueries({ queryKey: ["opp-notes", oppId] });
      qc.invalidateQueries({ queryKey: ["opp-workspace", oppId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title || "تعديل التذكرة"}</DialogTitle></DialogHeader>
        {detailQ.isError ? (
          <p className="text-sm text-destructive">{(detailQ.error as Error).message}</p>
        ) : !loaded ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />)}</div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready && !save.isPending) save.mutate(); }}>
            <Input aria-label="اسم العميل" placeholder="اسم العميل" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Input aria-label="رقم الواتساب" placeholder="رقم الواتساب مع رمز الدولة (اختياري)" dir="ltr" className="text-right" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <TicketValueField currency={form.currency || defaultCurrency} onCurrency={(currency) => setForm((f) => ({ ...f, currency }))} amount={form.value} onAmount={(value) => setForm((f) => ({ ...f, value }))} invalid={amount === null} />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">الليبلز</Label>
              <LabelPicker labels={labels} value={form.labelIds} onChange={(labelIds) => setForm((f) => ({ ...f, labelIds }))} onCreate={onCreateLabel} creating={creatingLabel} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-ticket-note" className="text-xs text-muted-foreground">ملاحظات</Label>
              {(notesQ.data ?? []).length > 0 && (
                <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-md border bg-muted/40 p-2">
                  {(notesQ.data ?? []).map((n: any) => (
                    <div key={n.id} className="text-sm">
                      <div className="whitespace-pre-wrap">{n.body}</div>
                      <div className="text-[10px] text-muted-foreground">{[n.author_name, new Date(n.created_at).toLocaleDateString("ar", { day: "numeric", month: "short" })].filter(Boolean).join(" · ")}</div>
                    </div>
                  ))}
                </div>
              )}
              <Textarea id="edit-ticket-note" aria-label="ملاحظة جديدة" rows={6} className="min-h-32 resize-y" placeholder="أضف ملاحظة جديدة عن العميل أو المحادثة..." value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            <Button type="submit" className="w-full" disabled={!ready || save.isPending}>{save.isPending ? "جارٍ الحفظ..." : "حفظ"}</Button>
            <Link to="/pipeline/$oppId" params={{ oppId }} className="block text-center text-xs text-primary hover:underline" onClick={onClose}>فتح صفحة التذكرة الكاملة</Link>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
