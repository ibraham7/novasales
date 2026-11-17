// Pure rules of the Instagram channel (no database, no network), so they can be tested alone.
// Endpoints and fields below were checked against Meta's «Instagram API with Instagram Login» docs.

export const INSTAGRAM_PROVIDER_ID = "instagram_login";
export const INSTAGRAM_CHANNEL_TYPE = "instagram";
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"] as const;

/** Meta lets an app message a person only within 24 hours of the person's last message. */
export const MESSAGING_WINDOW_MS = 24 * 3_600_000;
/** A long-lived token lasts 60 days; renew it once less than this is left. */
export const TOKEN_REFRESH_BEFORE_MS = 7 * 24 * 3_600_000;
/** Meta refuses to refresh a token younger than 24 hours. */
export const TOKEN_MIN_AGE_MS = 24 * 3_600_000;
export const LINK_STATE_TTL_MS = 10 * 60_000;

export function graphVersion(env: Record<string, string | undefined> = process.env) {
  return env.INSTAGRAM_GRAPH_VERSION?.trim() || "v27.0";
}

export function isInstagramConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET && env.PUBLIC_APP_URL);
}

/** Where Instagram sends the person back after the login page: the channels page of this app. */
export function linkRedirectUri(env: Record<string, string | undefined> = process.env) {
  const base = env.PUBLIC_APP_URL?.replace(/\/$/, "");
  return base ? `${base}/channels` : null;
}

export function buildAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }) {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", input.state);
  // The person signs in on Instagram's own page; this app never sees the password.
  url.searchParams.set("force_reauth", "true");
  url.searchParams.set("enable_fb_login", "false");
  return url.toString();
}

/** The code comes back with a trailing «#_» that must be removed before it is used. */
export function cleanAuthCode(code: string) {
  return String(code ?? "").replace(/#_$/, "").trim();
}

export function newLinkState(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)) {
  return [...random(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type MessagingWindow = { open: boolean; expiresAt: Date | null };

export function messagingWindow(lastInboundAt: string | Date | null | undefined, now: Date = new Date()): MessagingWindow {
  if (!lastInboundAt) return { open: false, expiresAt: null };
  const expiresAt = new Date(new Date(lastInboundAt).getTime() + MESSAGING_WINDOW_MS);
  return { open: expiresAt.getTime() > now.getTime(), expiresAt };
}

export const WINDOW_CLOSED_MESSAGE =
  "انتهت مدة الرد على هذا العميل (24 ساعة من آخر رسالة منه). تسمح إنستغرام بالرد فقط بعد أن يراسلك.";

export type TokenState = "ok" | "refresh_due" | "expired";

export function tokenState(expiresAt: string | Date | null | undefined, now: Date = new Date()): TokenState {
  if (!expiresAt) return "expired";
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left <= 0) return "expired";
  return left <= TOKEN_REFRESH_BEFORE_MS ? "refresh_due" : "ok";
}

/** Whether Meta will accept a refresh now (token at least a day old and not expired). */
export function canRefreshToken(refreshedAt: string | Date | null | undefined, expiresAt: string | Date | null | undefined, now: Date = new Date()) {
  if (tokenState(expiresAt, now) === "expired") return false;
  if (!refreshedAt) return true;
  return now.getTime() - new Date(refreshedAt).getTime() >= TOKEN_MIN_AGE_MS;
}

export type InstagramAttachment = { type: string; url: string | null };

export type InstagramInboundEvent = {
  /** The professional account the notification is for (entry.id). */
  igUserId: string;
  /** The other person: their Instagram-scoped id (an echo has them as recipient). */
  customerId: string;
  mid: string;
  text: string;
  attachments: InstagramAttachment[];
  isEcho: boolean;
  at: string;
};

/** Reads a webhook notification into the events this app stores. Anything else is ignored. */
export function parseInstagramWebhook(payload: unknown): InstagramInboundEvent[] {
  const body = payload as { object?: string; entry?: any[] } | null;
  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) return [];
  const events: InstagramInboundEvent[] = [];
  for (const entry of body.entry) {
    const igUserId = String(entry?.id ?? "");
    if (!igUserId || !Array.isArray(entry.messaging)) continue;
    for (const item of entry.messaging) {
      const message = item?.message;
      const mid = message?.mid ? String(message.mid) : "";
      if (!mid) continue;
      const isEcho = message.is_echo === true;
      const customerId = String(isEcho ? item?.recipient?.id ?? "" : item?.sender?.id ?? "");
      if (!customerId || customerId === igUserId) continue;
      const attachments: InstagramAttachment[] = (Array.isArray(message.attachments) ? message.attachments : []).map((a: any) => ({
        type: String(a?.type ?? "file"),
        url: typeof a?.payload?.url === "string" ? a.payload.url : null,
      }));
      const timestamp = Number(item?.timestamp);
      events.push({
        igUserId,
        customerId,
        mid,
        text: typeof message.text === "string" ? message.text : "",
        attachments,
        isEcho,
        at: new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()).toISOString(),
      });
    }
  }
  return events;
}

/** Short line shown in the chat list for a message with no text. */
export function previewFor(event: Pick<InstagramInboundEvent, "text" | "attachments">) {
  if (event.text.trim()) return event.text.trim().slice(0, 500);
  const type = event.attachments[0]?.type;
  if (type === "image") return "📷 صورة";
  if (type === "video" || type === "ig_reel") return "🎬 فيديو";
  if (type === "audio") return "🎙️ رسالة صوتية";
  if (type === "share" || type === "story_mention") return "↪️ منشور أو ستوري";
  return event.attachments.length ? "📎 مرفق" : "";
}

/** X-Hub-Signature-256 check over the raw body with the app secret (constant-time compare). */
export async function verifyHubSignature(rawBody: string, header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  const expected = header.startsWith("sha256=") ? header.slice(7) : header;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const computed = [...signature].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Instagram accepts at most 1000 bytes of UTF-8 per message (about 500 Arabic letters). */
export const MESSAGE_MAX_BYTES = 1000;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** Splits a long reply into parts that each fit, preferring line breaks, then spaces. */
export function splitForInstagram(text: string, maxBytes: number = MESSAGE_MAX_BYTES): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest) {
    if (byteLength(rest) <= maxBytes) {
      parts.push(rest);
      break;
    }
    // the longest prefix that fits, counted in whole characters
    let end = 0;
    let bytes = 0;
    for (const char of rest) {
      const size = byteLength(char);
      if (bytes + size > maxBytes) break;
      bytes += size;
      end += char.length;
    }
    let cut = end;
    const head = rest.slice(0, end);
    const breakAt = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
    if (breakAt > end / 2) cut = breakAt;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return parts.filter(Boolean);
}
