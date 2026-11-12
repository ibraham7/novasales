/**
 * Reads the contact details a business publishes on its own website: emails, social pages and a
 * WhatsApp link. Pure text work over the page's HTML, so it is tested without a network.
 */
export type SiteContacts = {
  emails: string[];
  socials: Record<string, string>;
  whatsapp: string | null;
  contactLinks: string[];
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

export function extractEmails(html: string, siteHost = ""): string[] {
  const text = html.replace(/&#0*64;|&commat;|\[at\]|\(at\)/gi, "@").replace(/&amp;/g, "&");
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

export function extractWhatsapp(html: string): string | null {
  const patterns = [/wa\.me\/\+?(\d{7,15})/i, /api\.whatsapp\.com\/send\/?\?[^"'\s]*?phone=\+?(\d{7,15})/i, /whatsapp:\/\/send\?[^"'\s]*?phone=\+?(\d{7,15})/i, /web\.whatsapp\.com\/send\?[^"'\s]*?phone=\+?(\d{7,15})/i];
  for (const re of patterns) {
    const m = html.replace(/&amp;/g, "&").match(re);
    if (m) return `+${m[1]}`;
  }
  return null;
}

const CONTACT_HINT = /contact|about|iletisim|ileti%c5%9fim|iletişim|hakkimizda|hakk%c4%b1m|hakkımızda|اتصل|تواصل|من-نحن|من%20نحن/i;

export function extractContacts(html: string, baseUrl: string): SiteContacts {
  const base = hostOf(baseUrl);
  const socials: Record<string, string> = {};
  const contactLinks: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    let abs: string;
    try {
      abs = new URL(m[1].replace(/&amp;/g, "&"), baseUrl).toString();
    } catch {
      continue;
    }
    const social = socialOf(abs);
    if (social) {
      if (!socials[social[0]]) socials[social[0]] = social[1];
      continue;
    }
    if (hostOf(abs) === base && /^https?:/.test(abs) && CONTACT_HINT.test(new URL(abs).pathname) && abs !== baseUrl && !contactLinks.includes(abs)) contactLinks.push(abs);
  }
  return { emails: extractEmails(html, base), socials, whatsapp: extractWhatsapp(html), contactLinks: contactLinks.slice(0, 2) };
}

export function mergeContacts(parts: SiteContacts[], siteHost: string): SiteContacts {
  const socials: Record<string, string> = {};
  const emails = new Set<string>();
  let whatsapp: string | null = null;
  for (const p of parts) {
    for (const [k, v] of Object.entries(p.socials)) if (!socials[k]) socials[k] = v;
    for (const e of p.emails) emails.add(e);
    whatsapp = whatsapp ?? p.whatsapp;
  }
  const own = siteHost.replace(/^www\./, "");
  const sorted = [...emails].sort((a, b) => Number(b.endsWith(`@${own}`)) - Number(a.endsWith(`@${own}`))).slice(0, MAX_EMAILS);
  return { emails: sorted, socials, whatsapp, contactLinks: [] };
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
