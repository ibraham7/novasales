import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { softDeleteOpportunities } from "@/modules/crm";
import { toast } from "@/lib/toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/**
 * «Delete» a chat = move its ticket to the trash: the chat leaves the list and the board, and can be brought back from the trash page.
 * (If the customer writes again, the ticket comes back by itself.) Works for one chat or many.
 */
export function TrashChatsDialog({ open, onOpenChange, opportunityIds, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; opportunityIds: string[]; onDone?: () => void }) {
  const qc = useQueryClient();
  const trash = useServerFn(softDeleteOpportunities);
  const mut = useMutation({
    mutationFn: () => trash({ data: { opportunityIds } }),
    onSuccess: (result) => {
      toast.success(result.skipped > 0 ? `نُقلت ${result.deleted} إلى المهملات، وتخطّيت ${result.skipped} لا تملك صلاحيتها` : result.deleted === 1 ? "نُقلت المحادثة إلى المهملات" : `نُقلت ${result.deleted} محادثات إلى المهملات`);
      void qc.invalidateQueries({ queryKey: ["chats-enriched"] });
      void qc.invalidateQueries({ queryKey: ["pipeline-board"] });
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message || "تعذر نقل المحادثات إلى المهملات"),
  });
  const many = opportunityIds.length > 1;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{many ? `نقل ${opportunityIds.length} محادثات إلى المهملات؟` : "نقل المحادثة إلى المهملات؟"}</AlertDialogTitle>
          <AlertDialogDescription>
            {many ? "ستختفي هذه المحادثات وتذاكرها من القائمة ومن القمع" : "ستختفي هذه المحادثة وتذكرتها من القائمة ومن القمع"}، ويمكن استعادتها من صفحة المهملات. إن راسلنا العميل من جديد تعود تذكرته تلقائياً.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mut.isPending}>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            disabled={mut.isPending || opportunityIds.length === 0}
            onClick={(e) => { e.preventDefault(); mut.mutate(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mut.isPending ? "جارٍ النقل..." : "نقل إلى المهملات"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
