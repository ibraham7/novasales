import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MediaPreviewDialog, makeItems, type PreviewItem } from "@/components/chat/media-preview-dialog";

import {
  ArrowRight,
  Send,
  Check,
  CheckCheck,
  Clock,
  Phone,
  Mail,
  MapPin,
  Building2,
  Tag,
  Calendar,
  DollarSign,
  MessageSquare,
  Pencil,
  Search,
  UserPlus,
  Layers,
  Lock,
  Paperclip,
  RefreshCw,
  Smile,
  Mic,
  StopCircle,
  X,
  Image as ImageIcon,
  Film,
  FileUp,
  Trash2 as TrashIcon,
  ChevronDown,
  Play,
  Pause,
  Info,
  Reply,
  Forward,
  Pin,
  Star,
} from "lucide-react";
import { getOpportunityWorkspace, updateContactName, addOppNote, listOppNotes, addOppTag, updateOpportunity, softDeleteOpportunity } from "@/modules/crm";
import { usePermission } from "@/platform/rbac/use-permission";
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
import { moveOpportunityToStage } from "@/modules/crm";
import { listFiles, createUploadUrl, registerFile, deleteFile } from "@/modules/crm/files.functions";
import { listMembers, listDepartments } from "@/modules/organization";
import { quickAssignOpportunity } from "@/modules/assignments/lead-assignments.functions";
import { listPipelines } from "@/modules/crm";
import { getMergedChatForOpportunity, sendMessageFn, sendMediaMessageFn, deleteMessageFn, editMessageFn, syncOpportunityHistory, reactToMessageFn } from "@/modules/messaging";
import { ForwardDialog } from "@/components/chat/forward-dialog";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Download, FileText, FileImage, FileVideo, FileAudio, File as FileIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { markSelfSend } from "@/lib/self-send-guard";

export const Route = createFileRoute("/_authenticated/pipeline/$oppId")({
  head: () => ({
    meta: [
      { title: "تفاصيل الفرصة - قمع المبيعات" },
      { name: "description", content: "بطاقة تذكرة المبيعات مع شات العميل والفرص المجاورة." },
    ],
  }),
  component: PipelineOppDetail,
});

function PipelineOppDetail() {
  const { oppId } = Route.useParams();
  const nav = useNavigate();
  const getWs = useServerFn(getOpportunityWorkspace);

  const wsQ = useQuery({
    queryKey: ["opp-workspace", oppId],
    queryFn: () => getWs({ data: { opportunityId: oppId } }),
  });

  if (wsQ.isLoading) {
    return <div className="p-6 text-muted-foreground">جارٍ التحميل...</div>;
  }
  if (!wsQ.data) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-muted-foreground">الفرصة غير موجودة.</p>
        <Button variant="outline" className="mt-4" onClick={() => nav({ to: "/pipeline" })}>
          العودة للقمع
        </Button>
      </div>
    );
  }

  const ws = wsQ.data;

  return (
    <div className="h-screen flex flex-col min-h-0" dir="rtl">
      {/* Top bar */}
      <div className="border-b bg-card px-4 py-2 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => nav({ to: "/pipeline" })}>
          <ArrowRight className="h-4 w-4 ml-1" /> القمع
        </Button>
        <div className="text-sm text-muted-foreground">/</div>
        <div className="font-semibold text-sm truncate">{ws.contact?.name ?? "—"}</div>
        {ws.opportunity.stage_name && (
          <Badge
            variant="outline"
            className="gap-1"
            style={{ borderColor: ws.opportunity.stage_color ?? undefined }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: ws.opportunity.stage_color ?? "#94a3b8" }}
            />
            {ws.opportunity.stage_name}
          </Badge>
        )}
        {ws.channel && (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <ChannelIcon channel={ws.channel} /> {ws.channel}
          </Badge>
        )}
        <div className="ms-auto flex items-center gap-2">
          <SyncHistoryButton oppId={oppId} />
          <DeleteOpportunityButton oppId={oppId} contactName={ws.contact?.name ?? null} onDeleted={() => nav({ to: "/pipeline" })} />
        </div>
      </div>


      {/* Three-column layout (RTL): Siblings on right (first), Chat middle, Info on left (last) */}
      <div className="flex-1 flex min-h-0">
        {/* Right column (first in RTL DOM order): siblings in same stage */}
        <SiblingsColumn currentId={oppId} siblings={ws.siblings} stageName={ws.opportunity.stage_name} />

        {/* Middle: merged chat */}
        <div className="flex-1 flex flex-col min-w-0 bg-muted/10 border-x">
          <MergedChatPane opportunityId={oppId} contact={ws.contact} owner={ws.owner} />
        </div>

        {/* Left column (last in RTL DOM order): contact info + quick actions */}
        <ContactColumn ws={ws} oppId={oppId} />
      </div>
    </div>
  );
}

/* ------------------------ Channel Icon ------------------------ */

function ChannelIcon({ channel }: { channel: string | null }) {
  if (!channel) return null;
  const ch = channel.toLowerCase();
  if (ch.includes("whatsapp"))
    return <span className="text-emerald-600 text-[10px]">●</span>;
  if (ch.includes("meta") || ch.includes("facebook"))
    return <span className="text-blue-600 text-[10px]">●</span>;
  return <span className="text-slate-500 text-[10px]">●</span>;
}

/* ------------------------ Left: Contact + Actions ------------------------ */

