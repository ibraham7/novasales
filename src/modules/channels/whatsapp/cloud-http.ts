/**
 * Meta WhatsApp Cloud API / Coexistence — HTTP layer (server-only).
 * تفصيل داخلي للمزوّد الرسمي؛ لا يُستورد من خارج مجلد المزوّد.
 *
 * كل الأسرار تُقرأ داخل الدوال (لا على مستوى الموديول) لأن حقن البيئة يحدث
 * وقت الاستدعاء في بيئة الـWorker.
 */

const DEFAULT_TIMEOUT_MS = 12000;

export function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || "v23.0";
}

export function graphBase() {
  return `https://graph.facebook.com/${graphVersion()}`;
}

export function isCoexistenceConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_CONFIG_ID);
}

export function metaPublicConfig() {
  return {
    appId: process.env.META_APP_ID ?? null,
    configId: process.env.META_CONFIG_ID ?? null,
    graphVersion: graphVersion(),
  };
}

type FetchOpts = {
  method?: string;
  token?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** أسماء معاملات يجب إرسالها حتى لو كانت قيمتها سلسلة فارغة (مثل redirect_uri). */
  allowEmpty?: string[];
  /** إرجاع نص خطأ Meta الحرفي بدل الرسالة المترجمة (للتشخيص وعرضه للمستخدم). */
  rawError?: boolean;
};

export async function graphFetch<T = any>(path: string, opts: FetchOpts = {}): Promise<T> {
  const url = new URL(`${graphBase()}${path.startsWith("/") ? path : `/${path}`}`);
  const allowEmpty = new Set(opts.allowEmpty ?? []);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v == null) continue;
    if (v === "" && !allowEmpty.has(k)) continue;
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      signal: controller.signal,
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(
      (e as Error)?.name === "AbortError"
        ? "خدمة واتساب الرسمية لم تستجب في الوقت المحدد"
        : ((e as Error)?.message ?? "خدمة واتساب الرسمية غير متاحة"),
    );
  }
  clearTimeout(timer);
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(opts.rawError ? rawGraphError(body, res.status) : describeGraphError(body, res.status));
  return body as T;
}

/** نص خطأ Meta كما ورد حرفياً (بلا أسرار) — للعرض للمستخدم وللسجلات. */
export function rawGraphError(body: any, status?: number): string {
  // جسم استجابة الخطأ كما أرسلته Meta حرفياً؛ لا نعيد تفسير 36008 حتى لا
  // نخلط بين redirect_uri ورمز منتهي/مستهلك. الاستجابة لا تحتوي أسرار الطلب.
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return `Meta raw error (http_status=${status ?? "unknown"}): ${raw || "<empty body>"}`;
}

/**
 * حالة تطبيق Meta كما تسمح Graph API بقراءتها بتوكن التطبيق (best-effort).
 * تُستخدم للتشخيص فقط عند فشل التبادل — لا تُرجع أي سر.
 */
export async function metaAppStatus(): Promise<Record<string, unknown> | null> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return null;
  return graphFetch<Record<string, unknown>>(`/${appId}`, {
    query: {
      fields: "id,name,link,app_type,restrictions,privacy_policy_url",
      access_token: `${appId}|${appSecret}`,
    },
  }).catch(() => null);
}

/** رسائل خطأ Meta الشائعة بصيغة مفهومة للمستخدم. */
export function describeGraphError(body: any, status?: number): string {
  const err = body?.error ?? {};
  const code = Number(err.code ?? 0);
  const sub = Number(err.error_subcode ?? 0);
  const detail: string = err.error_user_msg || err.message || `خطأ ${status ?? ""}`.trim();

  if (code === 131047) {
    return "لا يمكن إرسال رسالة نصية حرة الآن: مرّ أكثر من 24 ساعة على آخر رسالة من العميل. ابدأ بقالب معتمد من واتساب.";
  }
  if (code === 131026) return "لا يمكن تسليم الرسالة: الرقم المستلم غير مسجّل على واتساب أو لا يقبل الرسائل.";
  if (code === 131031 || sub === 2494055) return "حساب واتساب للأعمال مقيَّد حالياً من Meta — راجع حالة الحساب في Business Manager.";
  if (code === 190) return "انتهت صلاحية تفويض واتساب الرسمي — أعد ربط الرقم من صفحة جلسات واتساب.";
  if (code === 133010) return "الرقم غير مُسجّل على واتساب الرسمي بعد.";
  if (code === 132000 || code === 132001) return "القالب المستخدم غير معتمد أو غير موجود في حساب واتساب للأعمال.";
  if (code === 4 || code === 80007) return "تم تجاوز حد الاستخدام المسموح من Meta مؤقتاً — حاول بعد قليل.";
  return `واتساب الرسمي: ${detail}`;
}

/* ------------------------------------------------------------------ *
 * تشفير توكن الوصول (AES-GCM) — المفتاح مُشتق من META_APP_SECRET
 * ------------------------------------------------------------------ */

async function cryptoKey(): Promise<CryptoKey> {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET غير مضبوط.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string): Promise<string> {
  const key = await cryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return Buffer.from(packed).toString("base64");
}

