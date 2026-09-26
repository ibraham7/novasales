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
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  ReactNode,
} from "react";

import {
  ArrowLeftRight,
  ArrowRight,
  Building2,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Forward,
  Info,
  MoreHorizontal,
  Paperclip,
  Reply,
  Send,
  ShieldCheck,
  Smile,
  User2,
  UserPlus,
  X,
  XCircle,
  Zap,
} from "lucide-react";

import { toast } from "sonner";

import {
  getChatWithMessages,
  sendMessageFn,
} from "@/modules/messaging";

import {
  getOpportunityByChat,
  STAGE_LABEL_AR,
} from "@/modules/crm";

import {
  supabase,
} from "@/integrations/supabase/client";

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

  useEffect(() => {
    const channel =
      supabase
        .channel(
          `chat-${chatId}`,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "msg_messages",
            filter:
              `session_id=eq.${chatId}`,
          },
          () => {
            qc.invalidateQueries({
              queryKey: [
                "chat",
                chatId,
              ],
            });

            qc.invalidateQueries({
              queryKey: [
                "chats-enriched",
              ],
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event:
              "UPDATE",
            schema:
              "public",
            table:
              "msg_sessions",
            filter:
              `id=eq.${chatId}`,
          },
          () => {
            qc.invalidateQueries({
              queryKey: [
                "chat",
                chatId,
              ],
            });
          },
        )
        .subscribe();

    return () => {
      supabase.removeChannel(
        channel,
      );
    };
  }, [
    chatId,
    qc,
  ]);

  const [
    text,
    setText,
  ] = useState("");

  const sendMut =
    useMutation({
      mutationFn: () =>
        send({
          data: {
            chatId,
            text,
          },
        }),

      onSuccess: () => {
        setText("");

        qc.invalidateQueries({
          queryKey: [
            "chat",
            chatId,
          ],
        });

        qc.invalidateQueries({
          queryKey: [
            "chats-enriched",
          ],
        });
      },

      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "فشل الإرسال",
        );
      },
    });

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top:
        scrollRef.current
          .scrollHeight,
    });
  }, [
    data?.messages?.length,
  ]);

  if (!data) {
    return (
      <div className="fixed inset-0 z-40 md:static md:min-h-[calc(100vh)] flex items-center justify-center bg-background text-muted-foreground">
        جارٍ التحميل...
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
    <div
      className={cn(
        "flex min-h-0 bg-background",
        "fixed inset-0 z-40",
        "md:static md:z-auto md:h-screen",
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
              className="md:hidden h-9 w-9 rounded-full hover:bg-muted flex items-center justify-center shrink-0"
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
            <div className="hidden xl:flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={!opp}
              >
                <UserPlus className="h-3.5 w-3.5" />

                Assign
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={!opp}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />

                Transfer
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={!opp}
              >
                <XCircle className="h-3.5 w-3.5" />

                Close
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>

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
          className="flex-1 overflow-y-auto px-2 sm:px-4 py-3 sm:py-4 space-y-2 overscroll-contain"
        >
          {data.messages
            .length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-12">
              لا توجد رسائل بعد
            </div>
          ) : (
            data.messages.map(
              (
                message: MessageRow,
              ) => (
                <div
                  key={
                    message.id
                  }
                  className={cn(
                    "flex",
                    message.from_me
                      ? "justify-start"
                      : "justify-end",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[88%] sm:max-w-[78%] lg:max-w-[70%]",
                      "rounded-2xl px-3 sm:px-3.5 py-2 text-sm shadow-sm overflow-hidden",
                      message.from_me
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-card border rounded-bl-md",
                    )}
                  >
                    {message.message_type ===
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

                    <div
                      className={cn(
                        "text-[10px] mt-1 flex items-center gap-1 opacity-80",
                        !message.from_me &&
                        "text-muted-foreground",
                      )}
                    >
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
                          <span>
                            • فشل
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              ),
            )
          )}
        </div>

        {/* Composer */}
        <div className="border-t bg-card shrink-0 pb-[env(safe-area-inset-bottom)]">
          <div className="px-2 sm:px-3 pt-2 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-muted-foreground">
            <ToolBtn label="رد">
              <Reply className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="تحويل">
              <Forward className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="قوالب">
              <FileText className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="ردود سريعة">
              <Zap className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="Emoji">
              <Smile className="h-4 w-4" />
            </ToolBtn>

            <ToolBtn label="ملف">
              <Paperclip className="h-4 w-4" />
            </ToolBtn>

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

          <form
            onSubmit={(event) => {
              event.preventDefault();

              if (
                text.trim()
              ) {
                sendMut.mutate();
              }
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

                  if (
                    text.trim()
                  ) {
                    sendMut.mutate();
                  }
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
                !text.trim() ||
                sendMut.isPending
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
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
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