import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search, Forward, Check } from "lucide-react";

import { forwardMessageFn, listForwardTargets } from "@/modules/messaging";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type Target = { kind: "session" | "phone"; value: string; label: string };

/**
 * WhatsApp-like "forward to..." picker: suggests the latest chats first, then
 * the saved CRM contacts that have a WhatsApp number.
 */
export function ForwardDialog({
  open,
  onOpenChange,
  messageId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  messageId: string | null;
  onDone?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, Target>>({});

  const fetchTargets = useServerFn(listForwardTargets);
  const doForward = useServerFn(forwardMessageFn);

  const { data, isLoading } = useQuery({
    queryKey: ["forward-targets"],
    queryFn: () => fetchTargets(),
    enabled: open,
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const chats = (data?.chats ?? []).map((c: any) => ({
      key: `s:${c.id}`,
      target: { kind: "session" as const, value: c.id, label: c.name },
      name: c.name,
      phone: c.phone,
      avatar_url: c.avatar_url,
      group: "آخر الدردشات",
    }));
    const contacts = (data?.contacts ?? []).map((c: any) => ({
      key: `p:${c.phone}`,
      target: { kind: "phone" as const, value: c.phone, label: c.name },
      name: c.name,
      phone: c.phone,
      avatar_url: c.avatar_url,
      group: "جهات الاتصال",
    }));
    const all = [...chats, ...contacts];
    const s = search.trim().toLowerCase();
    if (!s) return all;
    return all.filter((r) => r.name?.toLowerCase().includes(s) || String(r.phone ?? "").includes(s));
  }, [data, search]);

  const chosen = Object.values(selected);

  const mut = useMutation({
    mutationFn: () =>
      doForward({
        data: {
          messageId: messageId!,
          targets: chosen.map((t) => ({ kind: t.kind, value: t.value })),
        },
      }),
    onSuccess: (res: any) => {
      if (res?.sent) toast.success(`تمت إعادة التوجيه إلى ${res.sent} محادثة`);
      if (res?.failed) toast.error(`فشل الإرسال إلى ${res.failed} محادثة`);
      setSelected({});
      setSearch("");
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل إعادة التوجيه"),
  });

  let lastGroup = "";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setSelected({}); onOpenChange(v); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Forward className="h-4 w-4" /> إعادة توجيه الرسالة
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن اسم أو رقم..."
            className="pr-8 h-9"
            autoFocus
          />
        </div>

        <div className="max-h-80 overflow-y-auto -mx-2 px-2 space-y-0.5">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">جارٍ التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">لا توجد نتائج</div>
          ) : (
            rows.map((r) => {
              const showGroup = r.group !== lastGroup;
              lastGroup = r.group;
              const isSel = Boolean(selected[r.key]);
              return (
                <div key={r.key}>
                  {showGroup && (
                    <div className="text-[11px] font-semibold text-muted-foreground px-1 pt-2 pb-1">{r.group}</div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = { ...prev };
                        if (next[r.key]) delete next[r.key];
                        else next[r.key] = r.target;
                        return next;
                      })
                    }
                    className={cn(
                      "w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-right transition-colors",
                      isSel ? "bg-emerald-50 ring-1 ring-emerald-300" : "hover:bg-muted",
                    )}
                  >
                    <Avatar className="h-8 w-8">
                      {r.avatar_url && <AvatarImage src={r.avatar_url} />}
                      <AvatarFallback className="text-[11px]">{(r.name ?? "?").charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono" dir="ltr">
                        +{r.phone}
                      </div>
                    </div>
                    {isSel && <Check className="h-4 w-4 text-emerald-600" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground">
            {chosen.length ? `تم اختيار ${chosen.length}` : "اختر وجهة واحدة أو أكثر"}
          </span>
          <Button
            size="sm"
            disabled={!chosen.length || !messageId || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "جارٍ الإرسال..." : "إرسال"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
