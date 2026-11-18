/**
 * Reads the contact details a business publishes on its own website: emails, phone numbers, social
 * pages and a WhatsApp link. Pure text work over the page's HTML, so it is tested without a network.
 */
import { normalizeCampaignPhone } from "../campaigns/audience-file.ts";

export type SiteContacts = {
  emails: string[];
  /** Phone numbers the site shows, as digits with the country code (the same shape as a prospect's own number). */
  phones: string[];
  socials: Record<string, string>;
  /** A number («+905…») or, when the site only gives a chat link, that link. */
  whatsapp: string | null;
  contactLinks: string[];
  /** «Link in bio» pages (Linktree and the like) the business points to: they list its real contacts. */
  bioLinks: string[];
};

const MAX_EMAILS = 5;
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const FILE_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "css", "js", "mjs", "woff", "woff2", "ttf", "map", "pdf", "mp4"]);
const JUNK_DOMAINS = new Set(["example.com", "domain.com", "email.com", "yourdomain.com", "sentry.io", "wixpress.com", "sentry-next.wixpress.com", "godaddy.com"]);
const JUNK_LOCALS = new Set(["example", "name", "your", "yourname", "email", "user", "username", "test"]);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

function cleanEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase().replace(/[.,;:]+$/, "");
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  const tld = domain.split(".").pop() ?? "";
  if (FILE_TLDS.has(tld)) return null;
  if (JUNK_DOMAINS.has(domain) || JUNK_LOCALS.has(local)) return null;
  if (/^\d+x$/.test(local) || /@\d+x\./.test(email)) return null; // image names like logo@2x.png
  return email;
}

/** Cloudflare "email protection" hides an address as hex: the first byte is the XOR key. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out.includes("@") ? out : null;
}

/** Emails (and the sameAs social links) that schema.org JSON-LD blocks declare. */
function jsonLdValues(html: string): { emails: string[]; links: string[] } {
  const emails: string[] = [];
  const links: string[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "email" && typeof v === "string") emails.push(v.replace(/^mailto:/i, ""));
      else if (k === "sameAs") {
        for (const u of ([] as unknown[]).concat(v)) if (typeof u === "string") links.push(u);
      } else walk(v);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]));
    } catch {
      /* invalid JSON-LD is common; skip it */
    }
  }
  return { emails, links };
}

