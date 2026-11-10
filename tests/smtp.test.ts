import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { buildMime, smtpSend, smtpVerify, assertPublicMailHost } from "../src/modules/marketing/smtp.ts";

type Script = { auth?: "ok" | "bad"; rcpt?: number; busy?: boolean };

/** A tiny SMTP server that records what it is given. */
async function fakeServer(script: Script = {}) {
  const log: string[] = [];
  let message = "";
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let inData = false;
    let buffer = "";
    socket.write(script.busy ? "421 try later\r\n" : "220 fake ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (inData) {
        if (buffer.endsWith("\r\n.\r\n")) {
          message = buffer.slice(0, -5);
          buffer = "";
          inData = false;
          socket.write("250 queued as 42\r\n");
        }
        return;
      }
      for (const line of buffer.split("\r\n").slice(0, -1)) {
        log.push(line.startsWith("AUTH PLAIN") ? "AUTH PLAIN <secret>" : line);
        if (line.startsWith("EHLO")) socket.write("250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (line.startsWith("AUTH PLAIN")) socket.write(script.auth === "bad" ? "535 5.7.8 bad credentials\r\n" : "235 ok\r\n");
        else if (line.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
        else if (line.startsWith("RCPT TO")) socket.write(`${script.rcpt ?? 250} ${script.rcpt && script.rcpt >= 400 ? "no such user" : "ok"}\r\n`);
        else if (line === "DATA") {
          socket.write("354 go\r\n");
          inData = true;
        } else if (line === "QUIT") socket.end("221 bye\r\n");
      }
      buffer = inData ? buffer.slice(buffer.lastIndexOf("\r\n") + 2) : "";
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return { port, log, message: () => message, close: () => server.close() };
}

const mail = { from: { name: "شركة نوفا", email: "sales@nova.com" }, to: "info@clinic.com", subject: "عرض خاص", text: "مرحباً\n.نقطة بأول السطر", html: "<p>مرحباً</p>", messageId: "abc@nova.com", headers: { "List-Unsubscribe": "<https://x/u/1>" } };
const cfg = (port: number) => ({ host: "127.0.0.1", port, security: "none" as const, user: "sales@nova.com", pass: "p@ss word" });

test("a message goes through the server: login, sender, recipient, body, and the password never appears in clear text in the log", async () => {
  const s = await fakeServer();
  const r = await smtpSend(cfg(s.port), mail, { allowPrivate: true });
  s.close();
  assert.equal(r.ok, true);
  assert.deepEqual(s.log.filter((l) => /^(EHLO|AUTH|MAIL|RCPT|DATA|QUIT)/.test(l)), ["EHLO nova.com", "AUTH PLAIN <secret>", "MAIL FROM:<sales@nova.com>", "RCPT TO:<info@clinic.com>", "DATA", "QUIT"]);
  const m = s.message();
  assert.match(m, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <sales@nova\.com>/m);
  assert.match(m, /^To: <info@clinic\.com>/m);
  assert.match(m, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(m, /^List-Unsubscribe: <https:\/\/x\/u\/1>/m);
  assert.match(m, /^Message-ID: <abc@nova\.com>/m);
  const parts = [...m.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/g)].map((x) => Buffer.from(x[1]!.replace(/\r\n/g, ""), "base64").toString("utf8"));
  assert.deepEqual(parts, [mail.text, mail.html]);
});

test("verifying logs in and sends nothing; wrong credentials are reported as an authentication problem", async () => {
  const ok = await fakeServer();
  assert.equal((await smtpVerify(cfg(ok.port), { allowPrivate: true })).ok, true);
  assert.equal(ok.message(), "");
  ok.close();
  const bad = await fakeServer({ auth: "bad" });
  const r = await smtpVerify(cfg(bad.port), { allowPrivate: true });
  bad.close();
  assert.equal(r.ok, false);
  assert.deepEqual([!r.ok && r.auth, !r.ok && r.retry], [true, false]);
});

test("a refused recipient is final, a busy server can be retried", async () => {
  const a = await fakeServer({ rcpt: 550 });
  const refused = await smtpSend(cfg(a.port), mail, { allowPrivate: true });
  a.close();
  assert.deepEqual([refused.ok, !refused.ok && refused.retry], [false, false]);
  const b = await fakeServer({ busy: true });
  const busy = await smtpSend(cfg(b.port), mail, { allowPrivate: true });
  b.close();
  assert.deepEqual([busy.ok, !busy.ok && busy.retry], [false, true]);
});

test("a header cannot be smuggled in through the subject or name, and internal hosts are refused", async () => {
  const m = buildMime({ ...mail, subject: "hi\r\nBcc: evil@x.com", from: { name: "A\r\nBcc: x@y.com", email: "s@n.com" } }, "B");
  assert.doesNotMatch(m, /^Bcc:/im);
  await assert.rejects(() => assertPublicMailHost("localhost"), /غير مسموح/);
  await assert.rejects(() => assertPublicMailHost("10.0.0.5"), /غير مسموح/);
  await assert.rejects(() => assertPublicMailHost("192.168.1.1"), /غير مسموح/);
});
