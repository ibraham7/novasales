import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Inbox as InboxIcon, ArrowLeftRight, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { listUnassigned, assignOpportunity, getWelcomeTemplate, saveWelcomeTemplate, listAssignmentEligibility } from "@/modules/assignments";
import { BLOCK_MSG, stateLabel } from "@/lib/eligibility-ui";

import { listDepartments, listMembers } from "@/modules/organization";
import { listInstances } from "@/modules/channels";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "صندوق المشرف - NovaSales" },
      { name: "description", content: "توزيع العملاء الجدد على المناديب." },
    ],
  }),
  component: InboxPage,
});

function InboxPage() {
  const qc = useQueryClient();
  const listUn = useServerFn(listUnassigned);
  const listDepts = useServerFn(listDepartments);
  const [deptFilter, setDeptFilter] = useState<string>("all");

  const deptsQ = useQuery({ queryKey: ["departments"], queryFn: () => listDepts() });
  const unQ = useQuery({
    queryKey: ["inbox", deptFilter],
    queryFn: () =>
      listUn({ data: deptFilter === "all" ? {} : { departmentId: deptFilter } }),
  });

  useEffect(() => {
    const ch = supabase
      .channel("inbox-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "opp_opportunities" }, () => {
        qc.invalidateQueries({ queryKey: ["inbox"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const [assignFor, setAssignFor] = useState<any | null>(null);
  const [tmplOpen, setTmplOpen] = useState(false);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <InboxIcon className="h-6 w-6" /> صندوق المشرف
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            العملاء الواصلون على الأرقام العامة وينتظرون التوزيع على مندوب.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأقسام</SelectItem>
              {(deptsQ.data ?? []).map((d: any) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" className="max-w-full" onClick={() => setTmplOpen(true)}>
            <Settings2 className="h-4 w-4 ml-1" /> قالب الترحيب
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {(unQ.data ?? []).length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">
            <InboxIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
            لا توجد عملاء ينتظرون التوزيع.
          </Card>
        ) : (
          (unQ.data ?? []).map((o: any) => (
            <Card key={o.id} className="p-3 sm:p-4 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                {(o.contact_name ?? o.peer ?? "?").toString().charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-[55%] sm:min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{o.contact_name ?? o.peer}</div>
                  {o.source && <Badge variant="secondary">{o.source}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {o.last_message ?? "—"}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {o.last_message_at ? new Date(o.last_message_at).toLocaleString("ar") : ""}
              </div>
              <Button size="sm" onClick={() => setAssignFor(o)}>
                <ArrowLeftRight className="h-4 w-4 ml-1" /> تحويل لمندوب
              </Button>
            </Card>
          ))
        )}
      </div>

      {assignFor && (
        <AssignDialog opportunity={assignFor} onClose={() => setAssignFor(null)} />
      )}
      {tmplOpen && <TemplateDialog onClose={() => setTmplOpen(false)} />}
    </div>
  );
}

function AssignDialog({ opportunity, onClose }: { opportunity: any; onClose: () => void }) {
  const qc = useQueryClient();
  const listM = useServerFn(listMembers);
  const listInst = useServerFn(listInstances);
  const getTmpl = useServerFn(getWelcomeTemplate);
  const assign = useServerFn(assignOpportunity);
  const membersQ = useQuery({
    queryKey: ["members-all"],
    queryFn: () => listM({ data: {} }),
  });
  const instQ = useQuery({ queryKey: ["instances-teams"], queryFn: () => listInst() });
  const eligFn = useServerFn(listAssignmentEligibility);
  const eligQ = useQuery({ queryKey: ["assign-eligibility"], queryFn: () => eligFn() });
  const eligMap = useMemo(
    () => new Map((eligQ.data ?? []).map((e: any) => [e.account_id, e])),
    [eligQ.data],
  );
  const elig = (id?: string | null) => (id ? (eligMap.get(id) as any) ?? null : null);
  const tmplQ = useQuery({ queryKey: ["welcome-tmpl"], queryFn: () => getTmpl() });


  const [memberId, setMemberId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [text, setText] = useState<string>("");

  useEffect(() => {
    if (tmplQ.data?.text && !text) setText(tmplQ.data.text);
  }, [tmplQ.data, text]);

  // auto-pick sending account: member's default → first available
  const filteredMembers = useMemo(() => {
    const rows = membersQ.data ?? [];
    if (!opportunity.department_id) return rows;
    return rows.filter((m: any) => m.department_id === opportunity.department_id);
  }, [membersQ.data, opportunity]);

  useEffect(() => {
    if (!memberId) return;
    const m: any = (membersQ.data ?? []).find((x: any) => x.id === memberId);
    if (m?.default_channel_account_id) setAccountId(m.default_channel_account_id);
  }, [memberId, membersQ.data]);

  const selectedMember: any = (membersQ.data ?? []).find((x: any) => x.id === memberId);
  const memberElig = elig(selectedMember?.default_channel_account_id);
  const memberBlocked = Boolean(memberElig && !memberElig.eligible);
  const accountElig = elig(accountId);
  const accountBlocked = Boolean(accountElig && !accountElig.eligible);



  const mut = useMutation({
    mutationFn: () =>
      assign({
        data: {
          opportunityId: opportunity.id,
          memberId,
          sendingAccountId: accountId,
          welcomeText: text,
        },
      }),
    onSuccess: () => {
      toast.success("تم التحويل وإرسال رسالة الترحيب");
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["chats"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تحويل {opportunity.contact_name ?? "العميل"} لمندوب</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>المندوب</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر مندوباً" />
              </SelectTrigger>
              <SelectContent>
                {filteredMembers
                  .filter((m: any) => !m.is_supervisor)
                  .map((m: any) => {
                    const el = m.default_channel_account_id ? elig(m.default_channel_account_id) : null;
                    const blocked = Boolean(el && !el.eligible);
                    return (
                      <SelectItem key={m.id} value={m.id} disabled={blocked}>
                        <span className="flex items-center gap-2">
                          {m.display_name ?? m.profile_name}
                          {blocked && <span className="text-[11px] text-amber-600">🟡 {stateLabel(el)}</span>}
                        </span>
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
            {memberBlocked && <p className="text-xs text-destructive mt-1">{BLOCK_MSG}</p>}
          </div>
          <div>
            <Label>جلسة الإرسال (رقم المندوب)</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر جلسة" />
              </SelectTrigger>
              <SelectContent>
                {(instQ.data ?? []).map((i: any) => {
                  const el = elig(i.id);
                  const blocked = Boolean(el && !el.eligible);
                  return (
                    <SelectItem key={i.id} value={i.id} disabled={blocked}>
                      <span className="flex items-center gap-2">
                        {i.display_name}
                        {blocked && <span className="text-[11px] text-amber-600">🟡 {stateLabel(el)}</span>}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {accountBlocked && <p className="text-xs text-destructive mt-1">{BLOCK_MSG}</p>}
          </div>

          <div>
            <Label>رسالة الترحيب</Label>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">
              متغيرات متاحة: <code>{"{{contact_name}}"}</code>، <code>{"{{rep_name}}"}</code>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!memberId || !accountId || !text.trim() || memberBlocked || accountBlocked || mut.isPending}>
            تحويل وإرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const getTmpl = useServerFn(getWelcomeTemplate);
  const saveTmpl = useServerFn(saveWelcomeTemplate);
  const q = useQuery({ queryKey: ["welcome-tmpl"], queryFn: () => getTmpl() });
  const [text, setText] = useState<string>("");
  useEffect(() => {
    if (q.data?.text) setText(q.data.text);
  }, [q.data]);
  const mut = useMutation({
    mutationFn: () => saveTmpl({ data: { text } }),
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["welcome-tmpl"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>قالب رسالة الترحيب الافتراضي</DialogTitle>
        </DialogHeader>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          متغيرات: <code>{"{{contact_name}}"}</code>، <code>{"{{rep_name}}"}</code>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={() => mut.mutate()} disabled={!text.trim() || mut.isPending}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
