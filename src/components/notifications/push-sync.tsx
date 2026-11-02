import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncPushSubscription } from "@/lib/push-device";

/** Keeps this device's subscription attached to the signed-in account. Renders nothing and never asks for permission. */
export function PushSync() {
  useEffect(() => {
    let lastUser: string | null = null;
    const sync = (userId: string | null | undefined) => {
      if (!userId || userId === lastUser) return;
      lastUser = userId;
      void syncPushSubscription().catch(() => undefined);
    };
    supabase.auth.getSession().then(({ data }) => sync(data.session?.user.id));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => sync(session?.user.id));
    return () => data.subscription.unsubscribe();
  }, []);
  return null;
}
