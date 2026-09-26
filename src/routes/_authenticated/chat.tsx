import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";

import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  useServerFn,
} from "@tanstack/react-start";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Flame,
  MessagesSquare,
  Search,
} from "lucide-react";

import {
  listChatsEnriched,
} from "@/modules/crm";

import {
  supabase,
} from "@/integrations/supabase/client";

import {
  Input,
} from "@/components/ui/input";

import {
  StageDot,
} from "@/components/crm/stage-badge";

import {
  matchesSearch,
} from "@/lib/fuzzy-search";

import {
  cn,
} from "@/lib/utils";

export const Route =
  createFileRoute(
    "/_authenticated/chat",
  )({
    head: () => ({
      meta: [
        {
          title:
            "المحادثات - NovaSales",
        },
        {
          name:
            "description",
          content:
            "مساحة عمل الفرص والمحادثات.",
        },
        {
          property:
            "og:title",
          content:
            "المحادثات - NovaSales",
        },
        {
          property:
            "og:description",
          content:
            "مساحة عمل الفرص والمحادثات.",
        },
      ],
    }),

    component:
      ChatLayout,
  });

type Row =
  Awaited<
    ReturnType<
      typeof listChatsEnriched
    >
  >[number];

type Filter =
  | "all"
  | "unread";

