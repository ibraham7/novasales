/**
 * Downloads one public web page for the enrichment step. The address is checked before the request and
 * again at every redirect (and its DNS answer must not be a private address), the page is capped in
 * size and time, and only HTML is read.
 *
 * Small sites often fail a first plain request, so a failed fetch is tried again where it can help:
 * a site that refuses an unknown robot (403/406/429/503) is asked once more the way a browser asks, and
 * one that does not answer is tried with and without «www.». Every retry goes through the same address
 * checks. Pages in the old Turkish and Arabic encodings are decoded correctly.
 */
import { lookup } from "node:dns/promises";
import { isPrivateIp, normalizeSiteUrl } from "./url-safety.ts";

export type FetchedPage = { finalUrl: string; html: string };
export type PageFetcher = (url: string) => Promise<FetchedPage>;

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const BOT_AGENT = "NovaSalesBot/1.0 (business contact lookup)";
const BROWSER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/** Answers that mean «not you», where asking the way a browser asks can change the outcome. */
const REFUSED = new Set([403, 406, 429, 503]);

type Deps = {
  doFetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
};

class FetchProblem extends Error {
  readonly kind: "refused" | "unreachable" | "other";
  // Written out (not a parameter property) so the node test runner's type stripping can load this file.
  constructor(message: string, kind: "refused" | "unreachable" | "other") {
    super(message);
    this.kind = kind;
  }
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

export function createPageFetcher(deps: Deps = {}): PageFetcher {
  const doFetch = deps.doFetch ?? fetch;
  const resolve = deps.resolve ?? defaultResolve;

  const attempt = async (startUrl: string, agent: string): Promise<FetchedPage> => {
    let current = normalizeSiteUrl(startUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!current) throw new FetchProblem("عنوان الموقع غير صالح أو غير مسموح", "other");
      let addresses: string[];
      try {
        addresses = await resolve(current.hostname);
      } catch {
        throw new FetchProblem("الموقع لا يعمل أو غير موجود", "unreachable");
      }
      if (!addresses.length || addresses.some(isPrivateIp)) throw new FetchProblem("عنوان الموقع غير مسموح", "other");
      let res: Response;
      try {
        res = await doFetch(current.toString(), {
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "user-agent": agent, accept: "text/html,application/xhtml+xml", "accept-language": "ar,en;q=0.8,tr;q=0.6" },
        });
      } catch {
        throw new FetchProblem("الموقع لا يستجيب", "unreachable");
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new FetchProblem("الموقع يحوّل إلى عنوان غير معروف", "other");
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          throw new FetchProblem("الموقع يحوّل إلى عنوان غير صالح", "other");
        }
        current = normalizeSiteUrl(next);
        continue;
      }
      if (!res.ok) throw new FetchProblem(`الموقع رفض الطلب (${res.status})`, REFUSED.has(res.status) ? "refused" : "other");
      const type = res.headers.get("content-type") ?? "";
      if (type && !/html|xml/i.test(type)) throw new FetchProblem("العنوان ليس صفحة ويب", "other");
      return { finalUrl: current.toString(), html: decodeBody(await readCapped(res), type) };
    }
    throw new FetchProblem("الموقع يحوّل كثيراً", "other");
  };

  return async (startUrl) => {
    try {
      return await attempt(startUrl, BOT_AGENT);
    } catch (first) {
      if (!(first instanceof FetchProblem)) throw first;
      if (first.kind === "refused") return attempt(startUrl, BROWSER_AGENT);
      if (first.kind === "unreachable") {
        const alternate = withOrWithoutWww(startUrl);
        if (alternate) {
          try {
            return await attempt(alternate, BOT_AGENT);
          } catch {
            /* report the first problem: it is the one the person typed */
          }
        }
      }
      throw first;
    }
  };
}

/** The same address with «www.» added or removed, or null when it cannot be told. */
function withOrWithoutWww(raw: string): string | null {
  const url = normalizeSiteUrl(raw);
  if (!url) return null;
  url.hostname = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
  return normalizeSiteUrl(url.toString())?.toString() ?? null;
}

async function readCapped(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).subarray(0, MAX_BYTES);
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
  return all;
}

/** Decodes the page in the encoding it declares (header or <meta>), UTF-8 when none or unknown. */
export function decodeBody(bytes: Uint8Array, contentType = ""): string {
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 2048)))?.[1];
  const label = declared?.toLowerCase();
  if (label && label !== "utf-8" && label !== "utf8") {
    try {
      return new TextDecoder(label, { fatal: false }).decode(bytes);
    } catch {
      /* an encoding this runtime does not know: fall back */
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
