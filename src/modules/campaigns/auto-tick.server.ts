/**
 * Runs due campaigns every minute inside the server process, so a launched campaign keeps sending
 * without anyone pressing «معالجة الحملات». Only on a long-running server (the VPS) and only when
 * CAMPAIGN_AUTO_TICK=1. The campaign lease stops two runs from sending the same message.
 * The same minute also sends each organization's ad conversions to its own Meta pixel.
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
    }
    try {
      const { tickEmailCampaigns } = await import("@/modules/marketing/email-send.server");
      const { processed } = await tickEmailCampaigns();
      if (processed) console.log(`[email] sent ${processed}`);
    } catch (error) {
      console.error("[email] run failed", error instanceof Error ? error.message : error);
    }
    try {
      const { deliverGa4Conversions } = await import("@/modules/integrations/ga4-capi.server");
      const { sent } = await deliverGa4Conversions();
      if (sent) console.log(`[conversions] sent ${sent} to Google Analytics`);
    } catch (error) {
      console.error("[conversions] ga4 run failed", error instanceof Error ? error.message : error);
    }
    try {
      const { runWorkflowTick } = await import("@/modules/workflow/auto-tick.server");
      const result = await runWorkflowTick();
      if (result && (result.processed || result.failed || result.skipped)) console.log(`[workflow] processed ${result.processed}, failed ${result.failed}, skipped ${result.skipped}`);
    } catch (error) {
      console.error("[workflow] run failed", error instanceof Error ? error.message : error);
    }
    try {
      const { tickRedistributionSends } = await import("@/modules/assignments/redistribute-send.server");
      const { processed } = await tickRedistributionSends();
      if (processed) console.log(`[redistribute] sent ${processed}`);
    } catch (error) {
      console.error("[redistribute] run failed", error instanceof Error ? error.message : error);
    }
    try {
      const { deliverMetaConversions } = await import("@/modules/integrations/meta-capi.server");
      const { sent } = await deliverMetaConversions();
      if (sent) console.log(`[conversions] sent ${sent} to Meta`);
    } catch (error) {
      console.error("[conversions] run failed", error instanceof Error ? error.message : error);
    }
    try {
      const { notifyDueTasks } = await import("@/modules/notifications/events.server");
      await notifyDueTasks();
    } catch (error) {
      console.error("[push] due tasks failed", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  setInterval(run, 60_000).unref?.();
  console.log("[campaigns] automatic sending is on");
}
