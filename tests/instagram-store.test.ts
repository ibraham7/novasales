import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./helpers/fake-db.ts";
import {
  ALREADY_LINKED_MESSAGE,
  INSTAGRAM_PUBLIC_COLUMNS,
  disconnectInstagram,
  finishInstagramLink,
  handleInstagramEvents,
  instagramWindowForSession,
  refreshDueTokens,
  sendInstagramText,
  startInstagramLink,
  type InstagramDeps,
} from "../src/modules/channels/instagram/instagram-store.ts";
import { WINDOW_CLOSED_MESSAGE, parseInstagramWebhook } from "../src/modules/channels/instagram/instagram-core.ts";

const ORG_A = "org-a";
const ORG_B = "org-b";
const ALI = "user-ali";
const BOB = "user-bob";
const NOW = new Date("2026-11-20T12:00:00.000Z");

function makeDeps(overrides: Partial<InstagramDeps> = {}) {
  const sent: { igUserId: string; token: string; to: string; text: string }[] = [];
  const profiles: Record<string, { userId: string; username: string }> = { "token-ali": { userId: "IG_ALI", username: "ali_shop" }, "token-bob": { userId: "IG_BOB", username: "bob_shop" } };
  const deps: InstagramDeps = {
    now: () => NOW,
    seal: async (plain) => `sealed(${plain})`,
    open: async (cipher) => cipher.replace(/^sealed\((.*)\)$/, "$1"),
    exchangeCode: async (code) => ({ accessToken: `short-${code}`, userId: `app-scoped-${code}` }),
    longLivedToken: async (short) => ({ accessToken: short.replace("short-", "token-"), expiresIn: 5_184_000 }),
    refreshToken: async (token) => ({ accessToken: `${token}-new`, expiresIn: 5_184_000 }),
    fetchProfile: async (token) => ({ userId: profiles[token]?.userId ?? null, username: profiles[token]?.username ?? null }),
    subscribe: async () => undefined,
    sendMessage: async (igUserId, token, to, text) => {
      sent.push({ igUserId, token, to, text });
      return { messageId: `mid-${sent.length}` };
    },
    ...overrides,
  };
  return { deps, sent };
}

const link = async (db: any, deps: InstagramDeps, organizationId: string, userId: string, code: string) => {
  const { url } = await startInstagramLink(db, deps, { organizationId, userId, appId: "app", redirectUri: "https://x.example/channels" });
  const state = new URL(url).searchParams.get("state")!;
  return finishInstagramLink(db, deps, { organizationId, userId, code, state, redirectUri: "https://x.example/channels" });
};

test("linking creates an account owned by the person who linked it, with the token sealed and never stored plainly", async () => {
  const db = fakeDb();
  const { deps } = makeDeps();
  const result = await link(db, deps, ORG_A, ALI, "ali#_");
  assert.equal(result.username, "ali_shop");
  const accounts = db.tables.msg_channel_accounts;
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].organization_id, ORG_A);
  assert.equal(accounts[0].owner_user_id, ALI);
  assert.equal(accounts[0].external_ref, "IG_ALI");
  const plugin = db.tables.plugin_instagram_accounts[0];
  assert.equal(plugin.ig_user_id, "IG_ALI");
  assert.equal(plugin.access_token_cipher, "sealed(token-ali)");
  assert.equal(plugin.token_expires_at, "2027-01-19T12:00:00.000Z");
  assert.ok(!JSON.stringify(db.tables.msg_channel_accounts).includes("token-ali"));
  assert.equal(db.tables.msg_channels[0].channel_type, "instagram");
});

test("one person can link several accounts, each owned by them", async () => {
  const db = fakeDb();
  const { deps } = makeDeps({
    fetchProfile: async (token) => ({ userId: `IG_${token}`, username: `u_${token}` }),
  });
  await link(db, deps, ORG_A, ALI, "one");
  await link(db, deps, ORG_A, ALI, "two");
  await link(db, deps, ORG_A, ALI, "three");
  assert.equal(db.tables.msg_channel_accounts.filter((a: any) => a.owner_user_id === ALI).length, 3);
  assert.equal(db.tables.msg_channels.length, 1);
});

