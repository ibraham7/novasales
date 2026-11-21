import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createWorkflowFromRecipe } from "@/modules/workflow";
import { RECIPES } from "@/modules/workflow/recipes";

/** Ready-made automations: one click creates a copy that is switched OFF for the person to read and edit. */
export function RecipesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const create = useServerFn(createWorkflowFromRecipe);
  const mut = useMutation({
    mutationFn: (recipeId: string) => create({ data: { recipeId } }),
    onSuccess: () => {
      toast.success("أُضيفت الأتمتة وهي مطفأة. افتحها وراجع الصياغة ثم فعّلها.");
      qc.invalidateQueries({ queryKey: ["workflows"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {RECIPES.map((r) => (
        <Card key={r.id} className="p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{r.title}</span>
            <Badge variant="outline">{r.category}</Badge>
            <Badge variant="secondary">{r.audience}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{r.description}</p>
          <Button size="sm" disabled={!canManage || mut.isPending} onClick={() => mut.mutate(r.id)}>إضافة (تُنشأ مطفأة)</Button>
        </Card>
      ))}
    </div>
  );
}
