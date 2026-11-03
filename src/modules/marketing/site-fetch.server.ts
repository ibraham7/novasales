/**
 * Downloads one public web page for the enrichment step. The address is checked before the request and
 * again at every redirect (and its DNS answer must not be a private address), the page is capped in
 * size and time, and only HTML is read.
 */
import { lookup } from "node:dns/promises";
import { isPrivateIp, normalizeSiteUrl } from "./url-safety.ts";

export type FetchedPage = { finalUrl: string; html: string };
export type PageFetcher = (url: string) => Promise<FetchedPage>;

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

type Deps = {
  doFetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
};

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

export function createPageFetcher(deps: Deps = {}): PageFetcher {
  const doFetch = deps.doFetch ?? fetch;
  const resolve = deps.resolve ?? defaultResolve;
  return async (startUrl) => {
    let current = normalizeSiteUrl(startUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!current) throw new Error("عنوان الموقع غير صالح أو غير مسموح");
      let addresses: string[];
      try {
        addresses = await resolve(current.hostname);
      } catch {
        throw new Error("الموقع لا يعمل أو غير موجود");
      }
      if (!addresses.length || addresses.some(isPrivateIp)) throw new Error("عنوان الموقع غير مسموح");
      let res: Response;
      try {
        res = await doFetch(current.toString(), {
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "user-agent": "NovaSalesBot/1.0 (business contact lookup)", accept: "text/html,application/xhtml+xml", "accept-language": "ar,en;q=0.8,tr;q=0.6" },
        });
      } catch {
        throw new Error("الموقع لا يستجيب");
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error("الموقع يحوّل إلى عنوان غير معروف");
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          throw new Error("الموقع يحوّل إلى عنوان غير صالح");
        }
        current = normalizeSiteUrl(next);
        continue;
      }
      if (!res.ok) throw new Error(`الموقع رفض الطلب (${res.status})`);
      const type = res.headers.get("content-type") ?? "";
      if (type && !/html|xml/i.test(type)) throw new Error("العنوان ليس صفحة ويب");
      return { finalUrl: current.toString(), html: await readCapped(res) };
    }
    throw new Error("الموقع يحوّل كثيراً");
  };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(Math.min(size, MAX_BYTES));
  let offset = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, all.length - offset));
    all.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}
