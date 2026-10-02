import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CircleDot } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { getMyAvailability, setMyAvailability } from "@/modules/assignments";

const STATUS_META: Record<string, { label: string; color: string }> = {
  available: { label: "متاح", color: "bg-emerald-500" },
  busy: { label: "مشغول", color: "bg-amber-500" },
  away: { label: "غائب", color: "bg-slate-400" },
  offline: { label: "غير متصل", color: "bg-red-500" },
};

export function AvailabilityBadge({ status }: { status?: string | null }) {
  const meta = STATUS_META[status ?? "offline"] ?? STATUS_META.offline;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${meta.color}`} />
      {meta.label}
    </span>
  );
}

export function AvailabilityWidget({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const getFn = useServerFn(getMyAvailability);
  const setFn = useServerFn(setMyAvailability);
  const q = useQuery({
    queryKey: ["my-availability"],
    queryFn: () => getFn(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const mut = useMutation({
    mutationFn: (status: string) => setFn({ data: { status: status as any } }),
    onSuccess: () => {
      toast.success("تم تحديث حالتك");
      qc.invalidateQueries({ queryKey: ["my-availability"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const current = (q.data?.status as string | undefined) ?? "available";
  const meta = STATUS_META[current] ?? STATUS_META.available;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={compact ? "w-full justify-start gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent" : "gap-2"}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${meta.color}`} />
          <span className="text-xs">{meta.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align={compact ? "start" : "end"} side={compact ? "top" : "bottom"} className="w-48 p-1" dir="rtl">
        {Object.entries(STATUS_META).map(([key, m]) => (
          <button
            key={key}
            onClick={() => mut.mutate(key)}
            className={`w-full text-right px-3 py-2 rounded flex items-center gap-2 text-sm hover:bg-accent ${
              key === current ? "bg-accent/60" : ""
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${m.color}`} />
            <span>{m.label}</span>
            {key === current && <CircleDot className="h-3.5 w-3.5 ml-auto text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
