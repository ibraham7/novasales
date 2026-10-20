import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { KanbanSquare, Settings2, UserPlus, MessageCircle, Plus, ArrowLeftRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { matchesSearch } from "@/lib/fuzzy-search";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPipelinePageMeta, moveOpportunityToStage, listOpportunitiesBoard, upsertStage, getOpportunityWorkspace } from "@/modules/crm";
import { getMergedChatForOpportunity } from "@/modules/messaging";
import { setStageQualityLevel } from "@/modules/integrations/conversions.functions";
import { QUALITY_LEVELS, QUALITY_LEVEL_KEYS, type QualityLevel } from "@/modules/integrations/conversion-model";

import { useMyPermissions } from "@/platform/rbac/use-permission";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { quickAssignOpportunity } from "@/modules/assignments/lead-assignments.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

function formatRelativeShort(iso: string) {
  const d = new Date(iso).getTime();
  if (!d) return "";
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `${m}د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}س`;
  const dd = Math.floor(h / 24);
  if (dd < 7) return `${dd}ي`;
  return new Date(iso).toLocaleDateString("ar", { day: "numeric", month: "short" });
}

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({
    meta: [
      { title: "قمع المبيعات - NovaSales" },
      { name: "description", content: "لوحة كانبان تفاعلية لفرص المبيعات." },
    ],
  }),
  component: PipelinePage,
});

