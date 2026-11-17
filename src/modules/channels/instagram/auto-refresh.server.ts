/**
 * Keeps Instagram access tokens alive: a token lasts 60 days and must be renewed before then, so this
 * looks every six hours and renews those in their last week (and marks dead ones for re-linking).
 * Runs only on a long-lived server (the VPS) and only when the Instagram app is configured.
 */
import { isInstagramConfigured } from "./instagram-core";

let started = false;
let running = false;

export function startInstagramTokenRefresher() {
  if (started || !isInstagramConfigured()) return;
  started = true;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const [{ supabaseAdmin }, { refreshDueTokens }, { instagramDeps }] = await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("./instagram-store"),
        import("./instagram.server"),
      ]);
      const result = await refreshDueTokens(supabaseAdmin as any, instagramDeps());
      if (result.refreshed || result.expired || result.failed)
        console.log(`[instagram] tokens: renewed ${result.refreshed}, expired ${result.expired}, failed ${result.failed}`);
    } catch (error) {
      console.error("[instagram] token renewal failed", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 60_000).unref?.();
  setInterval(run, 6 * 3_600_000).unref?.();
  console.log("[instagram] token renewal is on");
}
