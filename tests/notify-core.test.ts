import { test } from "node:test";
import assert from "node:assert/strict";
import { createNotifier } from "../src/modules/notifications/notify-core.ts";

/** A tiny in-memory stand-in for the supabase client: only what the notifier uses. */
function fakeDb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const unique: Record<string, string[]> = { push_messages: ["recipient_user_id", "dedupe_key"] };
  let counter = 0;
  class Query {
    private filters: ((row: any) => boolean)[] = [];
    private op: "select" | "upsert" | "update" | "delete" = "select";
    private payload: any;
    private options: any;
    private returning = false;
    private rowLimit = Infinity;
    private table: string;
    constructor(table: string) {
      this.table = table;
      tables[table] ??= [];
    }
    select() {
      this.returning = true;
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push((r) => r[column] === value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push((r) => values.includes(r[column]));
      return this;
    }
    limit(n: number) {
      this.rowLimit = n;
      return this;
    }
    order() {
      return this;
    }
    upsert(rows: any[], options: any) {
      this.op = "upsert";
      this.payload = rows;
      this.options = options;
      return this;
    }
    update(patch: any) {
      this.op = "update";
      this.payload = patch;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    private matches() {
      return tables[this.table].filter((r) => this.filters.every((f) => f(r)));
    }
    private run() {
      const rows = tables[this.table];
      if (this.op === "select") return { data: this.matches().slice(0, this.rowLimit).map((r) => ({ ...r })), error: null };
      if (this.op === "update") {
        const hit = this.matches();
        hit.forEach((r) => Object.assign(r, this.payload));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (this.op === "delete") {
        const hit = new Set(this.matches());
        tables[this.table] = rows.filter((r) => !hit.has(r));
        return { data: [], error: null };
      }
      const inserted: any[] = [];
      for (const row of this.payload) {
        const keys = unique[this.table];
        if (keys && keys.every((k) => row[k] != null) && rows.some((r) => keys.every((k) => r[k] === row[k]))) {
          if (this.options?.ignoreDuplicates) continue;
        }
        const stored = { id: `id-${++counter}`, ...row };
        rows.push(stored);
        inserted.push({ ...stored });
      }
      return { data: inserted, error: null };
    }
    then(resolve: (value: any) => void, reject?: (reason: any) => void) {
      try {
        resolve(this.run());
      } catch (e) {
        reject?.(e);
      }
    }
  }
  return { tables, from: (table: string) => new Query(table) };
}

const ORG = "org-1";
const VAPID = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" };
const member = (user_id: string, organization_id = ORG, is_active = true) => ({ user_id, organization_id, is_active });
const device = (id: string, user_id: string, endpoint: string, failure_count = 0) => ({ id, organization_id: ORG, user_id, endpoint, p256dh: "k", auth: "a", failure_count });

function setup(seed: Record<string, any[]>, vapid: typeof VAPID | null = VAPID) {
  const db = fakeDb(seed);
  const sent: { endpoint: string; payload: any }[] = [];
  const notifier = createNotifier({
    db,
    vapid: () => vapid,
    send: async (subscription, payload) => {
      sent.push({ endpoint: subscription.endpoint, payload });
      if (subscription.endpoint.startsWith("gone")) return { ok: false, status: 410, gone: true, error: "HTTP 410" };
      if (subscription.endpoint.startsWith("fail")) return { ok: false, status: 500, gone: false, error: "HTTP 500" };
      return { ok: true, status: 201, gone: false };
    },
  });
  return { db, sent, ...notifier };
}

test("only active members who kept the type on are notified, never the actor", async () => {
  const { db, sent, notifyUsers } = setup({
    org_memberships: [member("m1"), member("m2"), member("m3", ORG, false), member("outsider", "other-org"), member("actor")],
    push_preferences: [{ organization_id: ORG, user_id: "m2", disabled_types: ["lead_created"] }],
    push_subscriptions: [device("d1", "m1", "https://a/1"), device("d2", "m1", "https://a/2"), device("d3", "m2", "https://a/3"), device("d4", "m3", "https://a/4"), device("d5", "outsider", "https://a/5"), device("d6", "actor", "https://a/6")],
  });
  const result = await notifyUsers({ organizationId: ORG, type: "lead_created", userIds: ["m1", "m2", "m3", "outsider", "actor"], excludeUserId: "actor", title: "عميل جديد", body: "أحمد", url: "/leads", dedupeKey: "lead:1" });
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), ["https://a/1", "https://a/2"]);
  assert.equal(result.accepted, 1);
  const [row] = db.tables.push_messages;
  assert.equal(row.recipient_user_id, "m1");
  assert.equal(row.status, "accepted");
  assert.equal(row.devices_total, 2);
  assert.equal(row.devices_accepted, 2);
  // The device is told the id of its log row, so it can report back that it showed the notification.
  assert.equal(sent[0].payload.id, row.id);
  assert.equal(sent[0].payload.url, "/leads");
});