function PipelinePage() {
  const qc = useQueryClient();
  const isDetailRoute = useRouterState({ select: (s) => s.location.pathname.startsWith("/pipeline/") });
  const listMeta = useServerFn(getPipelinePageMeta);
  const listBoard = useServerFn(listOpportunitiesBoard);
  const move = useServerFn(moveOpportunityToStage);
  const doQuickAssign = useServerFn(quickAssignOpportunity);

  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [pipelineId, setPipelineId] = useState<string | null>(null);

  const metaQ = useQuery({
    queryKey: ["pipeline-page-meta"],
    queryFn: () => listMeta(),
    staleTime: 5 * 60 * 1000,
  });
  const pipesQ = { ...metaQ, data: metaQ.data?.pipelines };
  const deptsQ = { ...metaQ, data: metaQ.data?.departments };
  const membersQ = { ...metaQ, data: metaQ.data?.members };
  // أثناء البحث نجلب كل التذاكر (لا أحدث 500 فقط) حتى تظهر التذاكر القديمة.
  const searching = search.trim().length > 0;
  const boardQ = useQuery({
    queryKey: ["pipeline-board", deptFilter, agentFilter, searching],
    queryFn: () =>
      listBoard({
        data: {
          ...(deptFilter === "all" ? {} : { departmentId: deptFilter }),
          ...(agentFilter === "all" ? {} : { ownerAgentId: agentFilter }),
          all: searching,
        },
      }),

    // Realtime drives instant updates; polling is only a slow safety net so
    // weak connections aren't hammered every 8 seconds.
    staleTime: 15_000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });

  useEffect(() => {
    if (!pipelineId && pipesQ.data && pipesQ.data.length > 0) {
      const def = pipesQ.data.find((p: any) => p.is_default) ?? pipesQ.data[0];
      setPipelineId(def.id);
    }
  }, [pipesQ.data, pipelineId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Coalesce bursts (a message insert usually comes with a session update)
    // but keep the delay tiny so the board feels instant.
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qc.refetchQueries({ queryKey: ["pipeline-board"], type: "active" });
      }, 250);
    };

    const ch = supabase
      .channel("pipeline-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "opp_opportunities" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "msg_messages" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "msg_messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "msg_sessions" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_opportunity_sessions" }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [qc]);


  const moveMut = useMutation({
    mutationFn: (v: { id: string; stageId: string }) =>
      move({ data: { opportunityId: v.id, stageId: v.stageId } }),
    // Move the card at once; the save follows in the background and is undone if it fails.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["pipeline-board"] });
      const previous = qc.getQueriesData({ queryKey: ["pipeline-board"] });
      qc.setQueriesData({ queryKey: ["pipeline-board"] }, (data: any) =>
        Array.isArray(data)
          ? data.map((o: any) => (o.id === v.id ? { ...o, stage_id: v.stageId } : o))
          : data,
      );
      return { previous };
    },
    onError: (e: Error, _v, context) => {
      for (const [key, data] of context?.previous ?? []) qc.setQueryData(key, data);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["pipeline-board"] }),
  });

  const saveStage = useServerFn(upsertStage);
  const renameStageMut = useMutation({
    mutationFn: (v: { stage: any; name: string }) =>
      saveStage({
        data: {
          id: v.stage.id,
          pipelineId: v.stage.pipeline_id,
          name: v.name,
          color: v.stage.color,
          ord: v.stage.ord,
          probability: v.stage.probability,
          isWon: v.stage.is_won,
          isLost: v.stage.is_lost,
        },
      }),
    // Show the new name at once; the save follows in the background and is undone if it fails.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["pipeline-page-meta"] });
      const previous = qc.getQueryData(["pipeline-page-meta"]);
      qc.setQueryData(["pipeline-page-meta"], (data: any) =>
        !data?.pipelines
          ? data
          : {
              ...data,
              pipelines: data.pipelines.map((pipe: any) =>
                pipe.id !== v.stage.pipeline_id
                  ? pipe
                  : {
                      ...pipe,
                      stages: (pipe.stages ?? []).map((s: any) =>
                        s.id === v.stage.id ? { ...s, name: v.name } : s,
                      ),
                    },
              ),
            },
      );
      return { previous };
    },
    onSuccess: () => {
      toast.success("تم تحديث اسم المرحلة");
    },
    onError: (e: Error, _v, context) => {
      if (context?.previous !== undefined) qc.setQueryData(["pipeline-page-meta"], context.previous);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["pipeline-page-meta"] }),
  });

  const saveQuality = useServerFn(setStageQualityLevel);
  const qualityMut = useMutation({
    mutationFn: (v: { stage: any; level: QualityLevel | null }) =>
      saveQuality({ data: { stageId: v.stage.id, qualityLevel: v.level } }),
    onSuccess: (_result, v) => {
      // A level sits on one stage per pipeline, so placing it moves it off the previous stage.
      qc.setQueryData(["pipeline-page-meta"], (previous: any) =>
        !previous?.pipelines
          ? previous
          : {
              ...previous,
              pipelines: previous.pipelines.map((pipe: any) =>
                pipe.id !== v.stage.pipeline_id
                  ? pipe
                  : {
                      ...pipe,
                      stages: (pipe.stages ?? []).map((s: any) =>
                        s.id === v.stage.id
                          ? { ...s, quality_level: v.level }
                          : v.level && s.quality_level === v.level
                            ? { ...s, quality_level: null }
                            : s,
                      ),
                    },
              ),
            },
      );
      toast.success(v.level ? `تم تقييم المرحلة: ${QUALITY_LEVELS[v.level].label}` : "تمت إزالة التقييم");
      void qc.invalidateQueries({ queryKey: ["pipeline-page-meta"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const addStageMut = useMutation({
    mutationFn: (v: { name: string }) =>
      saveStage({
        data: {
          pipelineId: pipelineId!,
          name: v.name,
          color: "#94a3b8",
          ord: ((pipesQ.data?.find((p: any) => p.id === pipelineId)?.stages?.length as number | undefined) ?? 0) + 1,
          probability: 0,
          isWon: false,
          isLost: false,
        },
      }),
    onSuccess: (result, variables) => {
      // Update the visible board immediately; the refetch below remains the source of truth.
      qc.setQueryData(["pipeline-page-meta"], (previous: any) => {
        if (!previous?.pipelines || !pipelineId) return previous;
        return {
          ...previous,
          pipelines: previous.pipelines.map((pipe: any) =>
            pipe.id !== pipelineId
              ? pipe
              : {
                  ...pipe,
                  stages: [
                    ...(pipe.stages ?? []),
                    {
                      id: result?.id ?? crypto.randomUUID(),
                      pipeline_id: pipelineId,
                      name: variables.name,
                      color: "#94a3b8",
                      ord: ((pipe.stages ?? []).length) + 1,
                      probability: 0,
                      is_won: false,
                      is_lost: false,
                    },
                  ],
                },
          ),
        };
      });
      toast.success("تمت إضافة المرحلة");
      setNewStageOpen(false);
      setNewStageName("");
      void qc.invalidateQueries({ queryKey: ["pipeline-page-meta"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const assignMut = useMutation({
    mutationFn: async (v: { opportunityId: string; userId: string }) =>
      doQuickAssign({ data: { opportunityId: v.opportunityId, toUserId: v.userId } }),
    onSuccess: () => {
      toast.success("تم الإسناد");
      qc.invalidateQueries({ queryKey: ["pipeline-board"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل الإسناد"),
  });

  const handleAssign = useCallback(
    (opportunityId: string, userId: string) => assignMut.mutate({ opportunityId, userId }),
    [assignMut.mutate]
  );

  const handleMove = useCallback(
    (opportunityId: string, stageId: string) => moveMut.mutate({ id: opportunityId, stageId }),
    [moveMut.mutate]
  );

  const currentPipe = useMemo(
    () => pipesQ.data?.find((p: any) => p.id === pipelineId) ?? null,
    [pipesQ.data, pipelineId]
  );
  const stages: any[] = currentPipe?.stages ?? [];
  const permsQ = useMyPermissions();
  const canManageStages =
    (permsQ.data ?? []).includes("crm.pipelines.manage") || (permsQ.data ?? []).includes("org.manage");

  const filtered = useMemo(() => {
    // Defense-in-depth: the loader returns one row per opportunity,
    // but never let a duplicated id reach React keys again.
    const seen = new Set<string>();
    return (boardQ.data ?? []).filter((o: any) => {
      if (!o?.id || seen.has(o.id)) return false;
      seen.add(o.id);
      if (channelFilter !== "all" && (o.channel ?? "").toLowerCase() !== channelFilter) return false;
      if (unreadOnly && (o.unread_count ?? 0) === 0) return false;
      if (search.trim()) {
        const ok = matchesSearch(search, [
          o.contact_name,
          o.contact_phone,
          o.source,
          o.owner_name,
          o.account_name,
          o.account_label,
          o.last_message,
        ]);
        if (!ok) return false;
      }
      return true;
    });
  }, [boardQ.data, channelFilter, unreadOnly, search]);


  const byStage = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach((o: any) => {
      if (!o.stage_id) return;
      const arr = map.get(o.stage_id) ?? [];
      arr.push(o);
      map.set(o.stage_id, arr);
    });
    return map;
  }, [filtered]);

  const [dragOver, setDragOver] = useState<string | null>(null);

  if (isDetailRoute) {
    return <Outlet />;
  }

  const members = membersQ.data ?? [];
  // Filter choices limited to what this user can see (null = everything).
  const allowedMemberIds: string[] | null = metaQ.data?.filterMemberIds ?? null;
  const allowedDepartmentIds: string[] | null = metaQ.data?.filterDepartmentIds ?? null;
  const filterMembers = allowedMemberIds ? members.filter((m: any) => allowedMemberIds.includes(m.user_id)) : members;
  const filterDepartments = (deptsQ.data ?? []).filter(
    (d: any) => !allowedDepartmentIds || allowedDepartmentIds.includes(d.id),
  );

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col p-6 gap-4 overflow-hidden" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KanbanSquare className="h-6 w-6" /> قمع المبيعات
          </h1>
          <p className="text-sm text-muted-foreground mt-1">اسحب الفرصة بين المراحل أو استخدم زر الإسناد السريع.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={pipelineId ?? ""} onValueChange={setPipelineId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="اختر قمعاً" /></SelectTrigger>
            <SelectContent>
              {(pipesQ.data ?? []).map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{p.name} {p.is_default && "★"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManageStages && pipelineId && (
            <Button size="sm" onClick={() => setNewStageOpen(true)}>
              <Plus className="h-4 w-4 ml-1" /> مرحلة جديدة
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link to="/pipeline/trash">🗑️ المهملات</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/pipelines"><Settings2 className="h-4 w-4 ml-1" /> إدارة</Link>
          </Button>
        </div>
      </div>

      <Dialog open={newStageOpen} onOpenChange={setNewStageOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>مرحلة جديدة</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>اسم المرحلة</Label>
            <Input required aria-label="اسم المرحلة"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="مثال: بانتظار الدفع"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && newStageName.trim()) addStageMut.mutate({ name: newStageName.trim() });
              }}
            />
          </div>
          <DialogFooter>
            <Button validate
              disabled={addStageMut.isPending}
              onClick={() => addStageMut.mutate({ name: newStageName.trim() })}
            >
              إضافة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filters bar */}
      <div className="flex items-center gap-2 flex-wrap bg-muted/30 p-2 rounded-lg shrink-0">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو المصدر..."
          className="w-56 h-9"
        />
        {/* A member who sees only their own opportunities has nothing to filter by agent or department. */}
        {metaQ.data?.visibility !== "own" && (
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="المندوب" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المناديب</SelectItem>
              {filterMembers.map((m: any) => (
                <SelectItem key={m.id} value={m.user_id}>{m.profile_name ?? m.display_name ?? "—"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {metaQ.data?.visibility !== "own" && (
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="القسم" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأقسام</SelectItem>
              {filterDepartments.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="القناة" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل القنوات</SelectItem>
            <SelectItem value="whatsapp">واتساب</SelectItem>
            <SelectItem value="meta_ads">Meta Ads</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={unreadOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setUnreadOnly((v) => !v)}
          className="h-9"
        >
          <MessageCircle className="h-4 w-4 ml-1" /> غير مقروء فقط
        </Button>
        {(agentFilter !== "all" || deptFilter !== "all" || channelFilter !== "all" || unreadOnly || search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setAgentFilter("all"); setDeptFilter("all"); setChannelFilter("all"); setUnreadOnly(false); setSearch(""); }}
          >
            مسح الفلاتر
          </Button>
        )}
      </div>

      {metaQ.isError || boardQ.isError ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
          <p>تعذر تحميل قمع المبيعات. حاول مجددًا، وإذا استمر الخطأ تواصل مع الإدارة.</p>
          <Button variant="outline" onClick={() => { void metaQ.refetch(); void boardQ.refetch(); }}>إعادة المحاولة</Button>
        </div>
      ) : stages.length === 0 ? (
        pipesQ.isLoading || boardQ.isLoading ? (
          <div className="grid grid-flow-col auto-cols-[300px] gap-4 overflow-x-auto pb-2 flex-1 min-h-0">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border bg-muted/30 p-3 space-y-3">
                <div className="h-6 w-32 rounded bg-muted animate-pulse" />
                <div className="h-24 rounded-lg bg-muted animate-pulse" />
                <div className="h-24 rounded-lg bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-16">
            لا توجد مراحل. <Link to="/settings/pipelines" className="text-primary underline">أنشئ مراحل</Link>.
          </div>
        )
      ) : (
        <div className="grid grid-flow-col auto-cols-[300px] gap-4 overflow-x-auto pb-2 flex-1 min-h-0">
          {stages.map((s: any) => (
            <KanbanColumn
              key={s.id}
              stage={s}
              items={byStage.get(s.id) ?? []}
              loading={boardQ.isLoading && !boardQ.data}
              members={members}
              canManageStages={canManageStages}
              isDragOver={dragOver === s.id}
              onDragOver={() => setDragOver(s.id)}
              onDragLeave={() => setDragOver(null)}
              onDropOpp={(id) => { setDragOver(null); moveMut.mutate({ id, stageId: s.id }); }}
              onRename={(name) => renameStageMut.mutate({ stage: s, name })}
              onQualityChange={(level) => qualityMut.mutate({ stage: s, level })}
              onAssign={handleAssign}
              stages={stages}
              onMove={handleMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const PAGE = 20;

/* One kanban column. Cards are paged so a column holding hundreds of
 * opportunities never renders hundreds of DOM nodes at once — that was the
 * main source of scroll/drag lag on the board. */
function KanbanColumn({
  stage,
  items,
  loading,
  members,
  canManageStages,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDropOpp,
  onRename,
  onQualityChange,
  onAssign,
  stages,
  onMove,
}: {
  stage: any;
  items: any[];
  loading: boolean;
  members: any[];
  stages: any[];
  onMove: (oppId: string, stageId: string) => void;
  canManageStages: boolean;
  isDragOver: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDropOpp: (id: string) => void;
  onRename: (name: string) => void;
  onQualityChange: (level: QualityLevel | null) => void;
  onAssign: (oppId: string, userId: string) => void;
}) {
  const [visible, setVisible] = useState(PAGE);
  const shown = useMemo(() => items.slice(0, visible), [items, visible]);

  return (
    <div
      className={cn(
        "bg-muted rounded-xl border border-border/80 shadow-sm p-3 flex flex-col min-h-0 transition-colors",
        isDragOver && "bg-primary/10 ring-2 ring-primary"
      )}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/opp-id");
        if (id) onDropOpp(id);
      }}
    >
      <StageQualityBadge level={stage.quality_level} canEdit={canManageStages} onChange={onQualityChange} />
      <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color }} />
          <StageNameEditor stage={stage} canEdit={canManageStages} onRename={onRename} />
          <span className="text-[10px] text-muted-foreground shrink-0">{stage.probability}%</span>
        </div>
        <Badge variant="secondary" className="shrink-0">{items.length}</Badge>
      </div>
      <div className="space-y-2 flex-1 overflow-y-auto pr-1 -mr-1">
        {loading && items.length === 0 ? (
          [0, 1, 2].map((i) => <div key={i} className="h-20 rounded-lg bg-background/60 animate-pulse" />)
        ) : (
          <>
            {shown.map((o: any) => (
              <KanbanCard key={o.id} opp={o} members={members} stages={stages} onAssign={onAssign} onMove={onMove} />
            ))}
            {items.length > visible && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => setVisible((v) => v + PAGE)}
              >
                عرض المزيد ({items.length - visible})
              </Button>
            )}
            {items.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-6">لا يوجد</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


const KanbanCard = memo(function KanbanCard({
  opp,
  members,
  stages,
  onAssign,
  onMove,
}: {
  opp: any;
  members: any[];
  stages: any[];
  onAssign: (oppId: string, userId: string) => void;
  onMove: (oppId: string, stageId: string) => void;
}) {
  const qc = useQueryClient();
  const warmWs = useServerFn(getOpportunityWorkspace);
  const warmChat = useServerFn(getMergedChatForOpportunity);
  // Warm the ticket's workspace + chat while the pointer is still on the card,
  // so opening it renders from cache instead of waiting on the network.
  const prefetch = useCallback(() => {
    qc.prefetchQuery({
      queryKey: ["opp-workspace", opp.id],
      queryFn: () => warmWs({ data: { opportunityId: opp.id } }),
      staleTime: 60_000,
    });
    qc.prefetchQuery({
      queryKey: ["merged-chat", opp.id],
      queryFn: () => warmChat({ data: { opportunityId: opp.id } }),
      staleTime: 30_000,
    });
  }, [opp.id, qc, warmWs, warmChat]);

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/opp-id", opp.id)}
      onPointerEnter={prefetch}
      onFocusCapture={prefetch}
      className="group"
    >

      <Card className="p-2.5 cursor-move hover:shadow-md transition-shadow relative">
        <Link to="/pipeline/$oppId" params={{ oppId: opp.id }} className="block">
          <div className="flex items-start gap-2">
            <Avatar className="h-9 w-9 shrink-0">
              {opp.contact_avatar && <AvatarImage src={opp.contact_avatar} />}
              <AvatarFallback className="text-xs">
                {(opp.contact_name ?? "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate">{opp.contact_name ?? "—"}</div>
              {opp.last_message && (
                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {opp.last_message}
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {opp.channel && (
                  <Badge variant="secondary" className="text-[9px] gap-1 h-4 px-1.5">
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        opp.channel === "whatsapp" ? "bg-emerald-500" : "bg-blue-500"
                      )}
                    />
                    {opp.channel === "whatsapp" ? "واتساب" : opp.channel}
                    {(opp.account_label ?? opp.account_name) && (
                      <span className="opacity-70">· {opp.account_label ?? opp.account_name}</span>
                    )}
                  </Badge>
                )}
                {opp.unread_count > 0 && (
                  <Badge variant="destructive" className="text-[9px] h-4 px-1.5">
                    {opp.unread_count}
                  </Badge>
                )}
                {opp.last_message_at && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelativeShort(opp.last_message_at)}
                  </span>
                )}
              </div>

            </div>
          </div>
        </Link>

        {/* Owner + quick assign */}
        <div className="mt-2 flex items-center justify-between gap-2 pt-2 border-t">
          {opp.owner_agent_id ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <Avatar className="h-5 w-5">
                {opp.owner_avatar && <AvatarImage src={opp.owner_avatar} />}
                <AvatarFallback className="text-[9px]">
                  {opp.owner_name?.charAt(0) ?? "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-[10px] truncate">{opp.owner_name ?? "مسند"}</span>
            </div>
          ) : (
            <Badge variant="outline" className="text-[10px]">غير مسند</Badge>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
          <MoveStageMenu opp={opp} stages={stages} onMove={onMove} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                title="إسناد"
                className="h-8 w-8 sm:h-6 sm:w-6 opacity-70 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <UserPlus className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{opp.owner_agent_id ? "نقل إلى" : "إسناد إلى"}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {members.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">لا يوجد مناديب</div>
              )}
              {members.map((m: any) => (
                <DropdownMenuItem
                  key={m.id}
                  onSelect={() => onAssign(opp.id, m.user_id)}
                >
                  <Avatar className="h-5 w-5 ml-2">
                    <AvatarFallback className="text-[9px]">
                      {(m.profile_name ?? m.display_name ?? "?").charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  {m.profile_name ?? m.display_name ?? "—"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      </Card>
    </div>
  );
});

/* Touch screens cannot drag between columns, so every card also offers a stage menu. */
function MoveStageMenu({
  opp,
  stages,
  onMove,
}: {
  opp: any;
  stages: any[];
  onMove: (oppId: string, stageId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          title="نقل إلى مرحلة"
          aria-label="نقل إلى مرحلة"
          className="h-8 w-8 sm:h-6 sm:w-6 opacity-70 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowLeftRight className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>نقل إلى مرحلة</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {stages.map((s: any) => (
          <DropdownMenuItem
            key={s.id}
            disabled={s.id === opp.stage_id}
            onSelect={() => onMove(opp.id, s.id)}
            className="py-2.5 sm:py-1.5"
          >
            <span className="w-2.5 h-2.5 rounded-full ml-2 shrink-0" style={{ background: s.color ?? "#94a3b8" }} />
            {s.name}
            {s.id === opp.stage_id && <span className="mr-auto text-[10px] text-muted-foreground">الحالية</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const QUALITY_BADGE_CLASS: Record<QualityLevel, string> = {
  very_bad: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
  average: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  good: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900",
  excellent: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
};

/* Lead-quality score shown above a stage; managers place or move it from here. */
function StageQualityBadge({
  level,
  canEdit,
  onChange,
}: {
  level: QualityLevel | null | undefined;
  canEdit: boolean;
  onChange: (level: QualityLevel | null) => void;
}) {
  const chip = level ? (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        QUALITY_BADGE_CLASS[level],
      )}
    >
      {QUALITY_LEVELS[level].label} · {QUALITY_LEVELS[level].score}/10
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
      + تقييم الجودة
    </span>
  );
  if (!canEdit) return level ? <div className="mb-2 shrink-0">{chip}</div> : null;
  return (
    <div className="mb-2 shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="تقييم جودة العملاء في هذه المرحلة" className="rounded-full">
          {chip}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-xs">تقييم جودة العملاء في هذه المرحلة</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {QUALITY_LEVEL_KEYS.map((key) => (
            <DropdownMenuItem key={key} onSelect={() => onChange(key)}>
              {QUALITY_LEVELS[key].label} — {QUALITY_LEVELS[key].score}/10
            </DropdownMenuItem>
          ))}
          {level && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onChange(null)}>إزالة التقييم</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* Inline rename of a stage directly from the kanban header. */
function StageNameEditor({
  stage,
  canEdit,
  onRename,
}: {
  stage: any;
  canEdit: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(stage.name);

  useEffect(() => {
    setValue(stage.name);
  }, [stage.name]);

  function commit() {
    setEditing(false);
    const next = value.trim();
    if (!next || next === stage.name) {
      setValue(stage.name);
      return;
    }
    onRename(next);
  }

  if (!canEdit) return <div className="font-semibold text-sm truncate">{stage.name}</div>;

  if (editing) {
    return (
      <Input
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setValue(stage.name);
            setEditing(false);
          }
        }}
        className="h-7 text-sm py-0 px-2"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="اضغط لتعديل اسم المرحلة"
      className="font-semibold text-sm truncate hover:underline decoration-dotted text-right"
    >
      {stage.name}
    </button>
  );
}