test("the return from Instagram works once, only for the person and organization that started it, and expires", async () => {
  const db = fakeDb();
  const { deps } = makeDeps();
  const start = async (organizationId: string, userId: string) => {
    const { url } = await startInstagramLink(db, deps, { organizationId, userId, appId: "app", redirectUri: "https://x.example/channels" });
    return new URL(url).searchParams.get("state")!;
  };
  const input = (organizationId: string, userId: string, state: string) => ({ organizationId, userId, code: "ali", state, redirectUri: "https://x.example/channels" });

  const stateA = await start(ORG_A, ALI);
  await assert.rejects(finishInstagramLink(db, deps, input(ORG_B, ALI, stateA)), /لا يخصك|انتهت/);
  await assert.rejects(finishInstagramLink(db, deps, input(ORG_A, BOB, stateA)), /لا يخصك|انتهت/);
  await assert.rejects(finishInstagramLink(db, deps, input(ORG_A, ALI, "forged")), /لا يخصك|انتهت/);
  assert.equal(db.tables.msg_channel_accounts?.length ?? 0, 0);
  await finishInstagramLink(db, deps, input(ORG_A, ALI, stateA));
  await assert.rejects(finishInstagramLink(db, deps, input(ORG_A, ALI, stateA)), /لا يخصك|انتهت|استخدام/);
  assert.equal(db.tables.msg_channel_accounts.length, 1);

  const late = await start(ORG_A, ALI);
  const later = makeDeps({ now: () => new Date(NOW.getTime() + 11 * 60_000) }).deps;
  await assert.rejects(finishInstagramLink(db, later, input(ORG_A, ALI, late)), /انتهت/);
});

test("an Instagram account already linked by one organization cannot be linked by another, and nothing changes", async () => {
  const db = fakeDb();
  const { deps } = makeDeps({ fetchProfile: async () => ({ userId: "IG_SHARED", username: "shared" }) });
  await link(db, deps, ORG_A, ALI, "a");
  const before = JSON.stringify(db.tables);
  await assert.rejects(link(db, deps, ORG_B, BOB, "b"), (error: Error) => error.message === ALREADY_LINKED_MESSAGE);
  const after = db.tables;
  assert.equal(after.msg_channel_accounts.filter((a: any) => a.organization_id === ORG_B).length, 0);
  assert.equal(after.plugin_instagram_accounts.length, 1);
  assert.equal(after.plugin_instagram_accounts[0].organization_id, ORG_A);
  // only the one-time state of the refused attempt was used up
  assert.equal(JSON.stringify({ ...after, channel_oauth_states: [] }), JSON.stringify({ ...JSON.parse(before), channel_oauth_states: [] }));
});

test("linking the same account again in the same organization renews it instead of adding a second", async () => {
  const db = fakeDb();
  const { deps } = makeDeps();
  await link(db, deps, ORG_A, ALI, "ali");
  db.tables.plugin_instagram_accounts[0].status = "needs_reconnect";
  const again = await link(db, deps, ORG_A, ALI, "ali");
  assert.equal(again.relinked, true);
  assert.equal(db.tables.plugin_instagram_accounts.length, 1);
  assert.equal(db.tables.msg_channel_accounts.length, 1);
  assert.equal(db.tables.plugin_instagram_accounts[0].status, "connected");
});

test("a failed notification subscription is reported to the person, not hidden", async () => {
  const db = fakeDb();
  const { deps } = makeDeps({ subscribe: async () => { throw new Error("Meta said no"); } });
  const result = await link(db, deps, ORG_A, ALI, "ali");
  assert.match(String(result.warning), /تعذر تفعيل استقبال الرسائل/);
  assert.match(db.tables.plugin_instagram_accounts[0].last_error, /webhook_subscription_failed/);
});

async function twoOrganizations() {
  const db = fakeDb();
  const made = makeDeps({ fetchProfile: async (token) => ({ userId: token === "token-ali" ? "IG_ALI" : "IG_BOB", username: token === "token-ali" ? "ali_shop" : "bob_shop" }) });
  await link(db, made.deps, ORG_A, ALI, "ali");
  await link(db, made.deps, ORG_B, BOB, "bob");
  db.calls.length = 0;
  return { db, ...made };
}

const notification = (igUserId: string, customerId: string, mid: string, text: string, extra: Record<string, unknown> = {}) => ({
  object: "instagram",
  entry: [{ id: igUserId, time: 1, messaging: [{ sender: { id: customerId }, recipient: { id: igUserId }, timestamp: NOW.getTime() - 60_000, message: { mid, text, ...extra } }] }],
});

