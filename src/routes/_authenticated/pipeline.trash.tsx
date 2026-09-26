import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, RotateCcw, Trash2 } from "lucide-react";
import { listTrashedOpportunities, restoreOpportunity, purgeOpportunity } from "@/modules/crm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/pipeline/trash")({
  head: () => ({
    meta: [
      { title: "المهملات - قمع المبيعات" },
      { name: "description", content: "التذاكر المحذوفة والقابلة للاستعادة." },
    ],
  }),
  component: TrashPage,
});

function TrashPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTrashedOpportunities);
  const restoreFn = useServerFn(restoreOpportunity);
  const q = useQuery({ queryKey: ["pipeline-trash"], queryFn: () => listFn() });

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { opportunityId: id } }),
    onSuccess: () => {
      toast.success("تمت الاستعادة");
      qc.invalidateQueries({ queryKey: ["pipeline-trash"] });
      qc.invalidateQueries({ queryKey: ["pipeline-board"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "تعذر الاستعادة"),
  });

  const purgeFn = useServerFn(purgeOpportunity);
  const purgeMut = useMutation({
    mutationFn: (id: string) => purgeFn({ data: { opportunityId: id } }),
    onSuccess: () => {
      toast.success("تم الحذف النهائي");
      qc.invalidateQueries({ queryKey: ["pipeline-trash"] });
      qc.invalidateQueries({ queryKey: ["pipeline-board"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "تعذر الحذف النهائي"),
  });



  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pipeline"><ArrowRight className="h-4 w-4 ml-1" /> القمع</Link>
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Trash2 className="h-6 w-6" /> المهملات
        </h1>
      </div>
      {q.isLoading ? (
        <div className="text-muted-foreground">جارٍ التحميل...</div>
      ) : (q.data ?? []).length === 0 ? (
        <div className="text-muted-foreground text-center py-16">لا توجد تذاكر محذوفة.</div>
      ) : (
        <div className="grid gap-2">
          {(q.data ?? []).map((o: any) => (
            <Card key={o.id} className="p-3 flex items-center gap-3">
              <Avatar className="h-9 w-9">
                {o.contact_avatar && <AvatarImage src={o.contact_avatar} />}
                <AvatarFallback>{(o.contact_name ?? "?").charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{o.contact_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  حُذفت {new Date(o.deleted_at).toLocaleString("ar")} {o.deleted_by_name ? `· بواسطة ${o.deleted_by_name}` : ""}
                </div>
              </div>
              {o.source && <Badge variant="outline" className="text-[10px]">{o.source}</Badge>}
              <Button size="sm" variant="outline" className="gap-1" onClick={() => restoreMut.mutate(o.id)}>
                <RotateCcw className="h-3.5 w-3.5" /> استعادة
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" className="gap-1" disabled={purgeMut.isPending}>
                    <Trash2 className="h-3.5 w-3.5" /> حذف نهائي
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir="rtl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>حذف التذكرة نهائياً؟</AlertDialogTitle>
                    <AlertDialogDescription>
                      سيتم حذف تذكرة «{o.contact_name}» وكل ملاحظاتها وملفاتها وسجلها بشكل نهائي. لا يمكن التراجع.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>إلغاء</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => purgeMut.mutate(o.id)}
                    >
                      حذف نهائي
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