test("the same event never notifies the same person twice", async () => {
  const { sent, notifyUsers } = setup({ org_memberships: [member("m1")], push_subscriptions: [device("d1", "m1", "https://a/1")] });
  const input = { organizationId: ORG, type: "sale_created" as const, userIds: ["m1"], title: "بيع", dedupeKey: "sale_created:9" };
  const first = await notifyUsers(input);
  const second = await notifyUsers(input);
  assert.equal(first.accepted, 1);
  assert.equal(second.duplicates, 1);
  assert.equal(second.accepted, 0);
  assert.equal(sent.length, 1);
});

test("a subscription the push service reports gone is removed, and the message is marked failed", async () => {
  const { db, notifyUsers } = setup({ org_memberships: [member("m1")], push_subscriptions: [device("d1", "m1", "gone://1"), device("d2", "m1", "https://ok/2")] });
  await notifyUsers({ organizationId: ORG, type: "assignment", userIds: ["m1"], title: "t" });
  assert.deepEqual(db.tables.push_subscriptions.map((s) => s.id), ["d2"]);
  const [row] = db.tables.push_messages;
  assert.equal(row.status, "accepted");
  assert.equal(row.devices_failed, 1);
});

test("a device that keeps failing is dropped after ten failures", async () => {
  const { db, notifyUsers } = setup({ org_memberships: [member("m1")], push_subscriptions: [device("d1", "m1", "fail://1", 8)] });
  await notifyUsers({ organizationId: ORG, type: "assignment", userIds: ["m1"], title: "a", dedupeKey: "k1" });
  assert.equal(db.tables.push_subscriptions[0].failure_count, 9);
  assert.equal(db.tables.push_messages[0].status, "failed");
  await notifyUsers({ organizationId: ORG, type: "assignment", userIds: ["m1"], title: "b", dedupeKey: "k2" });
  assert.equal(db.tables.push_subscriptions.length, 0);
});

test("people without a device get a log row only when asked (manual sends)", async () => {
  const quiet = setup({ org_memberships: [member("m1")] });
  const r1 = await quiet.notifyUsers({ organizationId: ORG, type: "lead_created", userIds: ["m1"], title: "t" });
  assert.equal(quiet.db.tables.push_messages?.length ?? 0, 0);
  assert.equal(r1.accepted, 0);
  const manual = setup({ org_memberships: [member("m1")] });
  const r2 = await manual.notifyUsers({ organizationId: ORG, type: "manual", userIds: ["m1"], title: "t", logNoDevice: true });
  assert.equal(manual.db.tables.push_messages[0].status, "no_device");
  assert.equal(r2.noDevice, 1);
});

test("nothing is sent or written when the VAPID keys are not set", async () => {
  const { db, sent, notifyUsers } = setup({ org_memberships: [member("m1")], push_subscriptions: [device("d1", "m1", "https://a/1")] }, null);
  const result = await notifyUsers({ organizationId: ORG, type: "manual", userIds: ["m1"], title: "t" });
  assert.equal(result.configured, false);
  assert.equal(sent.length, 0);
  assert.equal(db.tables.push_messages?.length ?? 0, 0);
});

test("managers are the holders of org.manage plus the department's supervisors", async () => {
  const { resolveManagerIds } = setup({
    rbac_role_permissions: [{ role_id: "r-admin", permission_key: "org.manage" }, { role_id: "r-sales", permission_key: "crm.leads.view" }],
    rbac_user_roles: [
      { organization_id: ORG, role_id: "r-admin", user_id: "boss" },
      { organization_id: ORG, role_id: "r-sales", user_id: "rep" },
      { organization_id: "other", role_id: "r-admin", user_id: "foreign-boss" },
    ],
    org_department_members: [
      { organization_id: ORG, department_id: "d1", user_id: "sup1", is_supervisor: true, is_active: true },
      { organization_id: ORG, department_id: "d1", user_id: "rep", is_supervisor: false, is_active: true },
      { organization_id: ORG, department_id: "d2", user_id: "sup2", is_supervisor: true, is_active: true },
    ],
  });
  assert.deepEqual((await resolveManagerIds(ORG, "d1")).sort(), ["boss", "sup1"]);
  assert.deepEqual(await resolveManagerIds(ORG, null), ["boss"]);
});

test("audiences resolve to active members of the organization only", async () => {
  const { resolveAudienceUserIds } = setup({
    org_memberships: [member("a"), member("b"), member("c", ORG, false), member("z", "other")],
    org_department_members: [
      { organization_id: ORG, department_id: "d1", user_id: "a", is_active: true },
      { organization_id: ORG, department_id: "d2", user_id: "b", is_active: true },
      { organization_id: ORG, department_id: "d1", user_id: "c", is_active: false },
    ],
  });
  assert.deepEqual((await resolveAudienceUserIds(ORG, { kind: "all" })).sort(), ["a", "b"]);
  assert.deepEqual(await resolveAudienceUserIds(ORG, { kind: "departments", departmentIds: ["d1"] }), ["a"]);
  // Asking for a member of another organization returns nobody for them.
  assert.deepEqual((await resolveAudienceUserIds(ORG, { kind: "users", userIds: ["a", "z", "c"] })).sort(), ["a"]);
});