export async function decryptToken(packedB64: string): Promise<string> {
  const key = await cryptoKey();
  const packed = new Uint8Array(Buffer.from(packedB64, "base64"));
  const iv = packed.slice(0, 12);
  const cipher = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

/** تحقق توقيع ويبهوك Meta (X-Hub-Signature-256) على الجسم الخام. */
export async function verifyMetaSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header) return false;
  const expectedHex = header.startsWith("sha256=") ? header.slice(7) : header;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const computedHex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Embedded Signup
 * ------------------------------------------------------------------ */

/**
 * بصمة قصيرة لرمز التفويض (للسجلات وحماية الاستخدام المزدوج) — لا تكشف الرمز.
 */

export async function codeFingerprint(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
  return [...digest.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * يرسل كل authorization code إلى Meta مرة واحدة فقط، وبدون معامل redirect_uri
 * إطلاقاً — مطابقةً لتوثيق Meta الرسمي في نمط Embedded Signup عبر JS SDK.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  diagnostics?: { codeReceivedAt?: number; browserAppId?: string },
): Promise<{ token: string; expiresIn: number | null }> {
  const codeHash = await codeFingerprint(code);
  const serverAppId = process.env.META_APP_ID ?? "";
  const codeAgeMs = diagnostics?.codeReceivedAt == null
    ? "unknown"
    : Math.max(0, Date.now() - diagnostics.codeReceivedAt);
  const clientIdPrefix = serverAppId.slice(0, 6) || "missing";
  const browserAppIdPrefix = diagnostics?.browserAppId?.slice(0, 6) || "missing";
  console.log(
    `[META_OAUTH] attempt=1 redirect_uri=${redirectUri} codeAgeMs=${codeAgeMs} clientIdPrefix=${clientIdPrefix} browserAppIdPrefix=${browserAppIdPrefix} codeHash=${codeHash} codeLength=${code.length} graph=${graphVersion()}`,
  );
  try {
    const res = await graphFetch<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
      query: {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      },
      allowEmpty: ["redirect_uri"],
      rawError: true,
    });
    if (!res?.access_token) throw new Error("لم يصل توكن الوصول من Meta.");
    console.log(`[META_OAUTH] attempt=1 result=ok codeHash=${codeHash}`);
    return { token: res.access_token, expiresIn: res.expires_in ?? null };
  } catch (e) {
    const reason = (e as Error)?.message ?? "unknown";
    console.error(`[META_OAUTH] attempt=1 result=failed codeHash=${codeHash} metaError=${reason}`);
    throw e;
  }
}




/** حسابات واتساب للأعمال التي يملكها هذا التوكن (عند غياب waba_id من الواجهة). */
export async function listSharedWabas(token: string): Promise<string[]> {
  const res = await graphFetch<{ data?: Array<{ id: string }> }>("/debug_token", {
    token,
    query: { input_token: token },
  }).catch(() => null as any);
  const scopes: any[] = res?.data?.[0]?.granular_scopes ?? (res as any)?.data?.granular_scopes ?? [];
  const ids = new Set<string>();
  for (const s of scopes) {
    if (s?.scope === "whatsapp_business_messaging" || s?.scope === "whatsapp_business_management") {
      for (const id of s.target_ids ?? []) ids.add(String(id));
    }
  }
  return [...ids];
}

export type CloudPhoneInfo = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  platform_type?: string;
  code_verification_status?: string;
};

export async function listWabaPhoneNumbers(wabaId: string, token: string): Promise<CloudPhoneInfo[]> {
  const res = await graphFetch<{ data?: CloudPhoneInfo[] }>(`/${wabaId}/phone_numbers`, {
    token,
    query: { fields: "id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status" },
  });
  return res?.data ?? [];
}

export async function getPhoneInfo(phoneNumberId: string, token: string): Promise<CloudPhoneInfo | null> {
  return graphFetch<CloudPhoneInfo>(`/${phoneNumberId}`, {
    token,
    query: { fields: "id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status" },
  }).catch(() => null);
}

/** الحقول اللازمة لتجربة Coexistence كاملة (صدى رسائل الجوال + السجل). */
export const COEXISTENCE_WEBHOOK_FIELDS = [
  "messages",
  "message_template_status_update",
  "smb_message_echoes",
  "smb_app_state_sync",
  "history",
  "account_update",
  "phone_number_quality_update",
] as const;

/**
 * ربط تطبيقنا بحساب واتساب للأعمال حتى تصل أحداث الويبهوك.
 * سقوط متدرّج: أي حقل ترفضه Meta يُسقط ويُعاد المحاولة بالباقي، وأخيراً الاشتراك الافتراضي.
 * لا يفشل الربط بسبب الاشتراك — نُرجع الحقول التي نجحت فعلياً فقط.
 */
