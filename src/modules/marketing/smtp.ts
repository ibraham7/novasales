/**
 * A small SMTP client for a customer's own mailbox (Gmail, Outlook, their hosting, …): implicit TLS (465)
 * or STARTTLS (587), AUTH PLAIN or LOGIN, one message per connection. Only Node's built-in `net` and `tls`.
 * The mail server's host is checked first, so a customer cannot point it at the server's internal network.
 */
import net from "node:net";
import tls from "node:tls";
import { lookup } from "node:dns/promises";
import { isBlockedHostname, isPrivateIp } from "./url-safety.ts";

export type SmtpSecurity = "ssl" | "starttls" | "none";
export type SmtpConfig = { host: string; port: number; security: SmtpSecurity; user: string; pass: string };
export type SmtpResult = { ok: true; response: string } | { ok: false; error: string; retry: boolean; auth?: boolean };

export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];
const STEP_TIMEOUT_MS = 20_000;

/** Throws when the host is internal or resolves to a private address. `allowPrivate` is for tests only. */
export async function assertPublicMailHost(host: string, allowPrivate = false) {
  if (allowPrivate) return;
  if (isBlockedHostname(host)) throw new Error("عنوان خادم البريد غير مسموح");
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new Error("تعذر العثور على خادم البريد؛ تحقق من العنوان");
  if (addresses.some((a) => isPrivateIp(a.address))) throw new Error("عنوان خادم البريد غير مسموح");
}

/* ------------------------------ one connection ------------------------------ */

class Conn {
  private buffer = "";
  private waiting: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private error: Error | null = null;
  socket: net.Socket;
  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.deliver();
    });
    socket.on("error", (e) => this.fail(e));
    socket.on("close", () => this.fail(new Error("انقطع الاتصال بخادم البريد")));
  }
  private fail(e: Error) {
    this.error = this.error ?? e;
    if (this.waiting) {
      clearTimeout(this.waiting.timer);
      this.waiting.reject(this.error);
      this.waiting = null;
    }
  }
  private deliver() {
    if (!this.waiting) return;
    const lines = this.buffer.split("\r\n");
    // A reply is complete at the first line shaped «250 text» (a space after the code); «250-text» continues it.
    const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
    if (end < 0 || end === lines.length - 1 && !this.buffer.endsWith("\r\n")) return;
    const reply = lines.slice(0, end + 1);
    this.buffer = lines.slice(end + 1).join("\r\n");
    const { resolve, timer } = this.waiting;
    clearTimeout(timer);
    this.waiting = null;
    resolve({ code: Number(reply[end]!.slice(0, 3)), text: reply.map((l) => l.slice(4)).join("\n") });
  }
  reply(timeoutMs = STEP_TIMEOUT_MS): Promise<{ code: number; text: string }> {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error("انتهت مهلة خادم البريد"));
      }, timeoutMs);
      this.waiting = { resolve, reject, timer };
      this.deliver();
    });
  }
  write(data: string) {
    this.socket.write(data);
  }
  async command(line: string, timeoutMs?: number) {
    this.write(`${line}\r\n`);
    return this.reply(timeoutMs);
  }
  close() {
    this.socket.destroy();
  }
}

