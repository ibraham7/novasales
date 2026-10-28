import {
  Link,
  createFileRoute,
} from "@tanstack/react-router";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  useServerFn,
} from "@tanstack/react-start";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ReactNode,
} from "react";

import {
  ArrowRight,
  Building2,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Forward,
  Info,
  Paperclip,
  Reply,
  Send,
  ShieldCheck,
  Smile,
  User2,
  UserPlus,
  X,
  Zap,
} from "lucide-react";

import { toast } from "@/lib/toast";

import {
  getChatWithMessages,
  sendMessageFn,
  listChatTextTemplates,
  sendMediaMessageFn,
} from "@/modules/messaging";
import { ForwardDialog } from "@/components/chat/forward-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaPreviewDialog, makeItems, type PreviewItem } from "@/components/chat/media-preview-dialog";

import {
  getOpportunityByChat,
  STAGE_LABEL_AR,
} from "@/modules/crm";

import {
  useChatSignals,
} from "@/components/chat/use-chat-signals";

import { ChatHeaderActions } from "@/components/chat/chat-header-actions";

import {
  Button,
} from "@/components/ui/button";

import {
  Textarea,
} from "@/components/ui/textarea";

import {
  StageBadge,
} from "@/components/crm/stage-badge";

import {
  OpportunityPanel,
} from "@/components/crm/opportunity-panel";

import {
  ProductPickerDialog,
} from "@/components/commerce/product-picker-dialog";

import {
  ChatOrderDialog,
} from "@/components/commerce/chat-order-dialog";

import {
  cn,
} from "@/lib/utils";

export const Route =
  createFileRoute(
    "/_authenticated/chat/$chatId",
  )({
    component: ChatView,
  });

type MessageRow = {
  id: string;
  from_me: boolean;
  content: string | null;
  status: string;
  created_at: string;
  message_type?: string;
  media_url?: string | null;
};

