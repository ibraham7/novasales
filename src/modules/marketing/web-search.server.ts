/**
 * The web search behind «اكتشاف الحسابات»: Serper (Google results through an official API). It is off until
 * SERPER_API_KEY is set on the server. Only a business's public name and city are sent. The key never
 * appears in an error message or a log.
 */
import type { SearchResult, WebSearchLike } from "./discover-core.ts";

const ENDPOINT = "https://google.serper.dev/search";
const TIMEOUT_MS = 10_000;

export const discoveryConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(env.SERPER_API_KEY?.trim());

export function createSerperSearch(apiKey: string, doFetch: typeof fetch = fetch): WebSearchLike {
  return async (query, options) => {
    let res: Response;
    try {
      res = await doFetch(ENDPOINT, {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, gl: options.country, hl: options.lang, num: 10 }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error("تعذّر الاتصال بخدمة البحث");
    }
    if (res.status === 401 || res.status === 403) throw new Error("مفتاح خدمة البحث غير صالح");
    if (res.status === 402 || res.status === 429) throw new Error("انتهى رصيد خدمة البحث أو تجاوزت حدّها؛ حاول لاحقاً");
    if (!res.ok) throw new Error(`خدمة البحث رفضت الطلب (${res.status})`);
    const body = (await res.json().catch(() => null)) as { organic?: { title?: unknown; link?: unknown; snippet?: unknown }[] } | null;
    const results: SearchResult[] = [];
    for (const item of body?.organic ?? []) {
      if (typeof item?.link !== "string") continue;
      results.push({ title: typeof item.title === "string" ? item.title : "", link: item.link, snippet: typeof item.snippet === "string" ? item.snippet : "" });
    }
    return results;
  };
}
