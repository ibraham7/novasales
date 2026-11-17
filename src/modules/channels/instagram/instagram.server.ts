// The real services behind the Instagram channel: Meta's endpoints, token sealing, photo storage.
// Server only. Nothing here logs a token or an app secret.
import { sealSecret, openSecret } from "@/modules/integrations/secret-box.server";
import { graphVersion } from "./instagram-core";
import type { InstagramDeps } from "./instagram-store";

const TIMEOUT_MS = 12_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
// Photos in a notification live on Meta's own hosts; nothing else is fetched on the strength of a webhook.
const IMAGE_HOSTS = ["cdninstagram.com", "fbcdn.net", "fbsbx.com", "facebook.com", "instagram.com"];

async function call(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!response.ok) {
    const reason = body?.error?.message ?? body?.error_message ?? `HTTP ${response.status}`;
    throw new Error(`Instagram: ${String(reason).slice(0, 300)}`);
  }
  return body;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const base = () => `https://graph.instagram.com/${graphVersion()}`;

export function instagramDeps(): InstagramDeps {
  return {
    now: () => new Date(),
    seal: sealSecret,
    open: openSecret,

    exchangeCode: async (code, redirectUri) => {
      const body = await call("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.INSTAGRAM_APP_ID ?? "",
          client_secret: process.env.INSTAGRAM_APP_SECRET ?? "",
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code,
        }),
      });
      // Documented as {data:[{access_token,user_id,permissions}]}; older answers are flat.
      const item = Array.isArray(body?.data) ? body.data[0] : body;
      if (!item?.access_token) throw new Error("لم يرجع إنستغرام رمز الوصول");
      return { accessToken: String(item.access_token), userId: String(item.user_id ?? "") };
    },

    longLivedToken: async (shortToken) => {
      const url = new URL("https://graph.instagram.com/access_token");
      url.searchParams.set("grant_type", "ig_exchange_token");
      url.searchParams.set("client_secret", process.env.INSTAGRAM_APP_SECRET ?? "");
      url.searchParams.set("access_token", shortToken);
      const body = await call(url.toString());
      if (!body?.access_token) throw new Error("لم يرجع إنستغرام الرمز طويل الأمد");
      return { accessToken: String(body.access_token), expiresIn: Number(body.expires_in) || 5_184_000 };
    },

    refreshToken: async (token) => {
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", token);
      const body = await call(url.toString());
      if (!body?.access_token) throw new Error("لم يرجع إنستغرام الرمز المجدَّد");
      return { accessToken: String(body.access_token), expiresIn: Number(body.expires_in) || 5_184_000 };
    },

    fetchProfile: async (token) => {
      const body = await call(`${base()}/me?fields=user_id,username`, { headers: bearer(token) });
      return { userId: body?.user_id ? String(body.user_id) : body?.id ? String(body.id) : null, username: body?.username ? String(body.username) : null };
    },

    subscribe: async (igUserId, token) => {
      await call(`${base()}/${encodeURIComponent(igUserId)}/subscribed_apps`, {
        method: "POST",
        headers: { ...bearer(token), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ subscribed_fields: "messages,messaging_seen" }),
      });
    },

    sendMessage: async (igUserId, token, to, text) => {
      const body = await call(`${base()}/${encodeURIComponent(igUserId)}/messages`, {
        method: "POST",
        headers: { ...bearer(token), "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: to }, message: { text } }),
      });
      return { messageId: body?.message_id ? String(body.message_id) : null };
    },

    // Not confirmed in Meta's published pages: tried, and ignored if Instagram refuses.
    customerProfile: async (token, customerId) => {
      const body = await call(`${base()}/${encodeURIComponent(customerId)}?fields=name,username`, { headers: bearer(token) });
      return { name: body?.name ? String(body.name) : null, username: body?.username ? String(body.username) : null };
    },

    storeImage: async (organizationId, sessionId, url) => {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:" || !IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return null;
      const mime = response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      if (!mime.startsWith("image/")) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > IMAGE_MAX_BYTES) return null;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const path = `chat-media/${organizationId}/${sessionId}/${Date.now()}-instagram.${extension}`;
      const { error } = await (supabaseAdmin as any).storage.from("crm-files").upload(path, bytes, { contentType: mime, upsert: false });
      return error ? null : `crm-files/${path}`;
    },
  };
}