function ChatView() {
  const { chatId } =
    Route.useParams();

  const qc =
    useQueryClient();

  const fetchChat =
    useServerFn(
      getChatWithMessages,
    );

  const fetchOpp =
    useServerFn(
      getOpportunityByChat,
    );

  const send =
    useServerFn(
      sendMessageFn,
    );

  const sendMedia = useServerFn(sendMediaMessageFn);
  const [selectedMessage, setSelectedMessage] = useState<MessageRow | null>(null);
  const [replyMessage, setReplyMessage] = useState<MessageRow | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [toolbarPanel, setToolbarPanel] = useState<"templates" | "quick" | "emoji" | null>(null);
  const fetchTemplates = useServerFn(listChatTextTemplates);
  const templatesQ = useQuery({ queryKey: ["chat-text-templates"], queryFn: () => fetchTemplates(), enabled: toolbarPanel === "templates" });
  useEffect(() => { setSelectedMessage(null); setReplyMessage(null); setForwardOpen(false); setToolbarPanel(null); }, [chatId]);
  function pickMessage(action: "reply" | "forward") {
    if (!selectedMessage) { toast.error("اختر رسالة من المحادثة أولًا"); return; }
    if (action === "reply") setReplyMessage(selectedMessage);
    else setForwardOpen(true);
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [previewCaption, setPreviewCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});

  function chooseFiles(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files).filter((file) => {
      if (file.size <= 20 * 1024 * 1024) return true;
      toast.error(`${file.name}: الحد الأقصى 20MB`);
      return false;
    });
    if (accepted.length) setPreviewItems((current) => [...current, ...makeItems(accepted)]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function sendAttachments() {
    if (uploading) return;
    setUploading(true);
    let sent = 0;
    try {
      for (const item of previewItems) {
        setProgress((current) => ({ ...current, [item.id]: 30 }));
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.readAsDataURL(item.file);
        });
        await sendMedia({ data: {
          chatId,
          kind: item.kind,
          fileName: item.file.name,
          mimeType: item.file.type || "application/octet-stream",
          base64,
          caption: sent === 0 ? previewCaption.trim() || undefined : undefined,
          replyToMessageId: replyMessage?.id,
        } });
        sent++;
        setProgress((current) => ({ ...current, [item.id]: 100 }));
      }
      setPreviewItems([]);
      setPreviewCaption("");
      setReplyMessage(null);
      setProgress({});
    } catch (error) {
      if (sent) setPreviewItems((current) => current.slice(sent));
      toast.error(error instanceof Error ? error.message : "فشل إرسال المرفق");
    } finally {
      setUploading(false);
      qc.invalidateQueries({ queryKey: ["chat", chatId] });
      qc.invalidateQueries({ queryKey: ["chats-enriched"] });
    }
  }

  const scrollRef =
    useRef<HTMLDivElement>(
      null,
    );

  const [
    mobileDetailsOpen,
    setMobileDetailsOpen,
  ] = useState(false);

  const {
    data,
  } = useQuery({
    queryKey: [
      "chat",
      chatId,
    ],

    queryFn: () =>
      fetchChat({
        data: {
          chatId,
        },
      }),
  });

  const oppQ =
    useQuery({
      queryKey: [
        "opportunity-workspace",
        chatId,
      ],

      queryFn: () =>
        fetchOpp({
          data: {
            chatId,
          },
        }),
    });

  // Live updates for this conversation; the list refreshes itself from the same signal.
  useChatSignals((signal) => {
    if (signal.session_id === chatId) {
      void qc.invalidateQueries({
        queryKey: ["chat", chatId],
      });
    }
  });

  const [
    text,
    setText,
  ] = useState("");

  // Sent messages show immediately; the server copy replaces them once the send is confirmed.
  const [pending, setPending] =
    useState<(MessageRow & { replyToMessageId?: string })[]>([]);

  useEffect(() => setPending([]), [chatId]);

  const sendMut =
    useMutation({
      mutationFn: (message: { id: string; content: string; replyToMessageId?: string }) =>
        send({
          data: {
            chatId,
            text: message.content,
            replyToMessageId: message.replyToMessageId,
          },
        }),

      onSuccess: async (_result, message) => {
        await qc.invalidateQueries({
          queryKey: ["chat", chatId],
        });
        setPending((current) => current.filter((m) => m.id !== message.id));
        void qc.invalidateQueries({
          queryKey: ["chats-enriched"],
        });
      },

      onError: (error, message) => {
        setPending((current) =>
          current.map((m) => (m.id === message.id ? { ...m, status: "failed" } : m)),
        );
        toast.error(
          error instanceof Error
            ? error.message
            : "فشل الإرسال",
        );
      },
    });

  function sendText() {
    const content = text.trim();
    if (!content) return;
    const message = {
      id: `pending-${crypto.randomUUID()}`,
      from_me: true,
      content,
      status: "sending",
      created_at: new Date().toISOString(),
      message_type: "text",
      media_url: null,
      replyToMessageId: replyMessage?.id,
    };
    setText("");
    setReplyMessage(null);
    setPending((current) => [...current, message]);
    sendMut.mutate(message);
  }

  function retrySend(id: string) {
    const message = pending.find((m) => m.id === id);
    if (!message || !message.content) return;
    setPending((current) => current.map((m) => (m.id === id ? { ...m, status: "sending" } : m)));
    sendMut.mutate({ id, content: message.content, replyToMessageId: message.replyToMessageId });
  }

  const messages: MessageRow[] = useMemo(
    () => [...(data?.messages ?? []), ...pending],
    [data?.messages, pending],
  );

  // Photos sent back to back without text (e.g. a product's pictures) show as one album, as WhatsApp does.
  const albums = useMemo(() => {
    const byFirst = new Map<string, MessageRow[]>();
    const hidden = new Set<string>();
    const isBarePhoto = (m?: MessageRow) => m?.message_type === "image" && !!m.media_url && !m.content;
    let run: MessageRow[] = [];
    const close = () => {
      if (run.length > 1) {
        byFirst.set(run[0].id, run);
        run.slice(1).forEach((m) => hidden.add(m.id));
      }
      run = [];
    };
    for (const message of messages) {
      const last = run.at(-1);
      const joins =
        last &&
        isBarePhoto(message) &&
        message.from_me === last.from_me &&
        dayKey(message.created_at) === dayKey(last.created_at) &&
        new Date(message.created_at).getTime() - new Date(last.created_at).getTime() < 5 * 60_000;
      if (!joins) close();
      if (isBarePhoto(message)) run.push(message);
    }
    close();
    return { byFirst, hidden };
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top:
        scrollRef.current
          .scrollHeight,
    });
  }, [
    messages.length,
  ]);

  if (!data) {
    // Show what the chat list already knows right away; messages fill in when they arrive.
    const listed = (qc.getQueriesData({ queryKey: ["chats-enriched"] }) as [unknown, any[] | undefined][])
      .flatMap(([, rows]) => rows ?? [])
      .find((row) => row?.id === chatId);
    return (
      <div className="fixed inset-0 z-40 lg:static flex flex-col h-full bg-background" aria-busy="true">
        <div className="h-14 border-b bg-card px-4 flex items-center gap-3 shrink-0">
          <div className="h-9 w-9 rounded-full bg-muted shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{listed?.title ?? "جارٍ التحميل..."}</div>
            {listed?.phone && <div className="text-xs text-muted-foreground" dir="ltr">{listed.phone}</div>}
          </div>
        </div>
        <div className="flex-1 p-4 space-y-3">
          {["w-2/5", "w-1/2 ms-auto", "w-1/3", "w-2/5 ms-auto"].map((width) => (
            <div key={width} className={cn("h-10 rounded-2xl bg-muted animate-pulse", width)} />
          ))}
        </div>
      </div>
    );
  }

  const contact =
    data.chat.contact as
    | {
      name?:
      | string
      | null;
      phone?: string;
    }
    | null;

  const opp =
    oppQ.data;

  const title =
    opp?.contact?.name ??
    contact?.name ??
    contact?.phone ??
    String(
      data.chat.remote_jid,
    ).split("@")[0];

  const phone =
    opp?.contact?.phone ??
    contact?.phone ??
    String(
      data.chat.remote_jid,
    ).split("@")[0];

  const assignedAgo =
    opp?.opportunity
      ?.first_response_at
      ? relTime(
        opp
          .opportunity
          .first_response_at,
      )
      : null;

  const lastReplyAgo =
    data.chat
      .last_message_at
      ? relTime(
        data.chat
          .last_message_at,
      )
      : null;

  return (
    <>
    {previewItems.length > 0 && <MediaPreviewDialog
      items={previewItems}
      setItems={setPreviewItems}
      caption={previewCaption}
      setCaption={setPreviewCaption}
      onCancel={() => { if (!uploading) { setPreviewItems([]); setPreviewCaption(""); setProgress({}); } }}
      onSend={sendAttachments}
      sending={uploading}
      progress={progress}
      onAddMore={() => fileInputRef.current?.click()}
    />}
    <div
      className={cn(
        "flex min-h-0 bg-background",
        "fixed inset-0 z-40",
        "lg:static lg:z-auto lg:h-screen",
      )}
    >
      {/* Chat */}
      <div className="flex-1 min-w-0 flex flex-col bg-muted/10">
        {/* Header */}
        <header className="border-b bg-card shrink-0">
          <div className="px-2 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3">
            {/* Mobile back */}
            <Link
              to="/chat"
              className="lg:hidden h-9 w-9 rounded-full hover:bg-muted flex items-center justify-center shrink-0"
              aria-label="العودة للمحادثات"
            >
              <ArrowRight className="h-5 w-5" />
            </Link>

            <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
              {String(
                title,
              )
                .charAt(0)
                .toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <span className="font-semibold text-sm sm:text-base truncate">
                  {title}
                </span>

                {opp
                  ?.opportunity
                  ?.stage && (
                    <div className="hidden sm:block shrink-0">
                      <StageBadge
                        stage={
                          opp
                            .opportunity
                            .stage
                        }
                      />
                    </div>
                  )}
              </div>

              <div
                className="text-[11px] sm:text-xs text-muted-foreground font-mono truncate"
                dir="ltr"
              >
                +{phone}
              </div>
            </div>

            {/* Desktop actions */}
            <ChatHeaderActions
              chatId={chatId}
              opportunity={opp?.opportunity ?? null}
              phone={phone}
            />

            {/* Mobile info */}
            {opp && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="xl:hidden h-9 w-9 shrink-0"
                onClick={() =>
                  setMobileDetailsOpen(
                    true,
                  )
                }
                title="بيانات العميل"
              >
                <Info className="h-5 w-5" />
              </Button>
            )}
          </div>

          {/* Chips */}
          <div className="hidden sm:flex px-4 pb-2 items-center gap-1.5 overflow-x-auto text-[11px]">
            {opp
              ?.opportunity
              ?.source && (
                <Chip>
                  {
                    opp
                      .opportunity
                      .source
                  }
                </Chip>
              )}

            {opp
              ?.department
              ?.name && (
                <Chip>
                  <Building2 className="h-3 w-3" />

                  {
                    opp
                      .department
                      .name
                  }
                </Chip>
              )}

            {opp?.owner
              ?.name ? (
              <Chip tone="primary">
                <User2 className="h-3 w-3" />

                {
                  opp.owner
                    .name
                }
              </Chip>
            ) : (
              <Chip tone="warning">
                غير موزّعة
              </Chip>
            )}

            {opp
              ?.supervisor
              ?.name && (
                <Chip>
                  <ShieldCheck className="h-3 w-3" />

                  {
                    opp
                      .supervisor
                      .name
                  }
                </Chip>
              )}
          </div>

          {/* KPI */}
          <div className="px-3 sm:px-4 py-2 border-t bg-muted/30 flex items-center gap-4 overflow-x-auto whitespace-nowrap text-[10px] sm:text-[11px] text-muted-foreground">
            <KPI
              icon={
                <Clock className="h-3 w-3" />
              }
              label="مرحلة"
              value={
                opp
                  ?.opportunity
                  ?.stage
                  ? STAGE_LABEL_AR[
                  opp
                    .opportunity
                    .stage
                  ]
                  : "—"
              }
            />

            <KPI
              icon={
                <UserPlus className="h-3 w-3" />
              }
              label="تم التوزيع"
              value={
                assignedAgo ??
                "—"
              }
            />

            <KPI
              icon={
                <Reply className="h-3 w-3" />
              }
              label="آخر رد"
              value={
                lastReplyAgo ??
                "—"
              }
            />

            <KPI
              icon={
                <ShieldCheck className="h-3 w-3" />
              }
              label="SLA"
              value={slaState(
                data.chat
                  .last_message_at,
              )}
            />
          </div>
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-2 sm:px-6 py-3 space-y-1 overscroll-contain bg-chat-wallpaper"
        >
          {messages
            .length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-12">
              لا توجد رسائل بعد
            </div>
          ) : (
            messages.map(
              (
                message: MessageRow,
                index: number,
              ) => albums.hidden.has(message.id) ? null : (
                <Fragment key={message.id}>
                {dayKey(message.created_at) !== dayKey(messages[index - 1]?.created_at) && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-lg bg-chat-in px-3 py-1 text-[11px] text-chat-meta shadow-sm">
                      {dayLabel(message.created_at)}
                    </span>
                  </div>
                )}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`اختيار رسالة: ${message.content || "مرفق"}`}
                  aria-pressed={selectedMessage?.id === message.id}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedMessage(message); } }}
                  onClick={() => setSelectedMessage(message)}
                  className={cn(
                    "flex cursor-pointer rounded-lg px-1",
                    selectedMessage?.id === message.id && "ring-2 ring-primary",
                    message.from_me
                      ? "justify-start"
                      : "justify-end",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] sm:max-w-[70%] lg:max-w-[62%]",
                      "rounded-lg px-2.5 pt-1.5 pb-1 text-[14px] leading-relaxed shadow-sm overflow-hidden",
                      message.from_me
                        ? "bg-chat-out text-chat-out-foreground rounded-tr-none"
                        : "bg-chat-in text-foreground rounded-tl-none",
                    )}
                  >
                    {albums.byFirst.has(message.id) ? (
                      <PhotoAlbum photos={albums.byFirst.get(message.id)!} />
                    ) : message.message_type === "video" && message.media_url ? (
                      <video
                        src={message.media_url}
                        controls
                        preload="metadata"
                        playsInline
                        onClick={(event) => event.stopPropagation()}
                        className="rounded-lg mb-1 max-h-[320px] w-full bg-black"
                      />
                    ) : message.message_type ===
                      "image" &&
                      message.media_url && (
                        <img
                          src={
                            message.media_url
                          }
                          alt="صورة"
                          className="rounded-lg mb-2 max-h-[320px] w-full object-cover"
                        />
                      )}

                    {message.content && (
                      <div className="whitespace-pre-wrap break-words">
                        {
                          message.content
                        }
                      </div>
                    )}

                    <div className="text-[10px] mt-0.5 flex items-center justify-end gap-1 text-chat-meta">
                      <span>
                        {new Date(
                          message.created_at,
                        ).toLocaleTimeString(
                          "ar",
                          {
                            hour:
                              "2-digit",
                            minute:
                              "2-digit",
                          },
                        )}
                      </span>

                      {message.from_me &&
                        (message.status ===
                          "sending" ? (
                          <Clock className="h-3 w-3" aria-label="جارٍ الإرسال" />
                        ) : message.status ===
                          "read" ? (
                          <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" />
                        ) : message.status ===
                          "delivered" ? (
                          <CheckCheck className="h-3.5 w-3.5" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        ))}

                      {message.status ===
                        "failed" && (
                          message.id.startsWith("pending-") ? (
                            <button
                              type="button"
                              className="underline font-semibold"
                              onClick={(event) => {
                                event.stopPropagation();
                                retrySend(message.id);
                              }}
                            >
                              • فشل — إعادة المحاولة
                            </button>
                          ) : (
                            <span>
                              • فشل
                            </span>
                          )
                        )}
                    </div>
                  </div>
                </div>
                </Fragment>
              ),
            )
          )}
        </div>

        {/* Composer */}
        <div className="border-t bg-card shrink-0 pb-[env(safe-area-inset-bottom)]">
          <div className="px-2 sm:px-3 pt-2 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-muted-foreground">
            <ToolBtn label="رد" onClick={() => pickMessage("reply")}>
              <Reply className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="تحويل" onClick={() => pickMessage("forward")}>
              <Forward className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="قوالب" onClick={() => setToolbarPanel("templates")}>
              <FileText className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="ردود سريعة" onClick={() => setToolbarPanel("quick")}>
              <Zap className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="Emoji" onClick={() => setToolbarPanel("emoji")}>
              <Smile className="h-4 w-4" />
            </ToolBtn>

            <input
              ref={fileInputRef}
              id="chat-attachment-input"
              type="file"
              className="sr-only"
              multiple
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
              onChange={(event) => chooseFiles(event.target.files)}
            />
            <label
              htmlFor="chat-attachment-input"
              title="ملف"
              aria-label="إرفاق ملف أو صورة"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
            >
              <Paperclip className="h-4 w-4" />
            </label>

            <ProductPickerDialog
              chatId={chatId}
            />

            {opp?.contact
              ?.id &&
              opp
                ?.opportunity
                ?.id && (
                <ChatOrderDialog
                  chatId={
                    chatId
                  }
                  contactId={
                    opp
                      .contact
                      .id
                  }
                  opportunityId={
                    opp
                      .opportunity
                      .id
                  }
                  contactName={
                    opp
                      .contact
                      .name
                  }
                />
              )}
          </div>

          {replyMessage && <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border-r-4 border-primary bg-muted p-2 text-sm"><Reply className="h-4 w-4" /><span className="flex-1 truncate">الرد على: {replyMessage.content || "مرفق"}</span><Button type="button" variant="ghost" size="icon" aria-label="إلغاء الرد" onClick={() => setReplyMessage(null)}><X className="h-4 w-4" /></Button></div>}
          {selectedMessage && <p className="px-3 pt-2 text-xs text-muted-foreground">تم اختيار رسالة للرد أو التحويل <button type="button" className="underline" onClick={() => setSelectedMessage(null)}>إلغاء الاختيار</button></p>}
          <ForwardDialog open={forwardOpen} onOpenChange={setForwardOpen} messageId={selectedMessage?.id ?? null} onDone={() => qc.invalidateQueries({ queryKey: ["chats-enriched"] })} />
          <Dialog open={toolbarPanel !== null} onOpenChange={(open) => { if (!open) setToolbarPanel(null); }}>
            <DialogContent dir="rtl" className="max-w-md"><DialogHeader><DialogTitle>{toolbarPanel === "templates" ? "القوالب النصية" : toolbarPanel === "quick" ? "ردود سريعة" : "الرموز التعبيرية"}</DialogTitle></DialogHeader>
              <div className="max-h-80 overflow-y-auto space-y-2">
                {toolbarPanel === "templates" && (templatesQ.isPending ? <p>جارٍ التحميل...</p> : templatesQ.isError ? <div><p>تعذر تحميل القوالب</p><Button onClick={() => templatesQ.refetch()}>إعادة المحاولة</Button></div> : templatesQ.data?.length ? templatesQ.data.map(t => <Button key={t.id} variant="outline" className="w-full justify-start" onClick={() => { setText(t.body); setToolbarPanel(null); }}>{t.name}</Button>) : <p>لا توجد قوالب نصية في مؤسستك. يمكن إضافتها من صفحة قوالب الحملات.</p>)}
                {toolbarPanel === "templates" && <p className="text-xs text-muted-foreground">يُدرج نص القالب للمراجعة؛ عدّل أي متغيرات قبل الإرسال.</p>}
                {toolbarPanel === "quick" && ["السلام عليكم، كيف يمكننا مساعدتك؟", "شكرًا لتواصلك معنا، سنرد عليك قريبًا.", "هل يمكنك تزويدنا بتفاصيل الطلب؟", "تم استلام طلبك، شكرًا لك."].map(value => <Button key={value} variant="outline" className="w-full h-auto whitespace-normal text-right justify-start" onClick={() => { setText(value); setToolbarPanel(null); }}>{value}</Button>)}
                {toolbarPanel === "emoji" && <div className="grid grid-cols-6 gap-2">{["😊", "👍", "❤️", "🙏", "✅", "🌹", "🎉", "👋", "🤝", "📦", "✨", "🙂", "😂", "😍", "👌", "💚", "📍", "🕐"].map(value => <Button key={value} variant="ghost" aria-label={value} onClick={() => { setText(current => current + value); setToolbarPanel(null); }}>{value}</Button>)}</div>}
              </div>
            </DialogContent>
          </Dialog>
          <form
            onSubmit={(event) => {
              event.preventDefault();

              sendText();
            }}
            className="p-2 sm:p-3 flex gap-2 items-end"
          >
            <Textarea
              value={text}
              onChange={(
                event,
              ) =>
                setText(
                  event.target
                    .value,
                )
              }
              onKeyDown={(
                event,
              ) => {
                if (
                  event.key ===
                  "Enter" &&
                  !event.shiftKey
                ) {
                  event.preventDefault();

                  sendText();
                }
              }}
              rows={1}
              autoFocus
              placeholder="اكتب رسالة..."
              className="min-h-10 max-h-32 resize-none rounded-2xl"
            />

            <Button
              type="submit"
              size="icon"
              disabled={
                !text.trim()
              }
              className="h-10 w-10 rounded-full shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>

      {/* Desktop customer panel */}
      <aside className="hidden xl:flex w-[360px] shrink-0 border-r bg-background flex-col">
        {opp ? (
          <OpportunityPanel
            chatId={chatId}
            data={opp}
          />
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            لم يتم إنشاء فرصة
            لهذه المحادثة بعد.
          </div>
        )}
      </aside>

      {/* Mobile / tablet customer panel */}
      {mobileDetailsOpen &&
        opp && (
          <div className="xl:hidden fixed inset-0 z-[70]">
            <button
              type="button"
              aria-label="إغلاق بيانات العميل"
              className="absolute inset-0 bg-black/45"
              onClick={() =>
                setMobileDetailsOpen(
                  false,
                )
              }
            />

            <aside className="absolute inset-y-0 right-0 w-[92vw] sm:w-[420px] max-w-full bg-background shadow-2xl border-l flex flex-col">
              <div className="h-14 px-3 border-b flex items-center justify-between shrink-0">
                <span className="font-semibold">
                  بيانات العميل
                </span>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setMobileDetailsOpen(
                      false,
                    )
                  }
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <OpportunityPanel
                  chatId={
                    chatId
                  }
                  data={opp}
                />
              </div>
            </aside>
          </div>
        )}
    </div>
    </>
  );
}

