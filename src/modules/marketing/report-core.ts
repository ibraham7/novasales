/** Numbers for the outbound report: what was sent, how far it got, who answered, who asked to stop. */

export const REPORT_RANGES = [7, 30, 90] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export type Counts = { recipients: number; pending: number; sent: number; delivered: number; read: number; failed: number; skipped: number; replied: number };
const emptyCounts = (): Counts => ({ recipients: 0, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0 });

/** «sent» counts everything that left (sent, delivered, read); «delivered» includes read. */
function add(counts: Counts, row: { status: string; replied_at?: string | null }) {
  counts.recipients++;
  if (row.status === "queued" || row.status === "sending") counts.pending++;
  if (row.status === "failed") counts.failed++;
  if (row.status === "skipped") counts.skipped++;
  if (["sent", "delivered", "read"].includes(row.status)) counts.sent++;
  if (["delivered", "read"].includes(row.status)) counts.delivered++;
  if (row.status === "read") counts.read++;
  if (row.replied_at) counts.replied++;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export type OutboundReport = {
  days: number;
  totals: Counts & { deliveredRate: number; readRate: number; replyRate: number; failedRate: number; optOuts: number };
  campaigns: (Counts & { id: string; name: string; status: string; created_at: string; replyRate: number })[];
  daily: { date: string; sent: number }[];
  funnel: Record<string, number>;
};

export async function buildOutboundReport(db: any, organizationId: string, days: number, now = new Date()): Promise<OutboundReport> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  const { data: campaigns, error: campaignError } = await db
    .from("cmp_campaigns")
    .select("id,name,status,created_at")
    .eq("organization_id", organizationId)
    .eq("kind", "outbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);
  if (campaignError) throw new Error(campaignError.message);
  const ids: string[] = (campaigns ?? []).map((c: any) => c.id);

  const perCampaign = new Map<string, Counts>(ids.map((id) => [id, emptyCounts()]));
  const totals = emptyCounts();
  const bySendDay = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 50) {
    const { data: rows, error } = await db
      .from("cmp_recipients")
      .select("campaign_id,status,replied_at,sent_at")
      .eq("organization_id", organizationId)
      .in("campaign_id", ids.slice(i, i + 50))
      .limit(20000);
    if (error) throw new Error(error.message);
    for (const row of rows ?? []) {
      add(totals, row);
      const mine = perCampaign.get(row.campaign_id);
      if (mine) add(mine, row);
      if (row.sent_at && ["sent", "delivered", "read"].includes(row.status)) {
        const day = String(row.sent_at).slice(0, 10);
        bySendDay.set(day, (bySendDay.get(day) ?? 0) + 1);
      }
    }
  }

  const { data: events, error: eventError } = await db.from("ob_events").select("id").eq("organization_id", organizationId).eq("event_type", "opt_out").gte("created_at", since).limit(20000);
  if (eventError) throw new Error(eventError.message);

  const { data: prospects, error: prospectError } = await db.from("ob_prospects").select("status").eq("organization_id", organizationId).limit(20000);
  if (prospectError) throw new Error(prospectError.message);
  const funnel: Record<string, number> = {};
  for (const p of prospects ?? []) funnel[p.status] = (funnel[p.status] ?? 0) + 1;

  const shown = Math.min(days, 30);
  const daily = Array.from({ length: shown }, (_, i) => {
    const date = new Date(now.getTime() - (shown - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, sent: bySendDay.get(date) ?? 0 };
  });

  return {
    days,
    totals: { ...totals, deliveredRate: pct(totals.delivered, totals.sent), readRate: pct(totals.read, totals.sent), replyRate: pct(totals.replied, totals.sent), failedRate: pct(totals.failed, totals.recipients), optOuts: (events ?? []).length },
    campaigns: (campaigns ?? []).map((c: any) => {
      const counts = perCampaign.get(c.id) ?? emptyCounts();
      return { id: c.id, name: c.name, status: c.status, created_at: c.created_at, ...counts, replyRate: pct(counts.replied, counts.sent) };
    }),
    daily,
    funnel,
  };
}
