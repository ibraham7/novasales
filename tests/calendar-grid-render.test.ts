import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Draws the real calendar grid on the server (day, week, month) with sample meetings and checks what the person would see.
test("the calendar grid draws day, week and month views from real components", () => {
  const dir = mkdtempSync(join(tmpdir(), "cal-render-"));
  try {
    const out = join(dir, "out.cjs");
    execFileSync("npx", ["esbuild", "tests/helpers/calendar-grid-render.tsx", "--bundle", "--platform=node", "--format=cjs", `--outfile=${out}`, "--alias:@=./src", "--jsx=automatic", "--log-level=error"], { stdio: "pipe" });
    const html = JSON.parse(execFileSync("node", [out], { env: { ...process.env, NODE_PATH: join(process.cwd(), "node_modules") }, stdio: "pipe" }).toString()) as Record<string, string>;
    assert.ok(html.day.includes("أحمد") && html.day.includes("مكالمة"), "day: both meetings of the day");
    assert.ok(!html.day.includes("سارة"), "day: a meeting of the next day is not drawn");
    assert.ok(html.week.includes("سارة") && html.week.includes("line-through"), "week: the cancelled meeting is drawn struck through");
    assert.ok(html.week.includes("inset-inline-start"), "RTL-safe positioning (logical start, not left/right)");
    assert.ok(!/(^|[ ;"])(left|right):/.test(html.week), "no physical left/right offsets");
    assert.equal((html.month.match(/role="button"/g) ?? []).length, 42, "month: 42 day cells");
    assert.ok(html.month.includes("أحمد") && html.month.includes("سارة"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