function ChatLayout() {
  const qc =
    useQueryClient();

  const fetchChats =
    useServerFn(
      listChatsEnriched,
    );

  const location =
    useLocation();

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    filter,
    setFilter,
  ] =
    useState<Filter>(
      "all",
    );

  const searching =
    search
      .trim()
      .length > 0;

  const {
    data: chats = [],
  } =
    useQuery<Row[]>({
      queryKey: [
        "chats-enriched",
        searching,
      ],

      queryFn: () =>
        fetchChats({
          data: {
            all: searching,
          },
        }),

      placeholderData:
        (previous: any) =>
          previous,
    });

  useEffect(() => {
    const channel =
      supabase
        .channel(
          "chats-list",
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema:
              "public",
            table:
              "msg_sessions",
          },
          () => {
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
              "INSERT",
            schema:
              "public",
            table:
              "msg_messages",
          },
          () => {
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
            event: "*",
            schema:
              "public",
            table:
              "opp_opportunities",
          },
          () => {
            qc.invalidateQueries({
              queryKey: [
                "chats-enriched",
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
  }, [qc]);

  const filtered =
    useMemo(() => {
      const value =
        search.trim();

      return chats.filter(
        (chat) => {
          if (
            filter ===
            "unread" &&
            (
              chat.unread_count ??
              0
            ) === 0
          ) {
            return false;
          }

          if (!value) {
            return true;
          }

          return matchesSearch(
            value,
            [
              chat.title,
              chat.phone,
              (
                chat as any
              ).contact_name,
              (
                chat as any
              ).account_name,
              chat.last_message_text,
            ],
          );
        },
      );
    }, [
      chats,
      search,
      filter,
    ]);

  const unreadTotal =
    chats.reduce(
      (
        total,
        chat,
      ) =>
        total +
        Number(
          chat.unread_count ??
          0,
        ),
      0,
    );

  const inConversation =
    /^\/chat\/[^/]+/.test(
      location.pathname,
    );

  const TABS: {
    key: Filter;
    label: string;
  }[] = [
      {
        key: "all",
        label: "الكل",
      },
      {
        key: "unread",
        label: "غير مقروءة",
      },
    ];

  return (
    <div
      className="flex h-[calc(100vh-3.5rem)] md:h-screen overflow-hidden"
      dir="rtl"
    >
      {/* Chat list */}
      <aside
        className={cn(
          "bg-card flex-col border-l min-w-0",
          "w-full md:w-[340px] lg:w-[360px] md:shrink-0",
          inConversation
            ? "hidden md:flex"
            : "flex",
        )}
      >
        {/* Header */}
        <div className="px-3 sm:px-4 pt-4 pb-3 border-b space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-xl">
                المحادثات
              </h1>

              <p className="text-xs text-muted-foreground mt-0.5">
                {
                  chats.length
                }{" "}
                محادثة
              </p>
            </div>

            {unreadTotal >
              0 && (
                <span className="bg-primary/10 text-primary rounded-full min-w-8 h-8 px-2 flex items-center justify-center text-xs font-bold">
                  {
                    unreadTotal
                  }
                </span>
              )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />

            <Input
              value={
                search
              }
              onChange={(
                event,
              ) =>
                setSearch(
                  event.target
                    .value,
                )
              }
              placeholder="ابحث عن اسم، رقم أو رسالة..."
              className="h-10 pr-9 rounded-xl bg-muted/40"
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto">
            {TABS.map(
              (tab) => {
                const active =
                  filter ===
                  tab.key;

                const count =
                  tab.key ===
                    "unread"
                    ? chats.filter(
                      (
                        chat,
                      ) =>
                        (
                          chat.unread_count ??
                          0
                        ) >
                        0,
                    )
                      .length
                    : chats.length;

                return (
                  <button
                    key={
                      tab.key
                    }
                    type="button"
                    onClick={() =>
                      setFilter(
                        tab.key,
                      )
                    }
                    className={cn(
                      "h-8 px-3 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <span>
                      {
                        tab.label
                      }
                    </span>

                    <span
                      className={cn(
                        "text-[10px]",
                        active
                          ? "text-primary-foreground/80"
                          : "text-muted-foreground",
                      )}
                    >
                      {
                        count
                      }
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {filtered.length ===
            0 ? (
            <div className="h-full min-h-64 flex items-center justify-center p-8">
              <div className="text-center text-muted-foreground">
                <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <MessagesSquare className="h-7 w-7 opacity-50" />
                </div>

                <p className="font-medium text-foreground">
                  لا توجد
                  محادثات
                </p>

                <p className="text-xs mt-1">
                  لا توجد
                  نتائج مطابقة
                  للبحث الحالي.
                </p>
              </div>
            </div>
          ) : (
            filtered.map(
              (chat) => {
                const active =
                  location.pathname ===
                  `/chat/${chat.id}`;

                const unread =
                  Number(
                    chat.unread_count ??
                    0,
                  );

                const initial =
                  String(
                    chat.title ??
                    chat.phone ??
                    "?",
                  )
                    .trim()
                    .charAt(
                      0,
                    )
                    .toUpperCase();

                return (
                  <Link
                    key={
                      chat.id
                    }
                    to="/chat/$chatId"
                    params={{
                      chatId:
                        chat.id,
                    }}
                    className={cn(
                      "block border-b transition-colors",
                      active
                        ? "bg-accent/70"
                        : "hover:bg-accent/40",
                    )}
                  >
                    <div className="px-3 py-3 flex gap-3">
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <div
                          className={cn(
                            "h-12 w-12 rounded-full flex items-center justify-center font-bold",
                            unread >
                              0
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {
                            initial
                          }
                        </div>

                        <span className="absolute -bottom-0.5 -left-0.5 bg-card rounded-full p-[2px]">
                          <StageDot
                            stage={
                              chat.stage ??
                              "new"
                            }
                          />
                        </span>
                      </div>

                      {/* Center */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <div
                            className={cn(
                              "flex-1 truncate text-sm",
                              unread >
                                0
                                ? "font-bold text-foreground"
                                : "font-semibold",
                            )}
                          >
                            {
                              chat.title
                            }
                          </div>

                          <div
                            className={cn(
                              "text-[10px] shrink-0 pt-0.5",
                              unread >
                                0
                                ? "text-primary font-semibold"
                                : "text-muted-foreground",
                            )}
                          >
                            {chat.last_message_at
                              ? formatRelative(
                                chat.last_message_at,
                              )
                              : ""}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 mt-1 min-w-0">
                          <div
                            className={cn(
                              "text-xs flex-1 truncate",
                              unread >
                                0
                                ? "text-foreground font-medium"
                                : "text-muted-foreground",
                            )}
                          >
                            {chat.last_message_text ??
                              "لا توجد رسائل"}
                          </div>

                          {chat.priority >=
                            2 && (
                              <Flame
                                className="h-3.5 w-3.5 shrink-0 text-[var(--color-stage-negotiation)]"
                                aria-label="أولوية"
                              />
                            )}

                          {unread >
                            0 && (
                              <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center shrink-0">
                                {unread >
                                  99
                                  ? "99+"
                                  : unread}
                              </span>
                            )}
                        </div>

                        {(chat.source ||
                          chat.department_name ||
                          chat.owner_name) && (
                            <div className="flex items-center gap-1 mt-1.5 overflow-hidden">
                              {chat.source && (
                                <MiniChip>
                                  {
                                    chat.source
                                  }
                                </MiniChip>
                              )}

                              {chat.department_name && (
                                <MiniChip>
                                  {
                                    chat.department_name
                                  }
                                </MiniChip>
                              )}

                              {chat.owner_name && (
                                <MiniChip tone="primary">
                                  {
                                    chat.owner_name
                                  }
                                </MiniChip>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  </Link>
                );
              },
            )
          )}
        </div>
      </aside>

      {/* Conversation outlet */}
      <div
        className={cn(
          "flex-1 flex-col bg-muted/20 min-w-0",
          inConversation
            ? "flex"
            : "hidden md:flex",
        )}
      >
        <Outlet />
      </div>
    </div>
  );
}

function MiniChip({
  children,
  tone = "muted",
}: {
  children:
  React.ReactNode;
  tone?:
  | "muted"
  | "primary"
  | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium shrink-0 max-w-[110px] truncate",
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

function formatRelative(
  iso: string,
) {
  const date =
    new Date(iso);

  const now =
    new Date();

  const diff =
    now.getTime() -
    date.getTime();

  const minutes =
    Math.floor(
      diff / 60000,
    );

  if (minutes < 1) {
    return "الآن";
  }

  if (minutes < 60) {
    return `${minutes}د`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );

  if (hours < 24) {
    return `${hours}س`;
  }

  const days =
    Math.floor(
      hours / 24,
    );

  if (days === 1) {
    return "أمس";
  }

  if (days < 7) {
    return `${days}ي`;
  }

  return date.toLocaleDateString(
    "ar",
    {
      day: "2-digit",
      month: "2-digit",
    },
  );
}