export async function subscribeApp(wabaId: string, token: string): Promise<string[]> {
  let fields = [...COEXISTENCE_WEBHOOK_FIELDS] as string[];

  while (fields.length) {
    try {
      await graphFetch(`/${wabaId}/subscribed_apps`, {
        method: "POST",
        token,
        query: { subscribed_fields: fields.join(",") },
      });
      console.log(`[META_WEBHOOK] subscribed waba=${wabaId} fields=${fields.join(",")}`);
      return fields;
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      // نحدد الحقل المرفوض من نص الخطأ إن أمكن، وإلا نُسقط آخر حقل تجريبياً.
      const rejected = fields.find((f) => msg.includes(f));
      const dropped = rejected ?? fields[fields.length - 1]!;
      console.warn(`[META_WEBHOOK] field rejected waba=${wabaId} field=${dropped} — retrying without it`);
      fields = fields.filter((f) => f !== dropped);
    }
  }

  try {
    await graphFetch(`/${wabaId}/subscribed_apps`, { method: "POST", token });
    console.log(`[META_WEBHOOK] subscribed waba=${wabaId} fields=default`);
    return ["default"];
  } catch (e) {
    console.error(`[META_WEBHOOK] subscribe failed waba=${wabaId}: ${(e as Error)?.message}`);
    return [];
  }
}


export async function unsubscribeApp(wabaId: string, token: string): Promise<void> {
  await graphFetch(`/${wabaId}/subscribed_apps`, { method: "DELETE", token }).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * الرسائل
 * ------------------------------------------------------------------ */

function toWaNumber(identifier: string) {
  return String(identifier).split("@")[0]!.replace(/\D/g, "");
}

type SendResult = { messages?: Array<{ id?: string }> };

async function sendMessage(phoneNumberId: string, token: string, payload: Record<string, unknown>) {
  const res = await graphFetch<SendResult>(`/${phoneNumberId}/messages`, {
    method: "POST",
    token,
    body: { messaging_product: "whatsapp", ...payload },
  });
  return { externalId: res?.messages?.[0]?.id };
}

export async function sendText(
  phoneNumberId: string,
  token: string,
  to: string,
  text: string,
  replyToId?: string,
) {
  return sendMessage(phoneNumberId, token, {
    recipient_type: "individual",
    to: toWaNumber(to),
    type: "text",
    text: { body: text, preview_url: true },
    ...(replyToId ? { context: { message_id: replyToId } } : {}),
  });
}

export async function sendTemplate(
  phoneNumberId: string,
  token: string,
  to: string,
  template: { name: string; language: string; components?: unknown[] },
) {
  return sendMessage(phoneNumberId, token, {
    to: toWaNumber(to),
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(template.components ? { components: template.components } : {}),
    },
  });
}

/** الوسائط: نقبل رابطاً عاماً أو base64 (يُرفع أولاً إلى Meta). */
export async function sendMedia(
  phoneNumberId: string,
  token: string,
  to: string,
  params: {
    mediatype: "image" | "video" | "document" | "audio";
    media: string;
    mimetype?: string;
    fileName?: string;
    caption?: string;
    replyToId?: string;
  },
) {
  const isUrl = /^https?:\/\//i.test(params.media);
  const mediaRef = isUrl
    ? { link: params.media }
    : { id: await uploadMedia(phoneNumberId, token, params.media, params.mimetype ?? "application/octet-stream", params.fileName) };

  const payload: Record<string, unknown> = {
    to: toWaNumber(to),
    type: params.mediatype,
    [params.mediatype]: {
      ...mediaRef,
      ...(params.caption && params.mediatype !== "audio" ? { caption: params.caption } : {}),
      ...(params.fileName && params.mediatype === "document" ? { filename: params.fileName } : {}),
    },
    ...(params.replyToId ? { context: { message_id: params.replyToId } } : {}),
  };
  return sendMessage(phoneNumberId, token, payload);
}

export async function uploadMedia(
  phoneNumberId: string,
  token: string,
  base64: string,
  mimetype: string,
  fileName?: string,
): Promise<string> {
  const clean = base64.includes(",") ? base64.split(",").pop()! : base64;
  const bytes = new Uint8Array(Buffer.from(clean, "base64"));
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimetype);
  form.append("file", new Blob([bytes], { type: mimetype }), fileName || "upload");

  const res = await fetch(`${graphBase()}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) throw new Error(describeGraphError(body, res.status));
  return String(body.id);
}

export async function markRead(phoneNumberId: string, token: string, messageId: string) {
  await sendMessage(phoneNumberId, token, { status: "read", message_id: messageId });
}

export async function sendReaction(phoneNumberId: string, token: string, to: string, messageId: string, emoji: string) {
  return sendMessage(phoneNumberId, token, {
    to: toWaNumber(to),
    type: "reaction",
    reaction: { message_id: messageId, emoji },
  });
}

/** تنزيل وسائط واردة: media_id → رابط مؤقت → بايتات. */
export async function downloadMedia(
  mediaId: string,
  token: string,
): Promise<{ base64: string; mimetype?: string; fileName?: string } | null> {
  const meta = await graphFetch<{ url?: string; mime_type?: string; file_name?: string }>(`/${mediaId}`, {
    token,
  }).catch(() => null);
  if (!meta?.url) return null;
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    base64: Buffer.from(buf).toString("base64"),
    ...(meta.mime_type ? { mimetype: meta.mime_type } : {}),
    ...(meta.file_name ? { fileName: meta.file_name } : {}),
  };
}