function Chip({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?:
  | "muted"
  | "primary"
  | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium shrink-0",
        tone ===
        "primary" &&
        "bg-primary/10 text-primary",
        tone ===
        "warning" &&
        "bg-[var(--color-stage-negotiation)]/15 text-[var(--color-stage-negotiation)]",
        tone ===
        "muted" &&
        "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function KPI({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {icon}

      <span>
        {label}:
      </span>

      <span className="font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

function ToolBtn({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-8 w-8 shrink-0 flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
    >
      {children}
    </button>
  );
}

function relTime(
  iso: string,
) {
  const diff =
    Date.now() -
    new Date(
      iso,
    ).getTime();

  const min =
    Math.floor(
      diff / 60000,
    );

  if (min < 1) {
    return "الآن";
  }

  if (min < 60) {
    return `منذ ${min}د`;
  }

  const hours =
    Math.floor(
      min / 60,
    );

  if (hours < 24) {
    return `منذ ${hours}س`;
  }

  const days =
    Math.floor(
      hours / 24,
    );

  return `منذ ${days}ي`;
}

function slaState(
  iso: string | null,
) {
  if (!iso) {
    return "—";
  }

  const min =
    Math.floor(
      (
        Date.now() -
        new Date(
          iso,
        ).getTime()
      ) / 60000,
    );

  if (min < 30) {
    return "OK";
  }

  if (min < 120) {
    return "تنبيه";
  }

  return "متأخر";
}

// Up to four tiles like WhatsApp; the last tile says how many more there are. Each opens the full photo.
function PhotoAlbum({ photos }: { photos: MessageRow[] }) {
  const shown = photos.slice(0, 4);
  const more = photos.length - shown.length;
  return (
    <div className={cn("grid w-64 max-w-full gap-0.5 mb-1 rounded-lg overflow-hidden", shown.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {shown.map((photo, i) => (
        <a
          key={photo.id}
          href={photo.media_url!}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="relative block aspect-square bg-muted"
        >
          <img src={photo.media_url!} alt="صورة" loading="lazy" className="h-full w-full object-cover" />
          {more > 0 && i === shown.length - 1 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">
              +{more}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}

function dayKey(iso: string | undefined) {
  return iso ? new Date(iso).toDateString() : "";
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "اليوم";
  if (date.toDateString() === yesterday.toDateString()) return "أمس";
  return date.toLocaleDateString("ar", { day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
