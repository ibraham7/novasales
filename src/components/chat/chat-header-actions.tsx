import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeftRight, CheckCircle2, Copy, ExternalLink, MoreHorizontal, UserPlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPipelinePageMeta, moveOpportunityToStage } from "@/modules/crm";
import { quickAssignOpportunity } from "@/modules/assignments";
import { toast } from "@/lib/toast";

type Opportunity = {
  id: string;
  pipeline_id?: string | null;
  owner_agent_id?: string | null;
};

/** Assign or transfer the chat's opportunity, close it as won or lost, and quick links. */
export function ChatHeaderActions({
  chatId,
  opportunity,
  phone,
}: {
  chatId: string;
  opportunity: Opportunity | null;
  phone: string;
}) {
  const qc = useQueryClient();
  const fetchMeta = useServerFn(getPipelinePageMeta);
  const assign = useServerFn(quickAssignOpportunity);
  const moveToStage = useServerFn(moveOpportunityToStage);

  // Same cache as the pipeline page: team members and each pipeline's stages.
  const meta = useQuery({
    queryKey: ["pipeline-page-meta"],
    queryFn: () => fetchMeta(),
    staleTime: 5 * 60 * 1000,
    enabled: !!opportunity,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["opportunity-workspace", chatId] });
    void qc.invalidateQueries({ queryKey: ["chats-enriched"] });
    void qc.invalidateQueries({ queryKey: ["pipeline-board"] });
  };

  const assignMut = useMutation({
    mutationFn: (userId: string) =>
      assign({ data: { opportunityId: opportunity!.id, toUserId: userId } }),
    onSuccess: () => {
      toast.success(opportunity?.owner_agent_id ? "تم تحويل المحادثة" : "تم إسناد المحادثة");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeMut = useMutation({
    mutationFn: (stage: { id: string; won: boolean }) =>
      moveToStage({ data: { opportunityId: opportunity!.id, stageId: stage.id } }),
    onSuccess: (_result, stage) => {
      toast.success(stage.won ? "تم إغلاق الفرصة كبيع ناجح" : "تم إغلاق الفرصة كخسارة");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const members: { user_id: string; profile_name: string | null }[] = meta.data?.members ?? [];
  const stages: { id: string; name: string; is_won: boolean; is_lost: boolean }[] =
    meta.data?.pipelines?.find((p: { id: string }) => p.id === opportunity?.pipeline_id)?.stages ?? [];
  const wonStage = stages.find((s) => s.is_won);
  const lostStage = stages.find((s) => s.is_lost);
  const isTransfer = !!opportunity?.owner_agent_id;
  const busy = assignMut.isPending || closeMut.isPending;

  return (
    <div className="hidden xl:flex items-center gap-1 shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={!opportunity || busy}>
            {isTransfer ? <ArrowLeftRight className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
            {isTransfer ? "تحويل" : "إسناد"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel className="text-xs">
            {isTransfer ? "تحويل المحادثة إلى" : "إسناد المحادثة إلى"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {meta.isPending ? (
            <DropdownMenuItem disabled>جارٍ التحميل...</DropdownMenuItem>
          ) : members.length === 0 ? (
            <DropdownMenuItem disabled>لا يوجد أعضاء</DropdownMenuItem>
          ) : (
            members.map((member) => (
              <DropdownMenuItem
                key={member.user_id}
                disabled={member.user_id === opportunity?.owner_agent_id}
                onSelect={() => assignMut.mutate(member.user_id)}
              >
                {member.profile_name || "بدون اسم"}
                {member.user_id === opportunity?.owner_agent_id ? " (الحالي)" : ""}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={!opportunity || busy}>
            <XCircle className="h-3.5 w-3.5" />
            إغلاق
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">إغلاق الفرصة</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!wonStage}
            onSelect={() => wonStage && closeMut.mutate({ id: wonStage.id, won: true })}
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            بيع ناجح{wonStage ? ` — ${wonStage.name}` : ""}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!lostStage}
            onSelect={() => lostStage && closeMut.mutate({ id: lostStage.id, won: false })}
          >
            <XCircle className="h-4 w-4 text-destructive" />
            خسارة{lostStage ? ` — ${lostStage.name}` : ""}
          </DropdownMenuItem>
          {!meta.isPending && (!wonStage || !lostStage) && (
            <DropdownMenuItem disabled className="text-xs">
              حدّد مرحلتي الفوز والخسارة من إعدادات القمع
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="المزيد">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {opportunity && (
            <DropdownMenuItem asChild>
              <Link to="/pipeline/$oppId" params={{ oppId: opportunity.id }}>
                <ExternalLink className="h-4 w-4" />
                فتح صفحة الفرصة
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              void navigator.clipboard
                ?.writeText(`+${phone}`)
                .then(() => toast.success("تم نسخ الرقم"), () => toast.error("تعذر نسخ الرقم"));
            }}
          >
            <Copy className="h-4 w-4" />
            نسخ الرقم
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