function ContactColumn({ ws, oppId }: { ws: any; oppId: string }) {
  const c = ws.contact;
  const o = ws.opportunity;
  const qc = useQueryClient();

  const listAgents = useServerFn(listMembers);
  const listDepts = useServerFn(listDepartments);
  const listPipes = useServerFn(listPipelines);
  const doQuickAssign = useServerFn(quickAssignOpportunity);
  const doMove = useServerFn(moveOpportunityToStage);
  const doNote = useServerFn(addOppNote);
  const doTag = useServerFn(addOppTag);
  const getNotes = useServerFn(listOppNotes);
  const doUpdate = useServerFn(updateOpportunity);

  // Reference data barely changes — cache it across tickets so re-opening a
  // ticket doesn't re-fetch members/departments/pipelines every time.
  const REF = { staleTime: 10 * 60 * 1000, gcTime: 30 * 60 * 1000, refetchOnWindowFocus: false } as const;
  const membersQ = useQuery({ queryKey: ["all-members"], queryFn: () => listAgents({ data: {} }), ...REF });
  const deptsQ = useQuery({ queryKey: ["departments"], queryFn: () => listDepts(), ...REF });
  const pipesQ = useQuery({ queryKey: ["pipelines"], queryFn: () => listPipes(), ...REF });
  const notesQ = useQuery({
    queryKey: ["opp-notes", oppId],
    queryFn: () => getNotes({ data: { opportunityId: oppId } }),
    staleTime: 60 * 1000,
  });


  const [noteBody, setNoteBody] = useState("");
  const [tagName, setTagName] = useState("");

  const stages = useMemo(() => {
    const p = (pipesQ.data ?? []).find((x: any) => x.id === (o as any).pipeline_id) ?? (pipesQ.data ?? [])[0];
    return p?.stages ?? [];
  }, [pipesQ.data, o]);

  const assignMut = useMutation({
    mutationFn: async (userId: string) =>
      doQuickAssign({ data: { opportunityId: oppId, toUserId: userId } }),
    onSuccess: () => {
      toast.success("تم الإسناد");
      qc.invalidateQueries({ queryKey: ["opp-workspace", oppId] });
      qc.invalidateQueries({ queryKey: ["pipeline-board"] });
      qc.invalidateQueries({ queryKey: ["merged-chat", oppId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل الإسناد"),
  });

  const moveMut = useMutation({
    mutationFn: (stageId: string) => doMove({ data: { opportunityId: oppId, stageId } }),
    onSuccess: () => {
      toast.success("تم تغيير المرحلة");
      qc.invalidateQueries({ queryKey: ["opp-workspace", oppId] });
      qc.invalidateQueries({ queryKey: ["pipeline-board"] });
    },
  });

  const noteMut = useMutation({
    mutationFn: () => doNote({ data: { opportunityId: oppId, body: noteBody } }),
    onSuccess: () => {
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["opp-notes", oppId] });
      toast.success("تمت إضافة الملاحظة");
    },
  });

  const tagMut = useMutation({
    mutationFn: () => doTag({ data: { opportunityId: oppId, name: tagName } }),
    onSuccess: () => {
      setTagName("");
      qc.invalidateQueries({ queryKey: ["opp-workspace", oppId] });
    },
  });

  return (
    <aside className="w-[340px] shrink-0 overflow-y-auto bg-background p-4 space-y-4 border-r">
      {/* Quick actions bar */}
      <div className="grid grid-cols-2 gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="default" className="gap-1">
              <UserPlus className="h-3.5 w-3.5" /> إسناد
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>اختر مندوب</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(membersQ.data ?? []).map((m: any) => (
              <DropdownMenuItem key={m.id} onClick={() => assignMut.mutate(m.user_id)}>
                {m.profile_name ?? m.display_name ?? "—"}
              </DropdownMenuItem>
            ))}
            {(!membersQ.data || membersQ.data.length === 0) && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">لا يوجد مناديب</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <Layers className="h-3.5 w-3.5" /> المرحلة
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>نقل إلى</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {stages.map((s: any) => (
              <DropdownMenuItem key={s.id} onClick={() => moveMut.mutate(s.id)}>
                <span className="w-2 h-2 rounded-full ml-2" style={{ background: s.color }} />
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <Building2 className="h-3.5 w-3.5" /> القسم
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{ws.department?.name ?? "بدون قسم"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await doUpdate({ data: { opportunityId: oppId, departmentId: null } as any });
                  toast.success("تم إزالة القسم");
                  qc.invalidateQueries({ queryKey: ["opp-workspace", oppId] });
                  qc.invalidateQueries({ queryKey: ["pipeline-board"] });
                } catch (e: any) {
                  toast.error(e?.message ?? "فشل");
                }
              }}
            >
              — بدون قسم —
            </DropdownMenuItem>
            {(deptsQ.data ?? []).map((d: any) => (
              <DropdownMenuItem
                key={d.id}
                onClick={async () => {
                  try {
                    await doUpdate({ data: { opportunityId: oppId, departmentId: d.id } as any });
                    toast.success(`تم تغيير القسم إلى ${d.name}`);
                    qc.invalidateQueries({ queryKey: ["opp-workspace", oppId] });
                    qc.invalidateQueries({ queryKey: ["pipeline-board"] });
                  } catch (e: any) {
                    toast.error(e?.message ?? "فشل تغيير القسم");
                  }
                }}
              >
                {d.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <FilesPopover oppId={oppId} />
      </div>

      {/* Avatar / name header */}
      <div className="text-center pt-2">
        <Avatar className="h-16 w-16 mx-auto">
          {c?.avatar_url && <AvatarImage src={c.avatar_url} />}
          <AvatarFallback className="text-2xl">{(c?.name ?? "?").charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <EditableName contactId={c?.id} initial={c?.name ?? ""} />
        {c?.phone && (
          <div className="text-xs text-muted-foreground font-mono mt-0.5" dir="ltr">
            +{String(c.phone).replace(/^\+/, "")}
          </div>
        )}
      </div>

      <Section title="بيانات الاتصال">
        <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="الهاتف" value={c?.phone ?? "—"} />
        <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="البريد" value={c?.email ?? "—"} />
        <InfoRow
          icon={<MapPin className="h-3.5 w-3.5" />}
          label="الموقع"
          value={[c?.city, c?.country].filter(Boolean).join("، ") || "—"}
        />
      </Section>

      <Section title="الفرصة">
        <InfoRow icon={<Tag className="h-3.5 w-3.5" />} label="المصدر" value={o.source ?? "—"} />
        <InfoRow
          icon={<DollarSign className="h-3.5 w-3.5" />}
          label="القيمة"
          value={o.value != null ? `${o.value} ${o.currency ?? ""}` : "—"}
        />
        <InfoRow
          icon={<Calendar className="h-3.5 w-3.5" />}
          label="افتُتحت"
          value={new Date(o.opened_at).toLocaleDateString("ar")}
        />
        {ws.channel && <InfoRow icon={<MessageSquare className="h-3.5 w-3.5" />} label="القناة" value={ws.channel} />}
      </Section>

      <Section title="الفريق">
        <div className="flex items-center gap-2 text-xs">
          <Avatar className="h-6 w-6">
            {ws.owner?.avatar_url && <AvatarImage src={ws.owner.avatar_url} />}
            <AvatarFallback className="text-[10px]">
              {ws.owner?.name?.charAt(0) ?? "?"}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium">{ws.owner?.name ?? "غير مسند"}</span>
        </div>
        <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="القسم" value={ws.department?.name ?? "—"} />
      </Section>

      <Section title="التاغز">
        <div className="flex flex-wrap gap-1">
          {(ws.tags ?? []).map((t: any) => (
            <Badge key={t.id} variant="secondary" style={{ background: (t.color ?? "#94a3b8") + "22", color: t.color }}>
              {t.name}
            </Badge>
          ))}
        </div>
        <div className="flex gap-1 mt-2">
          <Input
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            placeholder="اسم التاغ"
            className="h-7 text-xs"
          />
          <Button size="sm" variant="outline" className="h-7" onClick={() => tagName.trim() && tagMut.mutate()}>
            +
          </Button>
        </div>
      </Section>

      <FilesGallery oppId={oppId} />

      <Section title="ملاحظات">
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {(notesQ.data ?? []).map((n: any) => (
            <div key={n.id} className="text-xs bg-background rounded p-2 border">
              <div className="text-muted-foreground text-[10px] mb-0.5">{n.author_name ?? "—"}</div>
              <div className="whitespace-pre-wrap">{n.body}</div>
            </div>
          ))}
          {(!notesQ.data || notesQ.data.length === 0) && (
            <div className="text-xs text-muted-foreground text-center py-2">لا يوجد</div>
          )}
        </div>
        <Textarea
          id="note-input"
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          placeholder="أضف ملاحظة..."
          rows={2}
          className="mt-2 text-xs"
        />
        <Button
          size="sm"
          className="mt-1 w-full"
          disabled={!noteBody.trim() || noteMut.isPending}
          onClick={() => noteMut.mutate()}
        >
          حفظ
        </Button>
      </Section>

      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to="/opportunities/$oppId" params={{ oppId: o.id }}>
          عرض الفرصة الكاملة
        </Link>
      </Button>
    </aside>
  );
}

function EditableName({ contactId, initial }: { contactId?: string; initial: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const qc = useQueryClient();
  const upd = useServerFn(updateContactName);

  useEffect(() => setValue(initial), [initial]);

  const mut = useMutation({
    mutationFn: () => upd({ data: { contactId: contactId!, name: value } }),
    onSuccess: () => {
      setEditing(false);
      toast.success("تم تحديث الاسم");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل"),
  });

  if (!contactId) return <div className="mt-3 font-semibold">{initial || "بدون اسم"}</div>;
  if (editing) {
    return (
      <div className="mt-3 flex gap-1 items-center">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 text-sm"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && mut.mutate()}
        />
        <Button size="sm" className="h-7" onClick={() => mut.mutate()} disabled={mut.isPending}>
          <Check className="h-3 w-3" />
        </Button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className="mt-3 font-semibold flex items-center gap-1 mx-auto hover:text-primary group"
    >
      {initial || "بدون اسم"}
      <Pencil className="h-3 w-3 opacity-40 group-hover:opacity-100" />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{title}</div>
      <div className="space-y-1 bg-muted/30 rounded-md p-2.5">{children}</div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground w-14 shrink-0">{label}:</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function quotedPreviewText(snap: any): string {
  if (!snap) return "";
  if (snap.content) return String(snap.content).slice(0, 120);
  switch (snap.message_type) {
    case "image": return "📷 صورة";
    case "video": return "🎬 فيديو";
    case "audio": return "🎙️ رسالة صوتية";
    case "document": return `📎 ${snap.media_meta?.file_name ?? "ملف"}`;
    default: return "رسالة";
  }
}

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/* ------------------------ Middle: Merged Chat (all numbers → same contact) ------------------------ */

function MergedChatPane({
  opportunityId,
  contact,
  owner,
}: {
  opportunityId: string;
  contact: any;
  owner: any;
}) {
  const qc = useQueryClient();
  const fetchMerged = useServerFn(getMergedChatForOpportunity);
  const send = useServerFn(sendMessageFn);
  const doDeleteMsg = useServerFn(deleteMessageFn);
  const deleteMsgMut = useMutation({
    mutationFn: (messageId: string) => doDeleteMsg({ data: { messageId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["merged-chat", opportunityId] }),
    onError: (e: any) => toast.error(e?.message ?? "فشل حذف الرسالة"),
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["merged-chat", opportunityId],
    queryFn: () => fetchMerged({ data: { opportunityId } }),
    // Realtime keeps this fresh; polling is only a safety net.
    refetchInterval: 20000,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });

  const primarySessionId: string | null = data?.primary_session_id ?? null;
  const sessionIds: string[] = (data?.sessions ?? []).map((s: any) => s.id);

  useEffect(() => {
    if (sessionIds.length === 0) return;
    const ch = supabase
      .channel(`merged-${opportunityId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "msg_messages" },
        (payload: any) => {
          const sid = (payload.new ?? payload.old)?.session_id;
          if (sid && sessionIds.includes(sid)) {
            qc.invalidateQueries({ queryKey: ["merged-chat", opportunityId] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [opportunityId, sessionIds.join("|"), qc]);

  const [text, setText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [replyTo, setReplyTo] = useState<any>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  function jumpToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      toast.info("الرسالة الأصلية غير محمّلة في هذه الشاشة");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 2200);
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // Emoji reactions + forwarding (WhatsApp-style).
  const [forwardId, setForwardId] = useState<string | null>(null);
  const doReact = useServerFn(reactToMessageFn);
  const reactMut = useMutation({
    mutationFn: (v: { messageId: string; emoji: string }) => doReact({ data: v }),
    onMutate: (v) => {
      qc.setQueryData(["merged-chat", opportunityId], (old: any) =>
        old
          ? {
              ...old,
              messages: (old.messages ?? []).map((m: any) =>
                m.id === v.messageId
                  ? {
                      ...m,
                      reactions: [
                        ...((m.reactions ?? []).filter((r: any) => !r?.__mine)),
                        ...(v.emoji ? [{ emoji: v.emoji, name: "أنت", __mine: true }] : []),
                      ],
                    }
                  : m,
              ),
            }
          : old,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["merged-chat", opportunityId] }),
    onError: (e: any) => {
      toast.error(e?.message ?? "فشل التفاعل");
      qc.invalidateQueries({ queryKey: ["merged-chat", opportunityId] });
    },
  });

  const doEditMsg = useServerFn(editMessageFn);
  const editMsgMut = useMutation({
    mutationFn: (v: { messageId: string; text: string }) => doEditMsg({ data: v }),
    onSuccess: () => {
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["merged-chat", opportunityId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل تعديل الرسالة"),
  });

  const sendMut = useMutation({
    mutationFn: (payload: { text: string; isInternal: boolean; replyToMessageId?: string }) => {
      if (!primarySessionId) throw new Error("لا توجد جلسة مرتبطة بعد. قم بإسناد الفرصة أولاً لبدء المحادثة.");
      markSelfSend();
      return send({ data: { chatId: primarySessionId, text: payload.text, isInternal: payload.isInternal, replyToMessageId: payload.replyToMessageId } as any });
    },
    onMutate: async (payload) => {
      // No cancelQueries/await here: the optimistic bubble must appear in the
      // same frame the user hits Enter.
      const tmpId = `tmp-${Date.now()}`;
      const optimistic = {
        id: tmpId,
        session_id: primarySessionId,
        content: payload.text,
        message_type: "text",
        from_me: true,
        direction: "outbound",
        is_internal: payload.isInternal,
        status: "sending",
        created_at: new Date().toISOString(),
        _optimistic: true,
      };
      qc.setQueryData(["merged-chat", opportunityId], (old: any) =>
        old ? { ...old, messages: [...(old.messages ?? []), optimistic] } : old,
      );
      return { tmpId };
    },
    onSuccess: (res: any, _v, ctx) => {
      // Swap the placeholder for the persisted row instead of refetching.
      qc.setQueryData(["merged-chat", opportunityId], (old: any) =>
        old
          ? {
              ...old,
              messages: (old.messages ?? []).map((m: any) =>
                m.id === ctx?.tmpId ? { ...m, ...res, _optimistic: false, status: res?.status ?? "sent" } : m,
              ),
            }
          : old,
      );
    },
    onError: (e, _v, ctx) => {
      // Keep the bubble visible and mark it failed (do not roll it back).
      qc.setQueryData(["merged-chat", opportunityId], (old: any) =>
        old
          ? {
              ...old,
              messages: (old.messages ?? []).map((m: any) =>
                m.id === ctx?.tmpId ? { ...m, status: "failed", _optimistic: false } : m,
              ),
            }
          : old,
      );
      toast.error(e instanceof Error ? e.message : "فشل الإرسال");
    },

  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data?.messages?.length]);

  const filteredMessages = useMemo(() => {
    if (!search.trim()) return data?.messages ?? [];
    const s = search.toLowerCase();
    return (data?.messages ?? []).filter((m: any) =>
      String(m.content ?? "").toLowerCase().includes(s)
    );
  }, [data?.messages, search]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* WhatsApp-style header with avatar/name/phone + agent badge */}
      <div className="border-b bg-card px-4 py-2.5 flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {contact?.avatar_url && <AvatarImage src={contact.avatar_url} />}
          <AvatarFallback>{(contact?.name ?? "?").charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{contact?.name ?? "—"}</div>
          {contact?.phone && (
            <div className="text-[11px] text-muted-foreground font-mono" dir="ltr">
              +{String(contact.phone).replace(/^\+/, "")}
            </div>
          )}
        </div>
        {owner && (
          <div className="flex items-center gap-1.5 bg-muted rounded-full pl-2 pr-1 py-0.5">
            <span className="text-[10px] text-muted-foreground">مسند إلى</span>
            <Avatar className="h-6 w-6">
              {owner.avatar_url && <AvatarImage src={owner.avatar_url} />}
              <AvatarFallback className="text-[9px]">{owner.name?.charAt(0) ?? "?"}</AvatarFallback>
            </Avatar>
            <span className="text-[11px] font-medium max-w-[80px] truncate">{owner.name}</span>
          </div>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearchOpen((v) => !v)}>
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {searchOpen && (
        <div className="border-b bg-muted/20 px-3 py-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في الرسائل..."
            className="h-8"
            autoFocus
          />
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#ece5dd]/30">
        {!data ? (
          <div className="text-center text-muted-foreground text-sm py-12">جارٍ التحميل...</div>
        ) : filteredMessages.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-12">
            {search ? "لا يوجد نتائج" : "لا توجد رسائل بعد"}
          </div>
        ) : (
          filteredMessages.map((m: any) => {
            const kind = m.message_type ?? "text";
            const isDeleted = m.status === "deleted";
            const hasMedia = !isDeleted && kind !== "text" && m.media_url;
            return (
            <div
              key={m.id}
              id={`msg-${m.id}`}
              className={cn(
                "group flex items-center gap-1 rounded-lg transition-colors duration-500",
                m.from_me ? "justify-start" : "justify-end",
                highlightId === m.id && "bg-emerald-300/40 ring-2 ring-emerald-400"
              )}
            >

              {!m.is_internal && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-black/10">
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
                    <DropdownMenuItem disabled><Info className="h-3.5 w-3.5 ml-2" /> معلومات الرسالة</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setReplyTo(m)}>
                      <Reply className="h-3.5 w-3.5 ml-2" /> رد
                    </DropdownMenuItem>
                    <div className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        {REACTION_EMOJIS.map((emo) => {
                          const mine = (m.reactions ?? []).some((r: any) => (r?.__mine || r?.mine) && r?.emoji === emo);
                          return (
                            <button
                              key={emo}
                              type="button"
                              onClick={() => reactMut.mutate({ messageId: m.id, emoji: mine ? "" : emo })}
                              className={cn(
                                "h-7 w-7 rounded-full text-base leading-none hover:bg-muted transition",
                                mine && "bg-emerald-100 ring-1 ring-emerald-400",
                              )}
                            >
                              {emo}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    {hasMedia && (
                      <DropdownMenuItem asChild>
                        <a href={m.media_url} download target="_blank" rel="noreferrer">
                          <Download className="h-3.5 w-3.5 ml-2" /> تنزيل
                        </a>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      disabled={isDeleted || String(m.id).startsWith("tmp-")}
                      onClick={() => setForwardId(m.id)}
                    >
                      <Forward className="h-3.5 w-3.5 ml-2" /> إعادة توجيه
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled><Pin className="h-3.5 w-3.5 ml-2" /> تثبيت</DropdownMenuItem>
                    <DropdownMenuItem disabled><Star className="h-3.5 w-3.5 ml-2" /> إضافة للنجوم</DropdownMenuItem>
                    {m.from_me && !isDeleted && kind === "text" && (
                      <DropdownMenuItem onClick={() => { setEditingId(m.id); setEditingText(m.content ?? ""); }}>
                        <Pencil className="h-3.5 w-3.5 ml-2" /> تعديل
                      </DropdownMenuItem>
                    )}
                    {m.from_me && !isDeleted && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600"
                          onClick={() => {
                            if (confirm("حذف الرسالة من الطرفين؟")) deleteMsgMut.mutate(m.id);
                          }}
                        >
                          <TrashIcon className="h-3.5 w-3.5 ml-2" /> حذف
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <div
                className={cn(
                  "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                  isDeleted
                    ? "bg-red-50 text-red-600 italic border border-red-300"
                    : m.is_internal
                    ? "bg-amber-50 border border-amber-200 text-amber-900 rounded-md"
                    : m.from_me
                    ? "bg-emerald-600 text-white rounded-br-md"
                    : "bg-white border rounded-bl-md"
                )}
              >
                {isDeleted ? (
                  <div className="flex items-center gap-1 text-xs">
                    <TrashIcon className="h-3 w-3" /> تم حذف هذه الرسالة
                  </div>
                ) : (
                <>
                {m.reply_to_snapshot && (
                  <div
                    role={m.reply_to_message_id ? "button" : undefined}
                    onClick={() => m.reply_to_message_id && jumpToMessage(m.reply_to_message_id)}
                    className={cn(
                      "border-r-4 px-2 py-1 mb-1.5 rounded text-[11px] leading-tight",
                      m.reply_to_message_id && "cursor-pointer hover:opacity-80",
                      m.from_me ? "bg-white/15 border-white/60" : "bg-emerald-50 border-emerald-500"
                    )}
                  >
                    <div className={cn("font-semibold text-[10px] mb-0.5", m.from_me ? "text-white/90" : "text-emerald-700")}>
                      {m.reply_to_snapshot.from_me ? "أنت" : (contact?.name ?? "العميل")}
                    </div>
                    <div className={cn("truncate", m.from_me ? "text-white/80" : "text-muted-foreground")}>
                      {quotedPreviewText(m.reply_to_snapshot)}
                    </div>
                  </div>
                )}

                {m.is_internal && (
                  <div className="flex items-center gap-1 text-[10px] font-semibold mb-1 opacity-80">
                    <Lock className="h-2.5 w-2.5" /> ملاحظة داخلية للفريق
                  </div>
                )}
                {m.from_me && !m.is_internal && (m.agent?.name || m.account_name) && (
                  <div className="flex items-center gap-1 text-[10px] font-semibold mb-1 opacity-90">
                    {m.agent?.avatar_url && (
                      <img src={m.agent.avatar_url} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                    )}
                    <span>{m.agent?.name ?? "المندوب"}</span>
                    {m.account_name && <span className="opacity-70">· {m.account_name}</span>}
                  </div>
                )}
                {!m.from_me && !m.is_internal && m.account_name && (
                  <div className="text-[10px] font-semibold mb-1 opacity-70 text-emerald-700">
                    وصلت على: {m.account_name}
                  </div>
                )}
                {hasMedia && kind === "image" && (
                  <a href={m.media_url} target="_blank" rel="noreferrer" className="block mb-1">
                    <img src={m.media_url} alt="" className="rounded-lg max-h-72 object-cover" />
                  </a>
                )}
                {hasMedia && kind === "video" && (
                  <video src={m.media_url} controls className="rounded-lg max-h-72 mb-1 w-full" />
                )}
                {hasMedia && kind === "audio" && (
                  <VoicePlayer src={m.media_url} fromMe={!!m.from_me} />
                )}
                {hasMedia && kind === "document" && (
                  <a
                    href={m.media_url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 mb-1 text-xs",
                      m.from_me ? "bg-emerald-700/40" : "bg-muted"
                    )}
                  >
                    <Paperclip className="h-4 w-4" />
                    <span className="truncate">{m.media_meta?.file_name ?? "ملف"}</span>
                  </a>
                )}
                {m.content && editingId !== m.id && (
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                )}
                {editingId === m.id && (
                  <div className="flex items-center gap-1 my-1">
                    <Input
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      autoFocus
                      className="h-8 text-sm text-foreground bg-background"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editingText.trim()) {
                          editMsgMut.mutate({ messageId: m.id, text: editingText.trim() });
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={!editingText.trim() || editMsgMut.isPending}
                      onClick={() => editMsgMut.mutate({ messageId: m.id, text: editingText.trim() })}
                    >
                      حفظ
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>
                      إلغاء
                    </Button>
                  </div>
                )}
                <div
                  className={cn(
                    "text-[10px] mt-1 flex items-center gap-1 opacity-80",
                    !m.from_me && !m.is_internal && "text-muted-foreground"
                  )}
                >
                  <span>
                    {new Date(m.created_at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {m.edited_at && <span className="opacity-70">· تم التعديل</span>}
                  {m.from_me &&
                    !m.is_internal &&
                    (m.status === "read" ? (
                      <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" />
                    ) : m.status === "delivered" ? (
                      <CheckCheck className="h-3.5 w-3.5" />
                    ) : m.status === "failed" ? (
                      <span className="text-red-200">فشل</span>
                    ) : m.status === "sending" || m.status === "queued" ? (
                      <Clock className="h-3 w-3" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    ))}

                </div>
                {Array.isArray(m.reactions) && m.reactions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(
                      (m.reactions as any[]).reduce((acc: Record<string, number>, r: any) => {
                        if (r?.emoji) acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
                        return acc;
                      }, {}),
                    ).map(([emo, count]) => (
                      <button
                        key={emo}
                        type="button"
                        title={(m.reactions as any[]).filter((r: any) => r?.emoji === emo).map((r: any) => r?.name ?? "").join("، ")}
                        onClick={() => reactMut.mutate({ messageId: m.id, emoji: emo })}
                        className={cn(
                          "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] leading-none border",
                          m.from_me ? "bg-white/20 border-white/30" : "bg-white border-muted",
                        )}
                      >
                        <span>{emo}</span>
                        {(count as number) > 1 && <span className="opacity-80">{count as number}</span>}
                      </button>
                    ))}
                  </div>
                )}
                </>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>

      <ChatComposer
        chatId={primarySessionId}
        text={text}
        setText={setText}
        isInternal={isInternal}
        setIsInternal={setIsInternal}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        contactName={contact?.name ?? "العميل"}
        onSendText={() => {
          if (text.trim()) {
            const t = text.trim();
            const ii = isInternal;
            const rid = replyTo?.id && !String(replyTo.id).startsWith("tmp-") ? replyTo.id : undefined;
            setText("");
            setReplyTo(null);
            sendMut.mutate({ text: t, isInternal: ii, replyToMessageId: rid });
          }
        }}
        sending={sendMut.isPending}
        opportunityId={opportunityId}
      />

      <ForwardDialog
        open={Boolean(forwardId)}
        onOpenChange={(v) => !v && setForwardId(null)}
        messageId={forwardId}
      />
    </div>
  );
}

/* ------------------------ Composer with emoji / attachments / voice ------------------------ */

const COMMON_EMOJI = [
  "😀","😁","😂","🤣","😊","😍","😘","😉","😎","🤔",
  "😏","😐","😢","😭","😡","🥰","🤩","🤗","🙏","👍",
  "👎","👏","🙌","💪","🔥","💯","✨","🎉","❤️","💔",
  "💕","💖","😴","🤝","👋","🤷","🤦","🙋","✅","❌",
  "⏰","📞","📱","📩","📎","🎁","💰","🛒","🚀","🌟",
];

function ChatComposer({
  chatId,
  text,
  setText,
  isInternal,
  setIsInternal,
  onSendText,
  sending,
  opportunityId,
  replyTo,
  onCancelReply,
  contactName,
}: {
  chatId: string | null;
  text: string;
  setText: (v: string) => void;
  isInternal: boolean;
  setIsInternal: (v: boolean | ((p: boolean) => boolean)) => void;
  onSendText: () => void;
  sending: boolean;
  opportunityId: string;
  replyTo?: any;
  onCancelReply?: () => void;
  contactName?: string;
}) {
  const qc = useQueryClient();
  const sendMedia = useServerFn(sendMediaMessageFn);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [previewCaption, setPreviewCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});

  const mediaMut = useMutation({
    mutationFn: (payload: {
      kind: "image" | "video" | "audio" | "document";
      fileName: string;
      mimeType: string;
      base64: string;
      caption?: string;
    }) => {
      if (!chatId) throw new Error("لا توجد جلسة مرتبطة. قم بإسناد الفرصة أولاً.");
      markSelfSend();
      const rid = replyTo?.id && !String(replyTo.id).startsWith("tmp-") ? replyTo.id : undefined;
      return sendMedia({ data: { chatId, ...payload, replyToMessageId: rid } as any });
    },
    onSuccess: () => {
      onCancelReply?.();
      qc.invalidateQueries({ queryKey: ["merged-chat", opportunityId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل الإرسال"),
  });

  async function fileToBase64(file: Blob, onPct?: (p: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onprogress = (ev) => {
        if (ev.lengthComputable && onPct) onPct(Math.round((ev.loaded / ev.total) * 40));
      };
      r.onload = () => {
        onPct?.(40);
        const s = String(r.result ?? "");
        const i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error(`${file.name}: الحد الأقصى 20MB`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    setPreviewItems((prev) => [...prev, ...makeItems(accepted)]);
    setPreviewCaption((c) => c || text.trim());
    setText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closePreview() {
    setPreviewItems([]);
    setPreviewCaption("");
    setProgress({});
    setUploading(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function sendPreviewItems() {
    if (previewItems.length === 0) return;
    setUploading(true);
    setProgress(Object.fromEntries(previewItems.map((i) => [i.id, 0])));
    let failed = 0;
    for (let idx = 0; idx < previewItems.length; idx++) {
      const item = previewItems[idx];
      try {
        const base64 = await fileToBase64(item.file, (p) =>
          setProgress((prev) => ({ ...prev, [item.id]: p }))
        );
        // Animate the remaining share while the request is in flight.
        const timer = window.setInterval(() => {
          setProgress((prev) => {
            const cur = prev[item.id] ?? 40;
            return cur >= 95 ? prev : { ...prev, [item.id]: cur + 3 };
          });
        }, 120);
        try {
          await mediaMut.mutateAsync({
            kind: item.kind,
            fileName: item.file.name,
            mimeType: item.file.type || "application/octet-stream",
            base64,
            caption: idx === 0 ? previewCaption.trim() || undefined : undefined,
          });
          setProgress((prev) => ({ ...prev, [item.id]: 100 }));
        } finally {
          window.clearInterval(timer);
        }
      } catch {
        failed++;
      }
    }
    if (failed > 0) toast.error(`فشل إرسال ${failed} ملف`);
    closePreview();
  }


  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (recTimerRef.current) window.clearInterval(recTimerRef.current);
        setRecSec(0);
        if (blob.size < 500) return;
        const base64 = await fileToBase64(blob);
        mediaMut.mutate({
          kind: "audio",
          fileName: `voice-${Date.now()}.webm`,
          mimeType: mime,
          base64,
        });
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
      recTimerRef.current = window.setInterval(() => setRecSec((s) => s + 1), 1000);
    } catch (e: any) {
      toast.error("تعذّر الوصول للميكروفون. تحقق من الأذونات.");
    }
  }

  function stopRecording(send = true) {
    const rec = mediaRecRef.current;
    if (!rec) return;
    if (!send) {
      chunksRef.current = [];
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (recTimerRef.current) window.clearInterval(recTimerRef.current);
        setRecSec(0);
      };
    }
    rec.stop();
    setRecording(false);
  }

  // Keep the caret in the composer: focus on mount, when a reply is picked,
  // and right after sending so typing never requires a mouse click.
  // Radix restores focus to the dropdown trigger on close, so retry a few times.
  useEffect(() => {
    if (recording || previewItems.length > 0) return;
    const ids = [0, 60, 180].map((d) =>
      window.setTimeout(() => {
        const el = textareaRef.current;
        if (el && document.activeElement !== el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }, d)
    );
    return () => ids.forEach((i) => window.clearTimeout(i));
  }, [replyTo, chatId, recording, previewItems.length]);

  return (
    <>
    {previewItems.length > 0 && (
      <MediaPreviewDialog
        items={previewItems}
        setItems={setPreviewItems}
        caption={previewCaption}
        setCaption={setPreviewCaption}
        onCancel={closePreview}
        onSend={sendPreviewItems}
        sending={uploading}
        progress={progress}
        onAddMore={() => fileInputRef.current?.click()}
      />
    )}
    {replyTo && (

      <div className="px-3 py-2 border-t bg-muted/60 flex items-center gap-2">
        <div className="w-1 self-stretch bg-emerald-500 rounded" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-emerald-700">
            رد على {replyTo.from_me ? "أنت" : (contactName ?? "العميل")}
          </div>
          <div className="text-xs truncate text-muted-foreground">
            {quotedPreviewText({
              content: replyTo.content,
              message_type: replyTo.message_type,
              media_meta: replyTo.media_meta,
            })}
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onCancelReply}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    )}
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSendText();
        requestAnimationFrame(() => textareaRef.current?.focus());
      }}
      className={cn(
        "p-3 border-t flex gap-2 items-end",
        isInternal ? "bg-amber-50/50" : "bg-card"
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
        onChange={(e) => handleFileSelect(e.target.files)}
      />

      <Button
        type="button"
        variant={isInternal ? "default" : "ghost"}
        size="icon"
        className={cn("h-9 w-9 shrink-0", isInternal && "bg-amber-500 hover:bg-amber-600")}
        onClick={() => setIsInternal((v) => !v)}
        title={isInternal ? "رسالة داخلية" : "رسالة للعميل"}
      >
        <Lock className="h-4 w-4" />
      </Button>

      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="إيموجي">
            <Smile className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" side="top" align="start">
          <div className="grid grid-cols-8 gap-0.5 max-h-56 overflow-y-auto">
            {COMMON_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                className="text-xl hover:bg-muted rounded p-1"
                onClick={() => {
                  setText(text + e);
                  setEmojiOpen(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => fileInputRef.current?.click()}
        disabled={mediaMut.isPending || isInternal}
        title="إرفاق ملف/صورة/فيديو"
      >
        <Paperclip className="h-4 w-4" />
      </Button>

      {recording ? (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-destructive"
            onClick={() => stopRecording(false)}
            title="إلغاء التسجيل"
          >
            <X className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono tabular-nums">
              {String(Math.floor(recSec / 60)).padStart(2, "0")}:{String(recSec % 60).padStart(2, "0")}
            </span>
          </div>
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 bg-red-500 hover:bg-red-600"
            onClick={() => stopRecording(true)}
            title="إرسال"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={startRecording}
          disabled={mediaMut.isPending || isInternal}
          title="تسجيل رسالة صوتية"
        >
          <Mic className="h-4 w-4" />
        </Button>
      )}

      <Textarea
        ref={textareaRef}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSendText();
            requestAnimationFrame(() => textareaRef.current?.focus());
          }
        }}
        rows={1}
        placeholder={
          recording
            ? "جارٍ التسجيل..."
            : isInternal
            ? "ملاحظة داخلية لن يراها العميل..."
            : "اكتب رسالة..."
        }
        disabled={recording}
        className="min-h-9 max-h-32 resize-none"
      />
      <Button
        type="submit"
        size="icon"
        disabled={!text.trim() || recording}
        className="h-9 w-9 shrink-0"
      >
        <Send className="h-4 w-4" />
      </Button>

    </form>
    </>
  );
}

/* ------------------------ Right: Siblings ------------------------ */

function SiblingsColumn({
  currentId,
  siblings,
  stageName,
}: {
  currentId: string;
  siblings: any[];
  stageName: string | null;
}) {
  return (
    <aside className="w-[280px] shrink-0 overflow-y-auto bg-slate-50 dark:bg-slate-900/40 border-l">
      <div className="border-b bg-slate-100 dark:bg-slate-900/70 px-3 py-2.5 sticky top-0 z-10">
        <div className="text-xs text-muted-foreground">فرص نفس المرحلة</div>
        <div className="text-sm font-semibold flex items-center gap-2">
          {stageName ?? "—"} <Badge variant="secondary">{siblings.length}</Badge>
        </div>
      </div>
      {siblings.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">لا توجد فرص أخرى في هذه المرحلة.</div>
      ) : (
        <div className="p-2 space-y-1.5">
          {siblings.map((s) => (
            <Link
              key={s.id}
              to="/pipeline/$oppId"
              params={{ oppId: s.id }}
              className={cn(
                "block rounded-md border p-2.5 transition-colors bg-white dark:bg-slate-800/60",
                "hover:border-primary/50 hover:shadow-sm",
                s.id === currentId && "border-primary ring-1 ring-primary bg-primary/5"
              )}
            >
              <div className="font-medium text-sm truncate">{s.contact_name}</div>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                {s.owner_name ? (
                  <Badge variant="secondary" className="text-[10px]">{s.owner_name}</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">غير مسند</Badge>
                )}
                {s.source && <span>· {s.source}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}

/* ------------------------ Inline files popover ------------------------ */

function FilesPopover({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const doList = useServerFn(listFiles);
  const doUploadUrl = useServerFn(createUploadUrl);
  const doRegister = useServerFn(registerFile);
  const doDelete = useServerFn(deleteFile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const filesQ = useQuery({
    queryKey: ["opp-files", oppId],
    queryFn: () => doList({ data: { entityType: "opportunity", entityId: oppId } }),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const up: any = await doUploadUrl({
        data: { entityType: "opportunity", entityId: oppId, fileName: file.name },
      });
      if (!up?.path || !up?.token) throw new Error("فشل تجهيز رابط الرفع");
      const { error: upErr } = await supabase.storage
        .from("crm-files")
        .uploadToSignedUrl(up.path, up.token, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) throw new Error(upErr.message || "فشل رفع الملف");
      await doRegister({
        data: {
          entityType: "opportunity",
          entityId: oppId,
          storagePath: up.path,
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        },
      });
      toast.success("تم رفع الملف");
      qc.invalidateQueries({ queryKey: ["opp-files", oppId] });
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الرفع");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }


  const delMut = useMutation({
    mutationFn: (fileId: string) => doDelete({ data: { fileId } }),
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["opp-files", oppId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل الحذف"),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Paperclip className="h-3.5 w-3.5" /> ملفات
          {filesQ.data && filesQ.data.length > 0 && (
            <Badge variant="secondary" className="text-[10px] mr-1">{filesQ.data.length}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3" dir="rtl">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">ملفات الفرصة</div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "جارٍ الرفع..." : "+ رفع"}
          </Button>
        </div>
        <div className="max-h-72 overflow-y-auto space-y-1.5">
          {filesQ.isLoading ? (
            <div className="text-xs text-muted-foreground text-center py-3">جارٍ التحميل...</div>
          ) : !filesQ.data || filesQ.data.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-3">لا توجد ملفات</div>
          ) : (
            filesQ.data.map((f: any) => (
              <div key={f.id} className="flex items-center gap-2 text-xs bg-muted/40 rounded p-2 border">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{f.file_name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {f.size_bytes ? `${Math.round(f.size_bytes / 1024)} KB` : ""}
                  </div>
                </div>
                {f.signed_url && (
                  <a
                    href={f.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 hover:bg-background rounded"
                    title="تنزيل"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                )}
                <button
                  onClick={() => delMut.mutate(f.id)}
                  className="p-1 hover:bg-background rounded text-destructive"
                  title="حذف"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------ Files gallery (thumbnails + preview) ------------------------ */

function fileKindOf(mime?: string | null, name?: string | null): "image" | "video" | "audio" | "pdf" | "other" {
  const m = (mime ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(n)) return "image";
  if (m.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/.test(n)) return "audio";
  if (m === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
  return "other";
}

function FilesGallery({ oppId }: { oppId: string }) {
  const doList = useServerFn(listFiles);
  const filesQ = useQuery({
    queryKey: ["opp-files", oppId],
    queryFn: () => doList({ data: { entityType: "opportunity", entityId: oppId } }),
  });
  const [preview, setPreview] = useState<any | null>(null);

  const files: any[] = filesQ.data ?? [];

  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center justify-between">
        <span>الملفات</span>
        {files.length > 0 && <span className="text-[10px] normal-case tracking-normal">{files.length}</span>}
      </div>
      <div className="bg-muted/30 rounded-md p-2.5">
        {filesQ.isLoading ? (
          <div className="text-xs text-muted-foreground text-center py-2">جارٍ التحميل...</div>
        ) : files.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-2">لا توجد ملفات — استخدم زر «ملفات» بالأعلى للرفع</div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {files.map((f) => {
              const kind = fileKindOf(f.mime_type, f.file_name);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPreview(f)}
                  className="group aspect-square rounded-md border bg-background overflow-hidden relative flex items-center justify-center hover:ring-2 hover:ring-primary/40 transition"
                  title={f.file_name}
                >
                  {kind === "image" && f.signed_url ? (
                    <img src={f.signed_url} alt={f.file_name} className="w-full h-full object-cover" />
                  ) : kind === "video" && f.signed_url ? (
                    <>
                      <video src={f.signed_url} className="w-full h-full object-cover" muted />
                      <FileVideo className="h-5 w-5 absolute text-white drop-shadow" />
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1 p-1 text-muted-foreground">
                      {kind === "audio" ? (
                        <FileAudio className="h-6 w-6" />
                      ) : kind === "pdf" ? (
                        <FileText className="h-6 w-6" />
                      ) : (
                        <FileIcon className="h-6 w-6" />
                      )}
                      <span className="text-[9px] truncate w-full text-center leading-tight">
                        {f.file_name}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="truncate text-sm">{preview?.file_name}</DialogTitle>
          </DialogHeader>
          {preview && (() => {
            const kind = fileKindOf(preview.mime_type, preview.file_name);
            const url = preview.signed_url;
            if (!url) return <div className="text-sm text-muted-foreground text-center py-8">لا يمكن المعاينة</div>;
            if (kind === "image") return <img src={url} alt={preview.file_name} className="w-full max-h-[70vh] object-contain rounded" />;
            if (kind === "video") return <video src={url} controls className="w-full max-h-[70vh] rounded" />;
            if (kind === "audio") return <audio src={url} controls className="w-full" />;
            if (kind === "pdf") return <iframe src={url} className="w-full h-[70vh] rounded border" title={preview.file_name} />;
            return (
              <div className="text-sm text-center py-8">
                لا تتوفر معاينة لهذا النوع.
                <div className="mt-3">
                  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                    <Download className="h-4 w-4" /> تنزيل
                  </a>
                </div>
              </div>
            );
          })()}
          {preview?.signed_url && (
            <div className="flex justify-end">
              <a
                href={preview.signed_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Download className="h-3.5 w-3.5" /> تنزيل
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------ Delete Opportunity ------------------------ */

function DeleteOpportunityButton({
  oppId,
  contactName,
  onDeleted,
}: {
  oppId: string;
  contactName: string | null;
  onDeleted: () => void;
}) {
  const canDelete =
    usePermission("crm.opportunities.delete") ||
    usePermission("opportunities.delete") ||
    usePermission("opportunities.manage");
  const qc = useQueryClient();
  const doDelete = useServerFn(softDeleteOpportunity);
  const [open, setOpen] = useState(false);
  const mut = useMutation({
    mutationFn: () => doDelete({ data: { opportunityId: oppId } }),
    onSuccess: () => {
      toast.success("تم نقل التذكرة إلى المهملات");
      qc.invalidateQueries({ queryKey: ["pipeline-board"] });
      setOpen(false);
      onDeleted();
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل الحذف"),
  });
  if (!canDelete) return null;
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 gap-1">
          <Trash2 className="h-4 w-4" /> حذف
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>حذف التذكرة؟</AlertDialogTitle>
          <AlertDialogDescription>
            سيتم نقل تذكرة {contactName ? `"${contactName}"` : "هذه"} إلى المهملات ويمكن استعادتها لاحقًا.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            تأكيد الحذف
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------ Sync WhatsApp History ------------------------ */

function SyncHistoryButton({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const doSync = useServerFn(syncOpportunityHistory);
  const mut = useMutation({
    mutationFn: () => doSync({ data: { opportunityId: oppId, limit: 200 } }),
    onSuccess: (res: any) => {
      const n = res?.synced ?? 0;
      toast.success(n > 0 ? `تمت مزامنة ${n} رسالة` : "لا توجد رسائل جديدة");
      qc.invalidateQueries({ queryKey: ["merged-chat", oppId] });
      qc.invalidateQueries({ queryKey: ["opp-workspace", oppId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "فشل المزامنة"),
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1"
      disabled={mut.isPending}
      onClick={() => mut.mutate()}
      title="جلب سجل الرسائل من واتساب"
    >
      <RefreshCw className={cn("h-4 w-4", mut.isPending && "animate-spin")} /> مزامنة
    </Button>
  );
}

/* ------------------------ Voice Player (WhatsApp-style) ------------------------ */

function VoicePlayer({ src, fromMe }: { src: string; fromMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  // Lock src for the lifetime of this component. The parent re-signs media
  // URLs on every refetch, so a changing `src` reloads <audio> and cuts
  // playback after ~1s. Keep only the first URL we received.
  const [stableSrc] = useState(src);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      setCurrentTime(a.currentTime);
      setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
    };
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const bars = useMemo(() => {
    // Pseudo-random but stable waveform seeded from the (locked) src.
    let seed = 0;
    for (let i = 0; i < stableSrc.length; i++) seed = (seed * 31 + stableSrc.charCodeAt(i)) >>> 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed & 0xffff) / 0xffff;
    };
    return Array.from({ length: 32 }, () => 0.25 + rnd() * 0.75);
  }, [stableSrc]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration || !isFinite(a.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // RTL layout: seek from the right edge
    const ratio = 1 - (e.clientX - rect.left) / rect.width;
    a.currentTime = Math.max(0, Math.min(a.duration, ratio * a.duration));
  };

  return (
    <div className={cn(
      "flex items-center gap-2 min-w-[240px] py-1",
      fromMe ? "text-white" : "text-foreground"
    )}>
      <audio ref={audioRef} src={stableSrc} preload="auto" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "shrink-0 h-9 w-9 rounded-full flex items-center justify-center transition",
          fromMe ? "bg-white/20 hover:bg-white/30" : "bg-emerald-600 text-white hover:bg-emerald-700"
        )}
        aria-label={playing ? "إيقاف" : "تشغيل"}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center gap-[2px] h-6 cursor-pointer"
          onClick={handleSeek}
        >
          {bars.map((h, i) => {
            const played = ((i + 1) / bars.length) * 100 <= progress;
            return (
              <span
                key={i}
                className={cn(
                  "w-[3px] rounded-full transition-colors",
                  played
                    ? (fromMe ? "bg-white" : "bg-emerald-600")
                    : (fromMe ? "bg-white/40" : "bg-muted-foreground/40")
                )}
                style={{ height: `${h * 100}%` }}
              />
            );
          })}
        </div>
        <div className={cn("text-[10px] mt-0.5 tabular-nums", fromMe ? "opacity-80" : "text-muted-foreground")}>
          {fmt(playing || currentTime > 0 ? currentTime : duration)}
        </div>
      </div>
      <button
        type="button"
        onClick={cycleRate}
        className={cn(
          "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums",
          fromMe ? "bg-white/20 hover:bg-white/30" : "bg-muted hover:bg-muted/80"
        )}
        aria-label="سرعة التشغيل"
      >
        {rate}x
      </button>
    </div>
  );
}