export function extractEmails(html: string, siteHost = ""): string[] {
  const decoded = [...html.matchAll(/data-cfemail\s*=\s*["']([0-9a-fA-F]+)["']/g), ...html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)/g)]
    .map((m) => decodeCfEmail(m[1]))
    .filter((v): v is string => !!v);
  const text = (html + " " + decoded.join(" ") + " " + jsonLdValues(html).emails.join(" "))
    .replace(/&#0*64;|&commat;|\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".")
    .replace(/&amp;/g, "&");
  const found = new Set<string>();
  for (const m of text.matchAll(/mailto:([^"'?<>\s]+)/gi)) {
    let value = m[1];
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep as is */
    }
    for (const part of value.split(",")) {
      const e = cleanEmail(part);
      if (e) found.add(e);
    }
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = cleanEmail(m[0]);
    if (e) found.add(e);
  }
  const own = siteHost.replace(/^www\./, "");
  return [...found].sort((a, b) => Number(b.endsWith(`@${own}`)) - Number(a.endsWith(`@${own}`))).slice(0, MAX_EMAILS);
}

const NOT_PROFILES: Record<string, Set<string>> = {
  instagram: new Set(["p", "reel", "reels", "explore", "accounts", "share", "stories", "tv", "direct", "about", "legal", "developer"]),
  facebook: new Set(["sharer", "sharer.php", "share", "share.php", "dialog", "plugins", "tr", "login", "login.php", "policies", "help", "legal", "privacy", "watch", "events", "hashtag", "groups"]),
  x: new Set(["intent", "share", "home", "i", "hashtag", "search", "login", "settings", "privacy", "tos"]),
};

function socialOf(rawUrl: string): [string, string] | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|web|mobile)\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const first = (parts[0] ?? "").toLowerCase();
  const clean = (path: string) => `https://${path}`;
  if (host === "instagram.com" && first && !NOT_PROFILES.instagram.has(first)) return ["instagram", clean(`www.instagram.com/${parts[0]}`)];
  if (host === "facebook.com" || host === "fb.com") {
    if (first === "profile.php" && u.searchParams.get("id")) return ["facebook", clean(`www.facebook.com/profile.php?id=${encodeURIComponent(u.searchParams.get("id")!)}`)];
    if (first === "pages" && parts[1]) return ["facebook", clean(`www.facebook.com/pages/${parts.slice(1, 3).join("/")}`)];
    if (first && !NOT_PROFILES.facebook.has(first)) return ["facebook", clean(`www.facebook.com/${parts[0]}`)];
  }
  if (host === "tiktok.com" && first.startsWith("@")) return ["tiktok", clean(`www.tiktok.com/${parts[0]}`)];
  if (host === "linkedin.com" && ["company", "in", "school"].includes(first) && parts[1]) return ["linkedin", clean(`www.linkedin.com/${first}/${parts[1]}`)];
  if ((host === "x.com" || host === "twitter.com") && first && !NOT_PROFILES.x.has(first)) return ["x", clean(`x.com/${parts[0]}`)];
  if (host === "youtube.com") {
    if (first.startsWith("@")) return ["youtube", clean(`www.youtube.com/${parts[0]}`)];
    if (["channel", "c", "user"].includes(first) && parts[1]) return ["youtube", clean(`www.youtube.com/${first}/${parts[1]}`)];
  }
  return null;
}

/** Page text with the escapes that hide a number inside a link turned back into characters. */
function unescapeLinks(html: string): string {
  return html
    .replace(/&amp;|&#0*38;/gi, "&")
    .replace(/&#0*43;|&plus;/gi, "+")
    .replace(/%2B/gi, "+")
    .replace(/%20|&nbsp;|&#160;/gi, " ")
    .replace(/\\u002[bB]/g, "+")
    .replace(/\\\//g, "/");
}

const plausibleDigits = (digits: string) => /^[1-9]\d{9,14}$/.test(digits) && !/^(\d)\1+$/.test(digits);

/**
 * The WhatsApp contact a page offers, as «+number», or the chat link when it carries no number
 * (wa.me/message/…, wa.link/…). Covers wa.me, api./web. whatsapp links, whatsapp://, the floating
 * «chat» buttons that keep their number in a data attribute or a script setting, and escaped forms.
 */
export function extractWhatsapp(html: string, dial = ""): string | null {
  const text = unescapeLinks(html);
  const numbered = [
    /wa\.me\/\+?\s?(\d[\d\s().-]{6,18}\d)/i,
    /api\.whatsapp\.com\/send\/?\?[^"'\s<>]*?phone=\+?\s?(\d[\d\s().-]{6,18}\d)/i,
    /whatsapp:\/\/send\?[^"'\s<>]*?phone=\+?\s?(\d[\d\s().-]{6,18}\d)/i,
    /web\.whatsapp\.com\/send\?[^"'\s<>]*?phone=\+?\s?(\d[\d\s().-]{6,18}\d)/i,
    // data-phone="…" / data-whatsapp="…" on a chat button or widget
    /data-(?:wa|whats?app|wapp)[\w-]*\s*=\s*["']\+?\s?(\d[\d\s().-]{6,18}\d)["']/i,
    // settings of chat plugins: whatsapp_number: "…", "whatsappNumber":"…", or a phone setting next to the word whatsapp
    /whats?app[\w-]{0,20}["']?\s*[:=]\s*["']\+?\s?(\d[\d\s().-]{8,18}\d)["']/i,
    /whats?app[^<>]{0,60}?(?:phone|number|tel|num)[\w-]{0,12}["']?\s*[:=]\s*["']\+?\s?(\d[\d\s().-]{8,18}\d)["']/i,
    /(?:phone|number|tel|num)[\w-]{0,12}["']?\s*[:=]\s*["']\+?\s?(\d[\d\s().-]{8,18}\d)["'][^<>]{0,60}?whats?app/i,
  ];
  for (const re of numbered) {
    const m = text.match(re);
    if (!m) continue;
    const digits = normalizeCampaignPhone(m[1], dial);
    if (digits && plausibleDigits(digits)) return `+${digits}`;
  }
  const chat = text.match(/https?:\/\/(?:wa\.me\/message\/[A-Za-z0-9]+|wa\.link\/[A-Za-z0-9]+|api\.whatsapp\.com\/message\/[A-Za-z0-9]+)/i);
  return chat ? chat[0] : null;
}

// Latin words must stand alone («ara» is not «para» or «sara»); Arabic words are matched as written.
const PHONE_LATIN = "tel|telefon|tlf|gsm|mobil|mobile|cep|phone|whatsapp|call|ara|randevu|rezervasyon";
const PHONE_ARABIC = "اتصل|اتصال|هاتف|جوال|موبايل|واتساب|للتواصل|للحجز|رقم";

function textOnly(html: string): string {
  return unescapeLinks(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ");
}

/**
 * Phone numbers a page shows: tel: links, schema.org «telephone», and numbers written right after
 * a word like «Tel», «Telefon», «GSM», «WhatsApp», «هاتف». A number floating in the text with no such
 * word is not taken (years, prices and ids look like numbers too).
 */
export function extractPhones(html: string, dial = ""): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    const digits = normalizeCampaignPhone(raw, dial);
    if (digits && plausibleDigits(digits) && !found.includes(digits)) found.push(digits);
  };
  for (const m of unescapeLinks(html).matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) add(m[1].split(/[;,?]/)[0]);
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node: any) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        for (const [k, v] of Object.entries(node)) {
          if (k === "telephone") {
            for (const t of ([] as unknown[]).concat(v)) if (typeof t === "string") add(t);
          } else walk(v);
        }
      };
      walk(JSON.parse(m[1]));
    } catch {
      /* invalid JSON-LD is common */
    }
  }
  const re = new RegExp("(?:\\b(?:" + PHONE_LATIN + ")\\b|" + PHONE_ARABIC + ")[^0-9+]{0,24}(\\+?\\d[\\d\\s().\\-/]{8,20}\\d)", "gi");
  for (const m of textOnly(html).matchAll(re)) add(m[1].replace(/\//g, " "));
  return found.slice(0, 5);
}

/** Pages that exist only to point to a business's real contacts. */
const BIO_HOSTS = new Set(["linktr.ee", "beacons.ai", "bio.link", "lnk.bio", "taplink.cc", "linkin.bio", "allmylinks.com", "campsite.bio", "carrd.co", "solo.to", "msha.ke"]);
const isBioHost = (host: string) => BIO_HOSTS.has(host) || [...BIO_HOSTS].some((h) => host.endsWith("." + h));

/**
 * Some businesses list a social page or a chat link as their «website». Those pages cannot be read
 * (they need a login), but the address itself is the contact: a social profile or a WhatsApp link.
 */
export function classifyWebsite(rawUrl: string, dial = ""): { kind: "social"; platform: string; url: string } | { kind: "whatsapp"; value: string } | null {
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : "https://" + rawUrl.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|web|mobile)\./, "").toLowerCase();
  if (host === "wa.me" || host === "wa.link" || host === "api.whatsapp.com") {
    const value = extractWhatsapp('href="' + u.toString() + '"', dial);
    return value ? { kind: "whatsapp", value } : null;
  }
  const social = socialOf(u.toString());
  return social ? { kind: "social", platform: social[0], url: social[1] } : null;
}

const CONTACT_HINT = /contact|about|kontakt|iletisim|ileti%c5%9fim|iletişim|bize-?ula[sş]|ula[sş][iı]m|hakkimizda|hakk%c4%b1m|hakkımızda|randevu|appointment|اتصل|تواصل|عنا|من-نحن|من%20نحن|حجز/i;

export function extractContacts(html: string, baseUrl: string, dial = ""): SiteContacts {
  const base = hostOf(baseUrl);
  const socials: Record<string, string> = {};
  const contactLinks: string[] = [];
  const bioLinks: string[] = [];
  const hrefs = [...[...html.matchAll(/href\s*=\s*["']([^"'#][^"']*)["']/gi)].map((m) => m[1]), ...jsonLdValues(html).links];
  for (const href of hrefs) {
    let abs: string;
    try {
      abs = new URL(href.replace(/&amp;/g, "&"), baseUrl).toString();
    } catch {
      continue;
    }
    const social = socialOf(abs);
    if (social) {
      if (!socials[social[0]]) socials[social[0]] = social[1];
      continue;
    }
    if (/^https?:/.test(abs) && isBioHost(hostOf(abs))) {
      if (!bioLinks.includes(abs)) bioLinks.push(abs);
      continue;
    }
    if (hostOf(abs) === base && /^https?:/.test(abs) && CONTACT_HINT.test(new URL(abs).pathname) && abs !== baseUrl && !contactLinks.includes(abs)) contactLinks.push(abs);
  }
  return { emails: extractEmails(html, base), phones: extractPhones(html, dial), socials, whatsapp: extractWhatsapp(html, dial), contactLinks: contactLinks.slice(0, 2), bioLinks: bioLinks.slice(0, 1) };
}

export function mergeContacts(parts: SiteContacts[], siteHost: string): SiteContacts {
  const socials: Record<string, string> = {};
  const emails = new Set<string>();
  const phones: string[] = [];
  let whatsapp: string | null = null;
  for (const p of parts) {
    for (const [k, v] of Object.entries(p.socials)) if (!socials[k]) socials[k] = v;
    for (const e of p.emails) emails.add(e);
    for (const t of p.phones) if (!phones.includes(t)) phones.push(t);
    // a real number beats a chat link that carries none
    if (!whatsapp || (!whatsapp.startsWith("+") && p.whatsapp?.startsWith("+"))) whatsapp = p.whatsapp ?? whatsapp;
  }
  const own = siteHost.replace(/^www\./, "");
  const sorted = [...emails].sort((a, b) => Number(b.endsWith(`@${own}`)) - Number(a.endsWith(`@${own}`))).slice(0, MAX_EMAILS);
  return { emails: sorted, phones: phones.slice(0, 5), socials, whatsapp, contactLinks: [], bioLinks: [] };
}

/* ---------------------- technologies and language of a site ---------------------- */

const TECH_SIGNS: [string, RegExp][] = [
  ["shopify", /cdn\.shopify\.com|myshopify\.com|Shopify\.theme/i],
  ["salla", /cdn\.salla\.network|salla\.sa\/|salla-theme|\bsalla\.(?:com|network)/i],
  ["zid", /cdn\.zid\.store|\bzid\.store|zid\.sa\//i],
  ["wordpress", /\/wp-content\/|\/wp-includes\/|name=["']generator["'][^>]*WordPress/i],
  ["woocommerce", /woocommerce|wc-ajax|\/wp-content\/plugins\/woocommerce/i],
  ["wix", /static\.wixstatic\.com|wix\.com\/|X-Wix-/i],
  ["squarespace", /static1\.squarespace\.com|squarespace\.com\/|Squarespace/],
  ["magento", /Magento|\/static\/version\d+\/frontend\/|mage\/cookies/],
  ["google_analytics", /google-analytics\.com\/(?:analytics|ga)\.js|gtag\/js\?id=(?:G|UA)-|\bUA-\d{4,}-\d+|['"]G-[A-Z0-9]{6,}['"]/],
  ["google_tag_manager", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/],
  ["google_ads", /googleadservices\.com|gtag\/js\?id=AW-|['"]AW-\d{6,}/],
  ["meta_pixel", /connect\.facebook\.net\/[^"']*\/fbevents\.js|fbq\(\s*['"]init['"]/],
  ["tiktok_pixel", /analytics\.tiktok\.com|ttq\.load/],
  ["hubspot", /js\.hs-scripts\.com|js\.hs-analytics\.net|hbspt\.forms/],
  ["salesforce", /salesforce\.com|force\.com|pardot\.com|pi\.pardot/i],
  ["intercom", /widget\.intercom\.io|intercomSettings/],
];

/** The technologies a page's source gives away (keys of TECHNOLOGIES). */
export function detectTech(html: string): string[] {
  const found = TECH_SIGNS.filter(([, re]) => re.test(html)).map(([key]) => key);
  // WooCommerce always runs on WordPress.
  if (found.includes("woocommerce") && !found.includes("wordpress")) found.unshift("wordpress");
  return found;
}

/** The page language from <html lang="…">, as a two-letter code, or null. */
export function detectLang(html: string): string | null {
  const m = /<html[^>]*\slang\s*=\s*["']?([A-Za-z]{2})/i.exec(html.slice(0, 4000));
  return m ? m[1].toLowerCase() : null;
}
