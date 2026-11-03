/**
 * Which addresses the server may fetch when it reads a business's website. Pure checks, tested
 * without a network: only http(s) on the default ports, never an internal host or private IP.
 */
import { isIP } from "node:net";

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (isIP(v) === 6) {
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return true; // not an IP at all: treat as unsafe
}

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (isIP(h.replace(/^\[|\]$/g, ""))) return isPrivateIp(h.replace(/^\[|\]$/g, ""));
  if (!h.includes(".")) return true;
  return h === "localhost" || /\.(local|localhost|internal|lan|home|corp|localdomain)$/.test(h);
}

/** A website address typed by Google/users, made into a URL we are willing to fetch (or null). */
export function normalizeSiteUrl(raw: string | null | undefined): URL | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > 500) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  if (isBlockedHostname(url.hostname)) return null;
  url.hash = "";
  return url;
}
