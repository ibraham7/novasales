import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeftRight, Check, CheckCircle2, Copy, ExternalLink, Layers, MoreHorizontal, Trash2, UserPlus, XCircle } from "lucide-react";
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
import { useCanDeleteTickets } from "./use-can-delete";
import { TrashChatsDialog } from "./trash-chats-dialog";

type Opportunity = {
  id: string;
  pipeline_id?: string | null;
  stage_id?: string | null;
  owner_agent_id?: string | null;
};

/** Assign or transfer the chat's opportunity, move it between the pipeline's stages (the won and lost ones included), and quick links. */
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
  const navigate = useNavigate();
  const canDelete = useCanDeleteTickets();
  const [trashOpen, setTrashOpen] = useState(false);
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

  const moveMut = useMutation({
    mutationFn: (stage: { id: string; name: string }) =>
      moveToStage({ data: { opportunityId: opportunity!.id, stageId: stage.id } }),
    onSuccess: (_result, stage) => {
      toast.success(`نُقلت التذكرة إلى «${stage.name}»`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const members: { user_id: string; profile_name: string | null }[] = meta.data?.members ?? [];
  const stages: { id: string; name: string; is_won: boolean; is_lost: boolean }[] =
    meta.data?.pipelines?.find((p: { id: string }) => p.id === opportunity?.pipeline_id)?.stages ?? [];
  const isTransfer = !!opportunity?.owner_agent_id;
  const busy = assignMut.isPending || moveMut.isPending;

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
            <Layers className="h-3.5 w-3.5" />
            المرحلة
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel className="text-xs">نقل التذكرة إلى مرحلة</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {meta.isPending ? (
            <DropdownMenuItem disabled>جارٍ التحميل...</DropdownMenuItem>
          ) : stages.length === 0 ? (
            <DropdownMenuItem disabled>لا توجد مراحل</DropdownMenuItem>
          ) : (
            stages.map((stage) => {
              const current = stage.id === opportunity?.stage_id;
              return (
                <DropdownMenuItem key={stage.id} disabled={current} onSelect={() => moveMut.mutate({ id: stage.id, name: stage.name })}>
                  {stage.is_won ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : stage.is_lost ? <XCircle className="h-4 w-4 text-destructive" /> : current ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                  {stage.name}
                  {current ? " (الحالية)" : ""}
                </DropdownMenuItem>
              );
            })
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
          {opportunity && canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setTrashOpen(true)}>
                <Trash2 className="h-4 w-4" />
                نقل المحادثة إلى المهملات
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {opportunity && (
        <TrashChatsDialog open={trashOpen} onOpenChange={setTrashOpen} opportunityIds={[opportunity.id]} onDone={() => void navigate({ to: "/chat" })} />
      )}
    </div>
  );
}
