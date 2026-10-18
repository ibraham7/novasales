/**
 * Runs due campaigns every minute inside the server process, so a launched campaign keeps sending
 * without anyone pressing «معالجة الحملات». Only on a long-running server (the VPS) and only when
 * CAMPAIGN_AUTO_TICK=1. The campaign lease stops two runs from sending the same message.
 */
let started = false;
let running = false;

export function startCampaignTicker() {
  if (started || process.env.CAMPAIGN_AUTO_TICK !== "1") return;
  started = true;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { tickCampaigns } = await import("./dispatcher.server");
      const { processed } = await tickCampaigns();
      if (processed) console.log(`[campaigns] sent ${processed}`);
    } catch (error) {
      console.error("[campaigns] run failed", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  setInterval(run, 60_000).unref?.();
  console.log("[campaigns] automatic sending is on");
}
