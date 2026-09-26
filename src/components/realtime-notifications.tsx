import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isSelfSendRecent } from "@/lib/self-send-guard";
import { listMyOwnedAccountIds } from "@/modules/channels";

/**
 * Live listener for inbound messages that belong to the current user's own
 * WhatsApp numbers only. Nobody gets alerts for someone else's number — not
 * even a supervisor for their team's numbers.
 */
export function RealtimeNotifications() {
  const qc = useQueryClient();
  const router = useRouter();
  const audioRef = useRef<AudioContext | null>(null);
  const fetchMine = useServerFn(listMyOwnedAccountIds);

  // Only query once we actually have a session; otherwise the protected
  // server fn throws "Unauthorized: invalid session" and blanks the screen.
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setHasSession(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const mineQ = useQuery({
    queryKey: ["my-owned-accounts"],
    queryFn: () => fetchMine().catch(() => ({ accountIds: [] as string[] })),
    enabled: hasSession,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const myAccountIds = useRef<Set<string>>(new Set());
  myAccountIds.current = new Set(mineQ.data?.accountIds ?? []);

  function beep() {
    try {
      const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioRef.current ?? new Ctx();
      audioRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume();
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);

      // Two-tone louder chime
      const tone = (freq: number, at: number, dur: number, peak: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + at;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      };
      tone(880, 0, 0.32, 0.85);
      tone(1320, 0.16, 0.36, 0.7);
    } catch {
      /* audio is best-effort */
    }
  }

  useEffect(() => {
    const ch = supabase
      .channel("global-inbound")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "msg_messages" },
        async (payload: any) => {
          const row = payload.new;
          // The pipeline route owns its coalesced realtime refresh. Invalidating
          // it here as well caused duplicate full board requests per message.
          qc.invalidateQueries({ queryKey: ["merged-chat"] });
          qc.invalidateQueries({ queryKey: ["chats"] });
          if (!row || row.direction !== "inbound" || row.is_internal) return;

          const preview =
            row.message_type && row.message_type !== "text"
              ? `📎 ${row.message_type}`
              : (row.content ?? "").slice(0, 90) || "رسالة جديدة";

          // Resolve customer name + destination, and verify the receiving
          // number belongs to this user before notifying.
          let name = "عميل";
          let target: string | null = null;
          try {
            const { data: sess } = await supabase
              .from("msg_sessions")
              .select("id, push_name, peer_identifier, channel_account_id")
              .eq("id", row.session_id)
              .maybeSingle();
            if (!sess) return;
            const accountId = (sess as any).channel_account_id as string | null;
            if (!accountId || !myAccountIds.current.has(accountId)) return; // not my number
            name =
              (sess as any).push_name ||
              String((sess as any).peer_identifier ?? "").split("@")[0] ||
              "عميل";
            const { data: link } = await supabase
              .from("crm_opportunity_sessions")
              .select("opportunity_id")
              .eq("session_ref", sess.id)
              .maybeSingle();
            target = link?.opportunity_id
              ? `/pipeline/${link.opportunity_id}`
              : `/chat/${sess.id}`;
          } catch {
            return; // can't verify ownership → stay silent
          }

          if (!isSelfSendRecent()) beep();
          toast.custom(
            (t) => (
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  toast.dismiss(t);
                  if (target) router.navigate({ to: target });
                }}
                className="cursor-pointer w-[360px] max-w-[90vw] rounded-xl border bg-card text-card-foreground shadow-lg px-4 py-3.5 flex items-start gap-3"
              >
                <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
                  {String(name).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-base truncate">{name}</div>
                  <div className="text-sm font-semibold text-muted-foreground truncate">
                    {preview}
                  </div>
                </div>
              </div>
            ),
            { duration: 8000 },
          );

        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "msg_sessions" },
        () => {
          qc.invalidateQueries({ queryKey: ["chats"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, router]);

  return null;
}
