import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ban, Loader2, Trash2 } from "lucide-react";
import { addSuppressionNumber, listSuppressions, removeSuppressionNumber } from "@/modules/marketing/outbound.functions";
import { MARKETING_COUNTRIES } from "@/modules/marketing/countries";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SOURCE_LABEL: Record<string, string> = { manual: "أُضيف يدوياً", keyword: "ردّ بكلمة إيقاف", import: "استيراد" };

/** Numbers that must never be messaged by any campaign. */
export function SuppressionsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSuppressions);
  const addFn = useServerFn(addSuppressionNumber);
  const removeFn = useServerFn(removeSuppressionNumber);
  const q = useQuery({ queryKey: ["marketing-suppressions"], queryFn: () => listFn() });
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("TR");
  const [reason, setReason] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["marketing-suppressions"] });

  const add = useMutation({
    mutationFn: () => addFn({ data: { phone, country: country as any, reason: reason || undefined } }),
    onSuccess: () => {
      toast.success("أُضيف الرقم إلى قائمة «لا ترسل»");
      setPhone("");
      setReason("");
      refresh();
      qc.invalidateQueries({ queryKey: ["marketing-prospects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("أُزيل الرقم من القائمة");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4 sm:p-5">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Ban className="h-4 w-4" /> قائمة «لا ترسل»
          </h3>
          <p className="text-xs text-muted-foreground">أي رقم هنا لا يصله شيء من أي حملة (Outbound أو غيرها). من يردّ بكلمة إيقاف يُضاف تلقائياً.</p>
        </div>
        <form
          className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="sp-phone">الرقم</Label>
            <Input id="sp-phone" dir="ltr" required placeholder="+905321234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-country">دولة الرقم</Label>
            <select id="sp-country" className="w-full rounded-md border bg-background p-2 text-sm" value={country} onChange={(e) => setCountry(e.target.value)}>
              {MARKETING_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-reason">السبب (اختياري)</Label>
            <Input id="sp-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={add.isPending || !phone.trim()}>
              {add.isPending && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
              إضافة
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-2 sm:p-3">
        {q.isPending ? (
          <p className="p-3 text-sm">جارٍ التحميل...</p>
        ) : q.isError ? (
          <p className="p-3 text-sm text-destructive">{(q.error as Error).message}</p>
        ) : q.data.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">القائمة فارغة.</p>
        ) : (
          q.data.map((row: any) => (
            <div key={row.id} className="flex flex-wrap items-center gap-2 border-b p-2.5 last:border-b-0">
              <span dir="ltr" className="font-medium">
                +{row.identifier}
              </span>
              <Badge variant="secondary">{SOURCE_LABEL[row.source] ?? row.source}</Badge>
              {row.reason && <span className="text-xs text-muted-foreground">{row.reason}</span>}
              <span className="mr-auto text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="إزالة الرقم"
                disabled={remove.isPending}
                onClick={async () => {
                  if (await askConfirm({ title: "إزالة الرقم من القائمة؟", description: "قد يصله شيء من الحملات القادمة. أزله فقط إذا طلب صاحبه ذلك.", confirmLabel: "إزالة", destructive: true })) remove.mutate(row.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
