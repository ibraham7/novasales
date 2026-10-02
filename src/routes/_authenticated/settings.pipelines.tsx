import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { Plus, Trash2, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  listPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  upsertStage,
  deleteStage,
} from "@/modules/crm";

export const Route = createFileRoute("/_authenticated/settings/pipelines")({
  head: () => ({ meta: [{ title: "إدارة قنوات المبيعات - NovaSales" }] }),
  component: SettingsPipelinesPage,
});

function SettingsPipelinesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPipelines);
  const createFn = useServerFn(createPipeline);
  const updateFn = useServerFn(updatePipeline);
  const deleteFn = useServerFn(deletePipeline);
  const stageFn = useServerFn(upsertStage);
  const stageDelFn = useServerFn(deleteStage);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newPipeOpen, setNewPipeOpen] = useState(false);
  const [newPipeName, setNewPipeName] = useState("");

  const q = useQuery({ queryKey: ["pipelines"], queryFn: () => listFn() });
  useEffect(() => {
    if (!selectedId && q.data?.length) setSelectedId(q.data[0].id);
  }, [q.data, selectedId]);

  const current = q.data?.find((p: any) => p.id === selectedId);

  const createPipeMut = useMutation({
    mutationFn: () => createFn({ data: { name: newPipeName } }),
    onSuccess: () => {
      toast.success("تم إنشاء القمع");
      setNewPipeOpen(false);
      setNewPipeName("");
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefaultMut = useMutation({
    mutationFn: (id: string) => updateFn({ data: { pipelineId: id, isDefault: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });

  const delPipeMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { pipelineId: id } }),
    onSuccess: () => {
      toast.success("تم الحذف");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveStageMut = useMutation({
    mutationFn: (s: any) =>
      stageFn({
        data: {
          id: s.id,
          pipelineId: selectedId!,
          name: s.name,
          color: s.color,
          ord: s.ord,
          probability: s.probability,
          isWon: s.is_won,
          isLost: s.is_lost,
        },
      }),
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delStageMut = useMutation({
    mutationFn: (id: string) => stageDelFn({ data: { stageId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipelines"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">قنوات المبيعات</h2>
      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-4">
        <Card className="p-3 space-y-1 h-fit">
          {(q.data ?? []).map((p: any) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={
                "w-full text-right px-3 py-2 rounded text-sm flex items-center justify-between " +
                (selectedId === p.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")
              }
            >
              <span className="truncate">{p.name}</span>
              {p.is_default && <Star className="h-3 w-3" />}
            </button>
          ))}
          <Dialog open={newPipeOpen} onOpenChange={setNewPipeOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full mt-2">
                <Plus className="h-3 w-3 ml-1" /> قمع جديد
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>قمع جديد</DialogTitle></DialogHeader>
              <div>
                <Label>الاسم</Label>
                <Input required aria-label="اسم المسار" value={newPipeName} onChange={(e) => setNewPipeName(e.target.value)} />
              </div>
              <DialogFooter>
                <Button validate
                  disabled={createPipeMut.isPending}
                  onClick={() => createPipeMut.mutate()}
                >
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Card>

        <Card className="p-3 sm:p-4 min-w-0">
          {!current ? (
            <div className="text-center text-muted-foreground py-8">اختر قمعاً</div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4 gap-2">
                <div>
                  <div className="text-lg font-semibold">{current.name}</div>
                  {current.description && <div className="text-sm text-muted-foreground">{current.description}</div>}
                </div>
                <div className="flex gap-2">
                  {!current.is_default && (
                    <Button validate size="sm" variant="outline" onClick={() => setDefaultMut.mutate(current.id)}>
                      <Star className="h-3 w-3 ml-1" /> اجعله افتراضياً
                    </Button>
                  )}
                  {!current.is_default && (
                    <Button validate
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("حذف هذا القمع؟")) delPipeMut.mutate(current.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {(current.stages ?? []).map((s: any, idx: number) => (
                  <StageRow
                    key={s.id}
                    stage={s}
                    onSave={(next) => saveStageMut.mutate({ ...s, ...next })}
                    onDelete={() => {
                      if (confirm("حذف المرحلة؟")) delStageMut.mutate(s.id);
                    }}
                  />
                ))}
                <Button validate
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    saveStageMut.mutate({
                      id: undefined,
                      name: "مرحلة جديدة",
                      color: "#94a3b8",
                      ord: (current.stages?.length ?? 0) + 1,
                      probability: 0,
                      is_won: false,
                      is_lost: false,
                    })
                  }
                >
                  <Plus className="h-4 w-4 ml-1" /> إضافة مرحلة
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StageRow({
  stage,
  onSave,
  onDelete,
}: {
  stage: any;
  onSave: (patch: any) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color);
  const [probability, setProbability] = useState(stage.probability);
  const dirty = name !== stage.name || color !== stage.color || probability !== stage.probability;
  return (
    <div className="flex items-center gap-2 p-2 rounded border bg-muted/20">
      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
      <Input required aria-label="اسم المرحلة" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} />
      <Input
        type="color"
        className="w-14 h-9 p-1"
        value={color}
        onChange={(e) => setColor(e.target.value)}
      />
      <Input
        type="number"
        min={0}
        max={100}
        className="w-20"
        value={probability}
        onChange={(e) => setProbability(Number(e.target.value))}
      />
      <span className="text-xs text-muted-foreground">%</span>
      {stage.is_won && <Badge className="bg-emerald-500">فوز</Badge>}
      {stage.is_lost && <Badge className="bg-red-500">خسارة</Badge>}
      <Button
        size="sm"
        variant="outline"
        disabled={!dirty}
        onClick={() => onSave({ name, color, probability })}
      >
        حفظ
      </Button>
      {!stage.is_won && !stage.is_lost && (
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