function connect(config: SmtpConfig, allowPrivate: boolean): Promise<Conn> {
  return new Promise(async (resolve, reject) => {
    try {
      await assertPublicMailHost(config.host, allowPrivate);
    } catch (e) {
      return reject(e);
    }
    const timer = setTimeout(() => reject(new Error("انتهت مهلة الاتصال بخادم البريد")), STEP_TIMEOUT_MS);
    const done = (socket: net.Socket) => {
      clearTimeout(timer);
      resolve(new Conn(socket));
    };
    const socket =
      config.security === "ssl"
        ? tls.connect({ host: config.host, port: config.port, servername: config.host }, () => done(socket))
        : net.connect({ host: config.host, port: config.port }, () => done(socket));
    socket.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const failure = (stage: string, r: { code: number; text: string }, auth = false): SmtpResult => ({
  ok: false,
  error: `${stage}: ${r.code} ${r.text.replace(/\s+/g, " ").slice(0, 200)}`,
  retry: r.code >= 400 && r.code < 500,
  ...(auth ? { auth: true } : {}),
});

/** Connects, upgrades and logs in. The returned connection is ready for MAIL FROM. */
async function open(config: SmtpConfig, ehloName: string, allowPrivate: boolean): Promise<{ conn: Conn } | { result: SmtpResult }> {
  const handle: { conn?: Conn } = {};
  const out = await openInner(config, ehloName, allowPrivate, handle);
  if ('result' in out) handle.conn?.close();
  return out;
}

async function openInner(config: SmtpConfig, ehloName: string, allowPrivate: boolean, handle: { conn?: Conn }): Promise<{ conn: Conn } | { result: SmtpResult }> {
  let conn: Conn;
  try {
    conn = await connect(config, allowPrivate);
    handle.conn = conn;
  } catch (e) {
    return { result: { ok: false, error: e instanceof Error ? e.message : "تعذر الاتصال بخادم البريد", retry: true } };
  }
  try {
    const greeting = await conn.reply();
    if (greeting.code !== 220) return { result: failure("ترحيب الخادم", greeting) };
    let ehlo = await conn.command(`EHLO ${ehloName}`);
    if (ehlo.code !== 250) return { result: failure("EHLO", ehlo) };
    if (config.security === "starttls") {
      const start = await conn.command("STARTTLS");
      if (start.code !== 220) return { result: failure("STARTTLS", start) };
      const secured = tls.connect({ socket: conn.socket, servername: config.host });
      await new Promise<void>((resolve, reject) => {
        secured.once("secureConnect", () => resolve());
        secured.once("error", reject);
      });
      conn = new Conn(secured);
      handle.conn = conn;
      ehlo = await conn.command(`EHLO ${ehloName}`);
      if (ehlo.code !== 250) return { result: failure("EHLO بعد التشفير", ehlo) };
    }
    if (config.user) {
      const methods = (/AUTH[ =](.*)/i.exec(ehlo.text)?.[1] ?? "PLAIN LOGIN").toUpperCase();
      let auth: { code: number; text: string };
      if (methods.includes("PLAIN")) {
        auth = await conn.command(`AUTH PLAIN ${b64(`\0${config.user}\0${config.pass}`)}`);
      } else {
        const start = await conn.command("AUTH LOGIN");
        const user = start.code === 334 ? await conn.command(b64(config.user)) : start;
        auth = user.code === 334 ? await conn.command(b64(config.pass)) : user;
      }
      if (auth.code !== 235) return { result: failure("تسجيل الدخول", auth, auth.code >= 500) };
    }
    return { conn };
  } catch (e) {
    conn.close();
    return { result: { ok: false, error: e instanceof Error ? e.message : "خطأ بخادم البريد", retry: true } };
  }
}

/** Logs in and quits: proves the settings work without sending anything. */
export async function smtpVerify(config: SmtpConfig, opts: { allowPrivate?: boolean } = {}): Promise<SmtpResult> {
  const opened = await open(config, "novasales.local", opts.allowPrivate === true);
  if ("result" in opened) return opened.result;
  await opened.conn.command("QUIT", 5000).catch(() => null);
  opened.conn.close();
  return { ok: true, response: "تم الاتصال وتسجيل الدخول" };
}

/* ------------------------------ the message ------------------------------ */

const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const encodeWord = (text: string) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`);
const fold = (base64: string) => base64.replace(/(.{76})/g, "$1\r\n");
const quoteName = (name: string) => (/^[\w .-]*$/.test(name) ? name : encodeWord(name));

export type MailInput = {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  headers?: Record<string, string>;
  replyTo?: string;
  date?: Date;
};

/** The full message with CRLF line ends: headers, then a text and an html alternative, both base64 UTF-8. */
export function buildMime(mail: MailInput, boundary = `nova_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`): string {
  const lines = [
    `From: ${clean(mail.from.name) ? `${quoteName(clean(mail.from.name))} ` : ""}<${clean(mail.from.email)}>`,
    `To: <${clean(mail.to)}>`,
    `Subject: ${encodeWord(clean(mail.subject))}`,
    `Date: ${(mail.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${clean(mail.messageId)}>`,
    ...(mail.replyTo ? [`Reply-To: <${clean(mail.replyTo)}>`] : []),
    ...Object.entries(mail.headers ?? {}).map(([k, v]) => `${clean(k)}: ${clean(v)}`),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    fold(b64(mail.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    fold(b64(mail.html)),
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

/** Sends one message. 4xx replies and network trouble may be retried later; 5xx replies are final. */
export async function smtpSend(config: SmtpConfig, mail: MailInput, opts: { allowPrivate?: boolean } = {}): Promise<SmtpResult> {
  const domain = clean(mail.from.email).split("@")[1] || "novasales.local";
  const opened = await open(config, domain, opts.allowPrivate === true);
  if ("result" in opened) return opened.result;
  const { conn } = opened;
  try {
    const from = await conn.command(`MAIL FROM:<${clean(mail.from.email)}>`);
    if (from.code !== 250) return failure("المرسِل", from);
    const rcpt = await conn.command(`RCPT TO:<${clean(mail.to)}>`);
    if (rcpt.code !== 250 && rcpt.code !== 251) return failure("المستلم", rcpt);
    const data = await conn.command("DATA");
    if (data.code !== 354) return failure("DATA", data);
    // A line that starts with a dot gets one more, so it is not read as the end of the message.
    const body = buildMime(mail).replace(/\r\n\./g, "\r\n..");
    conn.write(`${body.endsWith("\r\n") ? body : `${body}\r\n`}.\r\n`);
    const done = await conn.reply(60_000);
    if (done.code !== 250) return failure("إرسال الرسالة", done);
    await conn.command("QUIT", 5000).catch(() => null);
    return { ok: true, response: done.text.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "خطأ بخادم البريد", retry: true };
  } finally {
    conn.close();
  }
}
