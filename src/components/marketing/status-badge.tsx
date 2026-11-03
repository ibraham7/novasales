import { PROSPECT_STATUS_LABELS, type ProspectStatus } from "@/modules/marketing/statuses";
import { Badge } from "@/components/ui/badge";

const TONE: Record<ProspectStatus, string> = {
  new: "bg-blue-50 text-blue-700",
  review: "bg-amber-50 text-amber-700",
  qualified: "bg-emerald-50 text-emerald-700",
  excluded: "bg-slate-100 text-slate-600",
  approved: "bg-primary/10 text-primary",
  contacted: "bg-violet-50 text-violet-700",
  replied: "bg-cyan-50 text-cyan-700",
  interested: "bg-green-50 text-green-700",
  not_interested: "bg-rose-50 text-rose-700",
  converted: "bg-green-100 text-green-800",
  opted_out: "bg-red-50 text-red-700",
  invalid: "bg-slate-100 text-slate-500",
};

export function StatusBadge({ status }: { status: string }) {
  const known = status in PROSPECT_STATUS_LABELS;
  return (
    <Badge variant="secondary" className={`whitespace-nowrap font-medium ${known ? TONE[status as ProspectStatus] : ""}`}>
      {known ? PROSPECT_STATUS_LABELS[status as ProspectStatus] : status}
    </Badge>
  );
}
