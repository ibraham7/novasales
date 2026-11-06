import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { buildOutboundReport } from "../src/modules/marketing/report-core.ts";

const ORG = "org-1";
const NOW = new Date("2026-11-10T12:00:00Z");
const rec = (campaign_id: string, status: string, extra: any = {}) => ({ organization_id: ORG, campaign_id, status, sent_at: null, replied_at: null, ...extra });

test("the report counts each stage, rates, daily sends, stop requests and the funnel", async () => {
  const db = fakeDb({
    cmp_campaigns: [
      { id: "c1", organization_id: ORG, kind: "outbound", name: "عرض", status: "completed", created_at: "2026-11-08T10:00:00Z" },
      { id: "c2", organization_id: ORG, kind: "outbound", name: "قديمة", status: "completed", created_at: "2026-08-01T10:00:00Z" },
      { id: "c3", organization_id: ORG, kind: "retention", name: "عادية", status: "completed", created_at: "2026-11-08T10:00:00Z" },
    ],
    cmp_recipients: [
      rec("c1", "read", { sent_at: "2026-11-09T09:00:00Z", replied_at: "2026-11-09T10:00:00Z" }),
      rec("c1", "delivered", { sent_at: "2026-11-09T09:01:00Z" }),
      rec("c1", "sent", { sent_at: "2026-11-10T09:02:00Z" }),
      rec("c1", "failed"),
      rec("c1", "queued"),
      rec("c2", "read", { sent_at: "2026-08-02T09:00:00Z" }),
      rec("c3", "read", { sent_at: "2026-11-09T09:00:00Z" }),
    ],
    ob_events: [{ organization_id: ORG, event_type: "opt_out", created_at: "2026-11-09T11:00:00Z" }, { organization_id: ORG, event_type: "opt_out", created_at: "2026-08-02T11:00:00Z" }, { organization_id: "org-2", event_type: "opt_out", created_at: "2026-11-09T11:00:00Z" }],
    ob_prospects: [{ organization_id: ORG, status: "replied" }, { organization_id: ORG, status: "replied" }, { organization_id: ORG, status: "converted" }, { organization_id: "org-2", status: "new" }],
  });
  const r = await buildOutboundReport(db, ORG, 30, NOW);
  assert.deepEqual(r.campaigns.map((c) => c.id), ["c1"]);
  assert.deepEqual(
    { recipients: r.totals.recipients, pending: r.totals.pending, sent: r.totals.sent, delivered: r.totals.delivered, read: r.totals.read, failed: r.totals.failed, replied: r.totals.replied, optOuts: r.totals.optOuts },
    { recipients: 5, pending: 1, sent: 3, delivered: 2, read: 1, failed: 1, replied: 1, optOuts: 1 },
  );
  assert.deepEqual([r.totals.deliveredRate, r.totals.readRate, r.totals.replyRate, r.totals.failedRate], [66.7, 33.3, 33.3, 20]);
  assert.equal(r.daily.length, 30);
  assert.deepEqual(r.daily.slice(-2), [{ date: "2026-11-09", sent: 2 }, { date: "2026-11-10", sent: 1 }]);
  assert.deepEqual(r.funnel, { replied: 2, converted: 1 });
});

test("an empty period gives zeros, not errors", async () => {
  const r = await buildOutboundReport(fakeDb({ cmp_campaigns: [], cmp_recipients: [], ob_events: [], ob_prospects: [] }), ORG, 7, NOW);
  assert.deepEqual([r.totals.recipients, r.totals.deliveredRate, r.totals.replyRate, r.daily.length, r.campaigns.length], [0, 0, 0, 7, 0]);
});
