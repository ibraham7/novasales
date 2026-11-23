import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import { dialable, loadMessageContext, pickWhatsappAccount } from "../src/modules/workflow/send/context.ts";

const ORG = "org-a";
function world(extra: Record<string, any[]> = {}) {
  return fakeDb({
    organizations: [{ id: ORG, name: "نوفا" }, { id: "org-b", name: "شركة ثانية" }],
    crm_contacts: [{ id: "c1", organization_id: ORG, display_name: "أحمد علي" }, { id: "cx", organization_id: "org-b", display_name: "غريب" }],
    crm_contact_points: [
      { organization_id: ORG, contact_id: "c1", channel_type: "whatsapp", identifier: "2763551@lid", is_primary: true },
      { organization_id: ORG, contact_id: "c1", channel_type: "whatsapp", identifier: "905321112233", is_primary: false },
      { organization_id: ORG, contact_id: "c1", channel_type: "email", identifier: "ahmad@example.com", is_primary: true },
    ],
    crm_pipeline_stages: [{ id: "st1", name: "عرض سعر", "crm_pipelines.organization_id": ORG }],
    opp_opportunities: [{ id: "o1", organization_id: ORG, contact_id: "c1", owner_agent_id: "u1", stage_id: "st1", source: "instagram_inbound", value: 1500, currency: "USD" }, { id: "ox", organization_id: "org-b", contact_id: "cx", owner_agent_id: "u9", stage_id: "st1" }],
    profiles: [{ id: "u1", full_name: "مياسة" }],
    crm_opportunity_sessions: [{ organization_id: ORG, opportunity_id: "o1", session_ref: "s-old" }, { organization_id: ORG, opportunity_id: "o1", session_ref: "s-new" }],
    msg_sessions: [{ id: "s-old", organization_id: ORG, channel_account_id: "acc-old", last_message_at: "2026-11-01T00:00:00Z" }, { id: "s-new", organization_id: ORG, channel_account_id: "acc-new", last_message_at: "2026-11-20T00:00:00Z" }],
    msg_channel_accounts: [
      { id: "acc-old", organization_id: ORG, status: "connected", owner_user_id: "u2" },
      { id: "acc-new", organization_id: ORG, status: "connected", owner_user_id: "u2" },
      { id: "acc-owner", organization_id: ORG, status: "connected", owner_user_id: "u1" },
    ],
    ...extra,
  });
}

test("a ticket event gives the customer, number, email, stage, owner, source, value and organization", async () => {
  const ctx = await loadMessageContext(world(), ORG, { opportunity_id: "o1" }, {});
  assert.deepEqual([ctx.contactId, ctx.opportunityId, ctx.ownerId], ["c1", "o1", "u1"]);
  assert.deepEqual([ctx.phone, ctx.email], ["905321112233", "ahmad@example.com"]);
  assert.deepEqual(ctx.vars, { name: "أحمد علي", first_name: "أحمد", phone: "905321112233", stage: "عرض سعر", assignee: "مياسة", source: "instagram_inbound", org: "نوفا", value: "1,500 USD", due_today: "", overdue: "", account: "", meeting_day: "", meeting_time: "", meeting_type: "", meeting_in: "" });
});

test("the event's own stage name and new owner win over what is stored (they are what just happened)", async () => {
  const ctx = await loadMessageContext(world({ profiles: [{ id: "u1", full_name: "مياسة" }, { id: "u3", full_name: "سارة" }] }), ORG, { opportunity_id: "o1", to_stage_name: "دفع", to_user_id: "u3" }, {});
  assert.deepEqual([ctx.vars.stage, ctx.vars.assignee, ctx.ownerId], ["دفع", "سارة", "u3"]);
});

test("the WhatsApp number is the ticket's newest connected chat, with the owner's number as the other choice", async () => {
  const ctx = await loadMessageContext(world(), ORG, { opportunity_id: "o1" }, {});
  assert.deepEqual([ctx.ticketAccountId, ctx.ownerAccountId], ["acc-new", "acc-owner"]);
  assert.equal(pickWhatsappAccount(undefined, ctx), "acc-new");
  assert.equal(pickWhatsappAccount("ticket", ctx), "acc-new");
  assert.equal(pickWhatsappAccount("owner", ctx), "acc-owner");
  assert.equal(pickWhatsappAccount("owner", { ticketAccountId: "t", ownerAccountId: null }), "t");
  assert.equal(pickWhatsappAccount("ticket", { ticketAccountId: null, ownerAccountId: "o" }), "o");
  assert.equal(pickWhatsappAccount("ticket", ctx, "named"), "named");
  const down = await loadMessageContext(world({ msg_channel_accounts: [{ id: "acc-new", organization_id: ORG, status: "disconnected" }, { id: "acc-old", organization_id: ORG, status: "connected" }] }), ORG, { opportunity_id: "o1" }, {});
  assert.equal(down.ticketAccountId, "acc-old");
});

test("an internal WhatsApp id is never used as a phone number; nothing from another organization is read", async () => {
  assert.equal(dialable("2763551@lid"), null);
  assert.equal(dialable("905321112233@s.whatsapp.net"), null);
  assert.equal(dialable("+90 532 111 22 33"), "905321112233");
  assert.equal(dialable("123"), null);
  const foreign = await loadMessageContext(world(), ORG, { opportunity_id: "ox" }, {});
  assert.deepEqual([foreign.opportunityId, foreign.contactId, foreign.phone], [null, null, null]);
  const other = await loadMessageContext(world(), "org-b", { opportunity_id: "o1" }, {});
  assert.equal(other.contactId, null);
});

test("a lead event (no ticket) still finds the customer, and missing pieces are empty, not errors", async () => {
  const w = world({ crm_leads: [{ id: "l1", organization_id: ORG, contact_id: "c1", owner_user_id: "u1" }] });
  const ctx = await loadMessageContext(w, ORG, { lead_id: "l1" }, {});
  assert.deepEqual([ctx.contactId, ctx.vars.name, ctx.vars.assignee, ctx.opportunityId], ["c1", "أحمد علي", "مياسة", null]);
  const none = await loadMessageContext(world(), ORG, {}, {});
  assert.deepEqual([none.contactId, none.phone, none.vars.name, none.vars.org], [null, null, "", "نوفا"]);
});