test("a message to one organization's account is stored under that organization and its owner, never another", async () => {
  const { db, deps } = await twoOrganizations();
  const deals: any[] = [];
  const hooks = { onInbound: async (ctx: any) => { deals.push(ctx); } };
  await handleInstagramEvents(db, deps, parseInstagramWebhook(notification("IG_ALI", "CUST_1", "m1", "مرحبا")), hooks);
  await handleInstagramEvents(db, deps, parseInstagramWebhook(notification("IG_BOB", "CUST_1", "m2", "hello")), hooks);

  // the same customer id writing to two organizations is two separate people
  assert.equal(db.tables.msg_sessions.length, 2);
  const sessionA = db.tables.msg_sessions.find((s: any) => s.organization_id === ORG_A);
  const sessionB = db.tables.msg_sessions.find((s: any) => s.organization_id === ORG_B);
  assert.notEqual(sessionA.id, sessionB.id);
  assert.notEqual(sessionA.channel_account_id, sessionB.channel_account_id);
  const messageA = db.tables.msg_messages.find((m: any) => m.external_id === "m1");
  const messageB = db.tables.msg_messages.find((m: any) => m.external_id === "m2");
  assert.equal(messageA.organization_id, ORG_A);
  assert.equal(messageA.session_id, sessionA.id);
  assert.equal(messageB.organization_id, ORG_B);
  assert.equal(messageB.session_id, sessionB.id);
  assert.equal(db.tables.crm_contacts.filter((c: any) => c.organization_id === ORG_A).length, 1);
  assert.equal(db.tables.crm_contacts.filter((c: any) => c.organization_id === ORG_B).length, 1);
  assert.deepEqual(deals.map((d) => [d.organizationId, d.ownerUserId]), [[ORG_A, ALI], [ORG_B, BOB]]);
  assert.ok(db.tables.crm_contact_points.every((p: any) => p.channel_type === "instagram"));
  assert.ok(db.tables.domain_events.every((e: any) => [ORG_A, ORG_B].includes(e.organization_id)));
});

test("every read and change of conversation data is tied to one organization", async () => {
  const { db, deps } = await twoOrganizations();
  await handleInstagramEvents(db, deps, parseInstagramWebhook(notification("IG_ALI", "CUST_1", "m1", "مرحبا")));
  await handleInstagramEvents(db, deps, parseInstagramWebhook(notification("IG_ALI", "CUST_1", "m2", "again")));
  const scoped = ["msg_sessions", "msg_messages", "crm_contact_points", "crm_contacts", "msg_channel_accounts"];
  const unscoped = db.calls.filter(
    (call) => scoped.includes(call.table) && call.op !== "insert" && !call.filters.some(([op, column, value]) => op === "eq" && column === "organization_id" && value === ORG_A),
  );
  assert.deepEqual(unscoped, []);
});

test("a notification for an account that is not linked, or was disconnected, is ignored", async () => {
  const { db, deps } = await twoOrganizations();
  const none = await handleInstagramEvents(db, deps, parseInstagramWebhook(notification("IG_UNKNOWN", "CUST_1", "m1", "hi")));
  assert.equal(none.stored, 0);
  await disconnectInstagram(db, { organizationId: ORG_A, accountId: db.tables.msg_channel_accounts.find((a: any) => a.organization_id === ORG_A).id });
  const off = await handleInstagramEvents(db, deps, parseInstagramWebhook(notification("IG_ALI", "CUST_1", "m2", "hi")));
  assert.equal(off.stored, 0);
  assert.equal(db.tables.msg_messages?.length ?? 0, 0);
});

test("the same notification twice is stored once, and an echo of our own reply is not unread", async () => {
  const { db, deps } = await twoOrganizations();
  const payload = parseInstagramWebhook(notification("IG_ALI", "CUST_1", "m1", "hi"));
  await handleInstagramEvents(db, deps, payload);
  const again = await handleInstagramEvents(db, deps, payload);
  assert.equal(again.stored, 0);
  assert.equal(db.tables.msg_messages.length, 1);
  assert.equal(db.tables.msg_sessions[0].unread_count, 1);

  const echo = parseInstagramWebhook({ object: "instagram", entry: [{ id: "IG_ALI", messaging: [{ sender: { id: "IG_ALI" }, recipient: { id: "CUST_1" }, timestamp: NOW.getTime(), message: { mid: "m9", text: "رددت", is_echo: true } }] }] });
  await handleInstagramEvents(db, deps, echo);
  const stored = db.tables.msg_messages.find((m: any) => m.external_id === "m9");
  assert.equal(stored.direction, "outbound");
  assert.equal(db.tables.msg_sessions[0].unread_count, 1);
  assert.equal(db.tables.msg_sessions.length, 1);
});

