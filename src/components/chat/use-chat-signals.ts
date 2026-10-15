import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getChatRealtimeTopic } from "@/modules/messaging";

export type ChatSignal = { session_id: string; table: string; op: string };
type Listener = (signal: ChatSignal) => void;

// One private channel per topic, shared by every chat component on the page.
const listeners = new Set<Listener>();
let channel: RealtimeChannel | null = null;
let channelTopic: string | null = null;

async function connect(topic: string) {
  if (channelTopic === topic) return;
  disconnect();
  channelTopic = topic;
  // Private channels authorize with the user's access token.
  await supabase.realtime.setAuth();
  if (channelTopic !== topic) return;
  channel = supabase
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "chat_changed" }, ({ payload }) => {
      for (const listener of listeners) listener(payload as ChatSignal);
    })
    .subscribe();
}

function disconnect() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  channelTopic = null;
}

/** Calls `onSignal` whenever a chat in the organization gets a new or changed message. */
export function useChatSignals(onSignal: Listener) {
  const fetchTopic = useServerFn(getChatRealtimeTopic);
  const topic = useQuery({
    queryKey: ["chat-realtime-topic"],
    queryFn: () => fetchTopic(),
    staleTime: Infinity,
  }).data;
  const handler = useRef(onSignal);
  handler.current = onSignal;

  useEffect(() => {
    if (!topic) return;
    const listener: Listener = (signal) => handler.current(signal);
    listeners.add(listener);
    void connect(topic);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) disconnect();
    };
  }, [topic]);
}
