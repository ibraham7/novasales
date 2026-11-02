/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291), written
 * on WebCrypto only: no Node-specific modules, so it runs on the VPS (Node) and on a Worker alike.
 */
export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushResult = { ok: boolean; status: number; gone: boolean; error?: string };

const encoder = new TextEncoder();

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, length * 8),
  );
}

/**
 * RFC 8291 encryption of one record. The sender key pair and the salt are random unless given
 * (they are only given by the tests, with the RFC's own example values).
 */
export async function encryptPayload(
  payload: Uint8Array,
  subscription: { p256dh: string; auth: string },
  fixed?: { senderPrivateKey: CryptoKey; senderPublicKey: Uint8Array; salt: Uint8Array },
): Promise<Uint8Array> {
  const uaPublic = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("مفتاح الاشتراك غير صالح");
  if (authSecret.length !== 16) throw new Error("سر الاشتراك غير صالح");

  let senderPrivate = fixed?.senderPrivateKey;
  let senderPublic = fixed?.senderPublicKey;
  if (!senderPrivate || !senderPublic) {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, senderPrivate, 256));

  const ikm = await hkdf(authSecret, shared, concat(encoder.encode("WebPush: info\0"), uaPublic, senderPublic), 32);
  const contentKey = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  // A single record: the data followed by the 0x02 delimiter (last record), no extra padding.
  const plain = concat(payload, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", contentKey as BufferSource, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aes, plain as BufferSource));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, cipher);
}

/** The VAPID `Authorization` value for a push service origin (RFC 8292, ES256 JWT). */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(
    encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: vapid.subject })),
  );
  const publicBytes = base64UrlToBytes(vapid.publicKey);
  if (publicBytes.length !== 65) throw new Error("مفتاح VAPID العام غير صالح");
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64Url(publicBytes.slice(1, 33)),
      y: bytesToBase64Url(publicBytes.slice(33, 65)),
      d: vapid.privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${bytesToBase64Url(signature)}, k=${vapid.publicKey}`;
}

/** Sends one notification. `gone` means the subscription no longer exists and must be removed. */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  options: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string; timeoutMs?: number } = {},
): Promise<PushResult> {
  try {
    const body = await encryptPayload(encoder.encode(JSON.stringify(payload)), subscription);
    const headers: Record<string, string> = {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(options.ttlSeconds ?? 24 * 60 * 60),
      Urgency: options.urgency ?? "normal",
    };
    // The topic replaces a pending message with the same topic instead of stacking them.
    if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers,
      body: body as BodyInit,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    const status = response.status;
    if (status >= 200 && status < 300) return { ok: true, status, gone: false };
    const text = (await response.text().catch(() => "")).slice(0, 200);
    return { ok: false, status, gone: status === 404 || status === 410, error: `HTTP ${status}${text ? `: ${text}` : ""}` };
  } catch (error) {
    return { ok: false, status: 0, gone: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The hosts of the push services browsers use. Anything else is refused, so the server cannot be pointed at an internal address. */
const PUSH_HOST_SUFFIXES = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    return PUSH_HOST_SUFFIXES.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}
