import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { fakeDb } from "./helpers/fake-db.ts";
import { saveMailbox, listMailboxes, loadMailbox, deleteMailbox } from "../src/modules/marketing/mailbox-core.ts";
import { sealSecret, openSecret } from "../src/modules/marketing/secret-box.ts";

const SECRET = "test-secret-key-0123456789";
async function smtp(okLogin: boolean) {
  const server = net.createServer((s) => {
    s.write("220 hi\r\n");
    s.on("data", (d) => {
      for (const l of String(d).split("\r\n").filter(Boolean)) {
        if (l.startsWith("EHLO")) s.write("250-x\r\n250 AUTH PLAIN\r\n");
        else if (l.startsWith("AUTH")) s.write(okLogin ? "235 ok\r\n" : "535 no\r\n");
        else if (l === "QUIT") s.end("221 bye\r\n");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { port: (server.address() as net.AddressInfo).port, close: () => server.close() };
}
const input = (port: number, extra = {}) => ({ organizationId: "o1", userId: "u1", label: "المبيعات", fromEmail: "Sales@Nova.com", smtpHost: "127.0.0.1", smtpPort: port, smtpSecurity: "none" as const, smtpUser: "sales@nova.com", smtpPass: "pw", dailyLimit: 40, ...extra });

test("secret box round-trips and rejects a wrong key", () => {
  const sealed = sealSecret("كلمة", SECRET);
  assert.notEqual(sealed, "كلمة");
  assert.equal(openSecret(sealed, SECRET), "كلمة");
  assert.throws(() => openSecret(sealed, "another-secret-key-9999"), /فك تشفير/);
});

test("a mailbox is saved only when the login works, the password is stored encrypted and never listed", async () => {
  const bad = await smtp(false);
  const db = fakeDb({ ob_mailboxes: [], ob_email_campaigns: [] });
  await assert.rejects(() => saveMailbox(db, { secret: SECRET, allowPrivate: true }, input(bad.port)), /كلمة السر/);
  bad.close();
  assert.equal((await listMailboxes(db, "o1")).length, 0);
  const good = await smtp(true);
  const { id } = await saveMailbox(db, { secret: SECRET, allowPrivate: true }, input(good.port));
  const listed = await listMailboxes(db, "o1");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].from_email, "sales@nova.com");
  assert.ok(!JSON.stringify(listed).includes("pw"));
  const stored = db.tables.ob_mailboxes[0];
  assert.notEqual(stored.smtp_pass_enc, "pw");
  const loaded = await loadMailbox(db, { secret: SECRET }, "o1", id);
  assert.equal(loaded?.smtp.pass, "pw");
  // editing without a new password keeps the old one
  await saveMailbox(db, { secret: SECRET, allowPrivate: true }, input(good.port, { id, smtpPass: "", label: "جديد" }));
  assert.equal((await loadMailbox(db, { secret: SECRET }, "o1", id))?.smtp.pass, "pw");
  // other organizations see nothing
  assert.equal(await loadMailbox(db, { secret: SECRET }, "o2", id), null);
  await deleteMailbox(db, "o1", id);
  good.close();
  assert.equal((await listMailboxes(db, "o1")).length, 0);
});

test("a mailbox with a running campaign cannot be deleted; odd ports and internal hosts are refused", async () => {
  const db = fakeDb({ ob_mailboxes: [{ id: "m1", organization_id: "o1" }], ob_email_campaigns: [{ id: "c1", organization_id: "o1", mailbox_id: "m1", status: "running" }] });
  await assert.rejects(() => deleteMailbox(db, "o1", "m1"), /حملة جارية/);
  await assert.rejects(() => saveMailbox(db, { secret: SECRET }, input(6379)), /منفذ/);
  await assert.rejects(() => saveMailbox(db, { secret: SECRET }, input(587, { smtpHost: "localhost" })), /غير مسموح|غير صالح/);
});
