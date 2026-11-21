import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, REASONS, evaluateGate, gapSeconds, type GateFacts } from "../src/modules/workflow/send/gate.ts";

// 2026-11-21 is a Saturday; Istanbul is UTC+3, so 12:00 UTC = 15:00 local (inside 09:00–20:00).
const NOON = new Date("2026-11-21T12:00:00Z");
const facts = (extra: Partial<GateFacts> = {}): GateFacts => ({
  channel: "whatsapp", kind: "service", now: NOON, settings: { ...DEFAULT_SETTINGS, sending_enabled: true },
  duplicate: false, blocked: false, promoConsent: false, hasPriorContact: true, allowFirstContact: false, sentToday: 0, lastSentAt: null, ...extra,
});

test("a normal service message to someone who wrote to us, inside the hours, is sent", () => {
  assert.deepEqual(evaluateGate(facts()), { action: "send" });
});

test("automatic sending is OFF by default: an organization without settings never sends", () => {
  assert.equal(DEFAULT_SETTINGS.sending_enabled, false);
  const d = evaluateGate(facts({ settings: DEFAULT_SETTINGS }));
  assert.deepEqual([d.action, (d as any).code], ["skip", "sending_off"]);
});

test("the checks run in order: duplicate before off, off before the stop list, stop list before consent", () => {
  const code = (f: Partial<GateFacts>) => (evaluateGate(facts(f)) as any).code;
  assert.equal(code({ duplicate: true, settings: DEFAULT_SETTINGS, blocked: true }), "duplicate");
  assert.equal(code({ settings: DEFAULT_SETTINGS, blocked: true }), "sending_off");
  assert.equal(code({ blocked: true, kind: "promo" }), "opted_out");
  assert.equal(code({ kind: "promo", promoConsent: false }), "no_promo_consent");
});

test("a customer on the stop list is never messaged, service or promo", () => {
  for (const kind of ["service", "promo"] as const) assert.equal((evaluateGate(facts({ blocked: true, kind, promoConsent: true })) as any).code, "opted_out");
});

test("promo needs explicit consent; service needs that the customer wrote to us first, unless the step allows a first contact", () => {
  assert.equal(evaluateGate(facts({ kind: "promo", promoConsent: true })).action, "send");
  assert.equal((evaluateGate(facts({ hasPriorContact: false })) as any).code, "no_prior_contact");
  assert.equal(evaluateGate(facts({ hasPriorContact: false, allowFirstContact: true })).action, "send");
  // a promo never rides on «first contact allowed»
  assert.equal((evaluateGate(facts({ kind: "promo", hasPriorContact: false, allowFirstContact: true })) as any).code, "no_promo_consent");
});

test("outside the sending hours of the organization's time zone the message waits for the opening, not forever", () => {
  const night = new Date("2026-11-21T00:30:00Z"); // 03:30 in Istanbul
  const d: any = evaluateGate(facts({ now: night }));
  assert.deepEqual([d.action, d.code], ["defer", "outside_hours"]);
  assert.equal(d.notBefore.toISOString(), "2026-11-21T06:00:00.000Z"); // 09:00 Istanbul
  const late = new Date("2026-11-21T18:00:00Z"); // 21:00 Istanbul, after closing
  const l: any = evaluateGate(facts({ now: late }));
  assert.equal(l.notBefore.toISOString(), "2026-11-22T06:00:00.000Z");
  // the same instant in another zone is a different local hour
  const other: any = evaluateGate(facts({ now: night, settings: { ...DEFAULT_SETTINGS, sending_enabled: true, timezone: "America/New_York" } }));
  assert.equal(other.action, "send"); // 19:30 the evening before, inside 09:00–20:00 there
});

test("the day's limit holds the message until the next opening", () => {
  const d: any = evaluateGate(facts({ sentToday: 100 }));
  assert.deepEqual([d.action, d.code], ["defer", "daily_limit"]);
  assert.equal(d.notBefore.toISOString(), "2026-11-22T06:00:00.000Z");
  assert.equal(evaluateGate(facts({ sentToday: 99 })).action, "send");
});

test("WhatsApp keeps a gap after the previous message; email does not; the gap is stable for the same previous message", () => {
  const last = new Date(NOON.getTime() - 10_000);
  const d: any = evaluateGate(facts({ lastSentAt: last }));
  assert.deepEqual([d.action, d.code], ["defer", "gap"]);
  const gap = (d.notBefore.getTime() - last.getTime()) / 1000;
  assert.ok(gap >= 45 && gap <= 180);
  assert.equal((evaluateGate(facts({ lastSentAt: last })) as any).notBefore.getTime(), d.notBefore.getTime());
  assert.equal(evaluateGate(facts({ lastSentAt: new Date(NOON.getTime() - 200_000) })).action, "send");
  assert.equal(evaluateGate(facts({ channel: "email", lastSentAt: last })).action, "send");
});

test("gaps stay inside the chosen range and differ between messages", () => {
  const values = new Set<number>();
  for (let i = 0; i < 40; i++) {
    const g = gapSeconds(`m${i}`, 45, 180);
    assert.ok(g >= 45 && g <= 180);
    values.add(g);
  }
  assert.ok(values.size > 10);
  assert.equal(gapSeconds("x", 60, 60), 60);
  assert.ok(gapSeconds("x", 180, 45) >= 45); // reversed bounds are tolerated
});

test("invalid hours are a skip with a reason, never a send; every outcome has an Arabic reason", () => {
  const bad: any = evaluateGate(facts({ settings: { ...DEFAULT_SETTINGS, sending_enabled: true, send_window_start: "09:00", send_window_end: "09:30" } }));
  assert.deepEqual([bad.action, bad.code], ["skip", "bad_settings"]);
  for (const key of ["duplicate", "sending_off", "opted_out", "no_promo_consent", "no_prior_contact", "bad_settings", "outside_hours", "daily_limit", "gap", "expired", "no_address", "no_account", "interrupted", "send_failed"]) assert.ok(/[؀-ۿ]/.test(REASONS[key] ?? ""), key);
});
