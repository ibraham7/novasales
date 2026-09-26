import { cn } from "@/lib/utils";
import { STAGE_LABEL_AR } from "@/modules/crm";

const STAGE_BG: Record<string, string> = {
  new: "bg-[var(--color-stage-lead)]",
  contacted: "bg-[var(--color-stage-lead)]",
  qualified: "bg-[var(--color-stage-qualified)]",
  negotiation: "bg-[var(--color-stage-negotiation)]",
  won: "bg-[var(--color-stage-won)]",
  lost: "bg-[var(--color-stage-lost)]",
};

export function StageDot({ stage, className }: { stage: string; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full shrink-0", STAGE_BG[stage] ?? "bg-muted-foreground", className)}
      aria-label={STAGE_LABEL_AR[stage] ?? stage}
    />
  );
}

export function StageBadge({ stage, className }: { stage: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium text-white",
        STAGE_BG[stage] ?? "bg-muted",
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {STAGE_LABEL_AR[stage] ?? stage}
    </span>
  );
}