test("a photo is copied to our storage when possible, and the message still arrives when it is not", async () => {
  const { db, deps } = await twoOrganizations();
  const photo = (mid: string) => parseInstagramWebhook(notification("IG_ALI", "CUST_1", mid, "", { text: undefined, attachments: [{ type: "image", payload: { url: `https://cdn.example/${mid}.jpg` } }] }));
  await handleInstagramEvents(db, { ...deps, storeImage: async (org, session) => `chat-media/${org}/${session}/p.jpg` }, photo("p1"));
  const ok = db.tables.msg_messages.find((m: any) => m.external_id === "p1");
  assert.equal(ok.message_type, "image");
  assert.match(ok.media_url, /^chat-media\/org-a\//);
  await handleInstagramEvents(db, { ...deps, storeImage: async () => { throw new Error("cdn gone"); } }, photo("p2"));
  const lost = db.tables.msg_messages.find((m: any) => m.external_id === "p2");
  assert.equal(lost.media_url, null);
  assert.equal(lost.content, "📷 صورة");
});

test("a new customer's name is taken from Instagram once, and a failure there never loses the message", async () => {
  const { db, deps } = await twoOrganizations();
  await handleInstagramEvents(db, { ...deps, customerProfile: async () => ({ name: "سارة", username: "sara" }) }, parseInstagramWebhook(notification("IG_ALI", "CUST_1", "m1", "hi")));
  assert.equal(db.tables.crm_contacts[0].display_name, "سارة");
  assert.equal(db.tables.msg_sessions[0].push_name, "سارة");
  await handleInstagramEvents(db, { ...deps, customerProfile: async () => { throw new Error("no"); } }, parseInstagramWebhook(notification("IG_ALI", "CUST_2", "m2", "hi")));
  assert.ok(db.tables.msg_messages.find((m: any) => m.external_id === "m2"));
});

async function withConversation(lastInboundAgoMs: number | null) {
  const made = await twoOrganizations();
  const { db, deps } = made;
  if (lastInboundAgoMs != null) {
    const at = new Date(NOW.getTime() - lastInboundAgoMs).toISOString();
    await handleInstagramEvents(db, deps, parseInstagramWebhook({ object: "instagram", entry: [{ id: "IG_ALI", messaging: [{ sender: { id: "CUST_1" }, recipient: { id: "IG_ALI" }, timestamp: new Date(at).getTime(), message: { mid: "in1", text: "hi" } }] }] }));
  }
  return made;
}

test("a reply goes out with the account's own token while the 24 hours are open, and is refused after", async () => {
  const open = await withConversation(2 * 3_600_000);
  const result = await sendInstagramText(open.db, open.deps, { igUserId: "IG_ALI", to: "CUST_1", text: "أهلاً" });
  assert.equal(result.externalId, "mid-1");
  assert.deepEqual(open.sent, [{ igUserId: "IG_ALI", token: "token-ali", to: "CUST_1", text: "أهلاً" }]);
  assert.ok(!JSON.stringify(result).includes("token-ali"));

  const closed = await withConversation(25 * 3_600_000);
  await assert.rejects(sendInstagramText(closed.db, closed.deps, { igUserId: "IG_ALI", to: "CUST_1", text: "late" }), (error: Error) => error.message === WINDOW_CLOSED_MESSAGE);
  assert.equal(closed.sent.length, 0);

  const never = await withConversation(null);
  await assert.rejects(sendInstagramText(never.db, never.deps, { igUserId: "IG_ALI", to: "CUST_1", text: "cold" }), (error: Error) => error.message === WINDOW_CLOSED_MESSAGE);
  assert.equal(never.sent.length, 0);
});

test("one organization's customer id cannot be answered through another organization's account", async () => {
  const made = await withConversation(2 * 3_600_000);
  // CUST_1 wrote to Ali's account only; Bob's account has no conversation with that id
  await assert.rejects(sendInstagramText(made.db, made.deps, { igUserId: "IG_BOB", to: "CUST_1", text: "x" }), (error: Error) => error.message === WINDOW_CLOSED_MESSAGE);
  assert.equal(made.sent.length, 0);
});

test("a long reply is sent in parts, and a dead or disconnected link refuses to send", async () => {
  const made = await withConversation(60_000);
  await sendInstagramText(made.db, made.deps, { igUserId: "IG_ALI", to: "CUST_1", text: "كلمة ".repeat(400) });
  assert.ok(made.sent.length > 1);
  assert.ok(made.sent.every((s) => new TextEncoder().encode(s.text).length <= 1000));

  made.db.tables.plugin_instagram_accounts.find((p: any) => p.ig_user_id === "IG_ALI").status = "needs_reconnect";
  await assert.rejects(sendInstagramText(made.db, made.deps, { igUserId: "IG_ALI", to: "CUST_1", text: "x" }), /انتهى ربط/);
});

test("the composer can ask how long a chat can still be answered", async () => {
  const made = await withConversation(2 * 3_600_000);
  const sessionId = made.db.tables.msg_sessions[0].id;
  const state = await instagramWindowForSession(made.db, made.deps, { organizationId: ORG_A, sessionId });
  assert.deepEqual(state, { open: true, expiresAt: "2026-11-21T10:00:00.000Z" });
  const other = await instagramWindowForSession(made.db, made.deps, { organizationId: ORG_B, sessionId });
  assert.equal(other.open, false);
});

test("tokens in their last week are renewed, dead ones are marked for re-linking, fresh ones are left alone", async () => {
  const db = fakeDb({
    plugin_instagram_accounts: [
      { organization_id: ORG_A, ig_user_id: "OK", access_token_cipher: "sealed(t-ok)", token_expires_at: "2027-01-10T00:00:00.000Z", token_refreshed_at: "2026-11-10T00:00:00.000Z", status: "connected" },
      { organization_id: ORG_A, ig_user_id: "DUE", access_token_cipher: "sealed(t-due)", token_expires_at: "2026-11-24T00:00:00.000Z", token_refreshed_at: "2026-09-25T00:00:00.000Z", status: "connected" },
      { organization_id: ORG_B, ig_user_id: "DEAD", access_token_cipher: "sealed(t-dead)", token_expires_at: "2026-11-19T00:00:00.000Z", token_refreshed_at: "2026-09-20T00:00:00.000Z", status: "connected" },
      { organization_id: ORG_B, ig_user_id: "YOUNG", access_token_cipher: "sealed(t-young)", token_expires_at: "2026-11-25T00:00:00.000Z", token_refreshed_at: "2026-11-20T06:00:00.000Z", status: "connected" },
      { organization_id: ORG_B, ig_user_id: "OFF", access_token_cipher: null, token_expires_at: null, status: "disconnected" },
    ],
  });
  const { deps } = makeDeps();
  const result = await refreshDueTokens(db, deps);
  assert.deepEqual(result, { refreshed: 1, expired: 1, failed: 0 });
  const by = (id: string) => db.tables.plugin_instagram_accounts.find((p: any) => p.ig_user_id === id);
  assert.equal(by("DUE").access_token_cipher, "sealed(t-due-new)");
  assert.equal(by("DUE").token_expires_at, "2027-01-19T12:00:00.000Z");
  assert.equal(by("OK").access_token_cipher, "sealed(t-ok)");
  assert.equal(by("DEAD").status, "needs_reconnect");
  assert.equal(by("YOUNG").access_token_cipher, "sealed(t-young)");
  assert.equal(by("OFF").status, "disconnected");
});

test("a failed renewal is recorded and the account keeps its old token", async () => {
  const db = fakeDb({
    plugin_instagram_accounts: [{ organization_id: ORG_A, ig_user_id: "DUE", access_token_cipher: "sealed(t-due)", token_expires_at: "2026-11-24T00:00:00.000Z", token_refreshed_at: "2026-09-25T00:00:00.000Z", status: "connected" }],
  });
  const { deps } = makeDeps({ refreshToken: async () => { throw new Error("network down"); } });
  assert.deepEqual(await refreshDueTokens(db, deps), { refreshed: 0, expired: 0, failed: 1 });
  assert.equal(db.tables.plugin_instagram_accounts[0].access_token_cipher, "sealed(t-due)");
  assert.match(db.tables.plugin_instagram_accounts[0].last_error, /refresh_failed: network down/);
});

test("only the organization that owns an account can disconnect it", async () => {
  const { db } = await twoOrganizations();
  const accountA = db.tables.msg_channel_accounts.find((a: any) => a.organization_id === ORG_A).id;
  await assert.rejects(disconnectInstagram(db, { organizationId: ORG_B, accountId: accountA }), /غير موجود/);
  assert.equal(db.tables.plugin_instagram_accounts.find((p: any) => p.ig_user_id === "IG_ALI").status, "connected");
  await disconnectInstagram(db, { organizationId: ORG_A, accountId: accountA });
  const row = db.tables.plugin_instagram_accounts.find((p: any) => p.ig_user_id === "IG_ALI");
  assert.equal(row.status, "disconnected");
  assert.equal(row.access_token_cipher, null);
});

test("the columns the browser may read never include the token", () => {
  assert.ok(!INSTAGRAM_PUBLIC_COLUMNS.includes("access_token"));
  assert.ok(!INSTAGRAM_PUBLIC_COLUMNS.includes("cipher"));
});
