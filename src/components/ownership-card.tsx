import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { ArrowLeftRight, UserMinus, History, User as UserIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  transferLead,
  reassignLead,
  unassignLead,
  listAssignmentHistory,
  listAvailabilities,
} from "@/modules/assignments";
import { listMembers } from "@/modules/organization";
import { listAssignmentEligibility } from "@/modules/assignments";
import { BLOCK_MSG, stateLabel } from "@/lib/eligibility-ui";
import { AvailabilityBadge } from "./availability-widget";


interface Props {
  leadId: string;
  currentOwnerId: string | null;
  departmentId: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  assign: "تعيين",
  transfer: "نقل",
  reassign: "إعادة تعيين",
  unassign: "إلغاء تعيين",
};

export function OwnershipCard({ leadId, currentOwnerId, departmentId }: Props) {
  const qc = useQueryClient();
  const [openDialog, setOpenDialog] = useState<null | "transfer" | "reassign">(null);
  const [showHistory, setShowHistory] = useState(false);

  const listM = useServerFn(listMembers);
  const listAv = useServerFn(listAvailabilities);
  const membersQ = useQuery({ queryKey: ["members-all"], queryFn: () => listM({ data: {} }) });

  const userIds = (membersQ.data ?? []).map((m: any) => m.user_id).filter(Boolean) as string[];
  const availQ = useQuery({
    queryKey: ["availabilities", userIds.join(",")],
    enabled: userIds.length > 0,
    queryFn: () => listAv({ data: { userIds } }),
  });
  const availMap = new Map((availQ.data ?? []).map((a: any) => [a.user_id, a.status]));

  const currentOwner = (membersQ.data ?? []).find((m: any) => m.user_id === currentOwnerId);

  const unassignFn = useServerFn(unassignLead);
  const unassignMut = useMutation({
    mutationFn: () => unassignFn({ data: { leadId, reason: "manual unassign" } }),
    onSuccess: () => {
      toast.success("تم إلغاء التعيين");
      qc.invalidateQueries({ queryKey: ["opp"] });
      qc.invalidateQueries({ queryKey: ["assignment-history", leadId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <UserIcon className="h-4 w-4" /> المالك الحالي
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)}>
          <History className="h-4 w-4 ml-1" /> السجل
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {currentOwnerId ? (
            <>
              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                {(currentOwner?.display_name ?? "?").charAt(0)}
              </div>
              <div>
                <div className="text-sm font-medium">{currentOwner?.display_name ?? "مندوب"}</div>
                <AvailabilityBadge status={availMap.get(currentOwnerId) as string | undefined} />
              </div>
            </>
          ) : (
            <Badge variant="destructive">غير معيّن</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {currentOwnerId && (
            <>
              <Button size="sm" variant="outline" onClick={() => setOpenDialog("transfer")}>
                <ArrowLeftRight className="h-4 w-4 ml-1" /> نقل
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpenDialog("reassign")}>
                إعادة تعيين
              </Button>
              <Button validate size="sm" variant="ghost" onClick={() => unassignMut.mutate()}>
                <UserMinus className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {showHistory && <HistoryList leadId={leadId} />}

      {openDialog && (
        <AssignActionDialog
          mode={openDialog}
          leadId={leadId}
          departmentId={departmentId}
          members={membersQ.data ?? []}
          availMap={availMap as any}
          onClose={() => setOpenDialog(null)}
        />
      )}
    </Card>
  );
}

function HistoryList({ leadId }: { leadId: string }) {
  const fn = useServerFn(listAssignmentHistory);
  const q = useQuery({
    queryKey: ["assignment-history", leadId],
    queryFn: () => fn({ data: { leadId } }),
  });
  const rows = q.data ?? [];
  if (!rows.length) return <div className="text-xs text-muted-foreground py-2">لا يوجد سجل بعد.</div>;
  return (
    <div className="border-t pt-3 space-y-2 text-xs">
      {rows.map((r: any) => (
        <div key={r.id} className="flex items-start gap-2">
          <Badge variant="outline" className="text-[10px]">{ACTION_LABEL[r.action] ?? r.action}</Badge>
          <div className="flex-1 min-w-0">
            <div>
              {r.from_user_name ? <><b>{r.from_user_name}</b> ← </> : null}
              <b>{r.to_user_name ?? "—"}</b>
              {r.assigned_by_name && <span className="text-muted-foreground"> بواسطة {r.assigned_by_name}</span>}
            </div>
            {r.reason && <div className="text-muted-foreground">{r.reason}</div>}
            <div className="text-muted-foreground">{new Date(r.assigned_at).toLocaleString("ar-EG")}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssignActionDialog({
  mode,
  leadId,
  departmentId,
  members,
  availMap,
  onClose,
}: {
  mode: "transfer" | "reassign";
  leadId: string;
  departmentId: string | null;
  members: any[];
  availMap: Map<string, string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const transferFn = useServerFn(transferLead);
  const reassignFn = useServerFn(reassignLead);
  const mut = useMutation({
    mutationFn: () => {
      if (mode === "transfer") return transferFn({ data: { leadId, toUserId, reason, sendWelcome: false } });
      return reassignFn({ data: { leadId, toUserId, reason } });
    },
    onSuccess: () => {
      toast.success("تم بنجاح");
      qc.invalidateQueries({ queryKey: ["opp"] });
      qc.invalidateQueries({ queryKey: ["assignment-history", leadId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const filtered = departmentId
    ? members.filter((m: any) => m.department_id === departmentId)
    : members;
  const eligFn = useServerFn(listAssignmentEligibility);
  const eligQ = useQuery({ queryKey: ["assign-eligibility"], queryFn: () => eligFn() });
  const eligMap = new Map((eligQ.data ?? []).map((e: any) => [e.account_id, e]));
  const elig = (id?: string | null) => (id ? ((eligMap.get(id) as any) ?? null) : null);
  const selected: any = filtered.find((m: any) => m.user_id === toUserId);
  const selectedBlocked = (() => {
    const e = elig(selected?.default_channel_account_id);
    return Boolean(e && !e.eligible);
  })();

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "transfer" ? "نقل للعميل" : "إعادة تعيين"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>المندوب الجديد</Label>
            <Select value={toUserId} onValueChange={setToUserId}>
              <SelectTrigger required aria-label="المندوب"><SelectValue placeholder="اختر مندوباً" /></SelectTrigger>
              <SelectContent>
                {filtered
                  .filter((m: any) => !m.is_supervisor && m.user_id)
                  .map((m: any) => {
                    const st = availMap.get(m.user_id) ?? "offline";
                    const e = elig(m.default_channel_account_id);
                    const blocked = Boolean(e && !e.eligible);
                    return (
                      <SelectItem key={m.id} value={m.user_id} disabled={blocked}>
                        <span className="flex items-center gap-2">
                          <span>{m.display_name}</span>
                          <AvailabilityBadge status={st} />
                          {blocked && <span className="text-[11px] text-amber-600">🟡 {stateLabel(e)}</span>}
                        </span>
                      </SelectItem>
                    );
                  })}
              </SelectContent>

            </Select>
          </div>
          <div>
            <Label>السبب</Label>
            <Textarea required aria-label="سبب النقل" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          {selectedBlocked && <p className="text-xs text-destructive">{BLOCK_MSG}</p>}
          <Button validate disabled={selectedBlocked || mut.isPending} onClick={() => mut.mutate()}>

            تأكيد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
