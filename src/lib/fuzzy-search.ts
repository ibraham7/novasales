/**
 * Tolerant search helpers used across lists (pipeline, chats, leads, contacts).
 * - Arabic normalization (أإآ→ا, ى→ي, ة→ه, تشكيل/تطويل محذوف)
 * - Latin diacritics folding + lowercase
 * - Phone matching by digits only (يتجاهل +، مسافات، شرطات، وأصفار/رمز الدولة البادئ)
 * - Multi-token AND matching (كل كلمة يجب أن توجد في أي حقل)
 */

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640\u06D6-\u06ED]/g;
const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

function foldArabicDigits(value: string) {
  return value.replace(ARABIC_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  s = foldArabicDigits(s);
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(ARABIC_DIACRITICS, "");
  s = s
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ة]/g, "ه");
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function digitsOnly(value: unknown): string {
  return foldArabicDigits(String(value ?? "")).replace(/\D/g, "");
}

/** يحذف الأصفار البادئة حتى يطابق 05xx مع 9665xx */
function phoneVariants(digits: string): string[] {
  if (!digits) return [];
  const out = new Set<string>([digits]);
  out.add(digits.replace(/^0+/, ""));
  return [...out].filter(Boolean);
}

export type SearchFields = Array<unknown>;

/**
 * يطابق استعلام البحث مع مجموعة حقول.
 * كل كلمة في الاستعلام يجب أن تطابق نصياً (جزء من الاسم) أو رقمياً (جزء من الرقم).
 */
export function matchesSearch(query: string, fields: SearchFields): boolean {
  const q = normalizeText(query);
  if (!q) return true;

  const textHay = fields.map((f) => normalizeText(f)).filter(Boolean).join(" | ");
  const digitHays = fields
    .map((f) => digitsOnly(f))
    .filter((d) => d.length >= 4)
    .flatMap((d) => phoneVariants(d));

  const tokens = q.split(" ").filter(Boolean);
  return tokens.every((token) => {
    if (textHay.includes(token)) return true;
    const tokenDigits = digitsOnly(token);
    if (tokenDigits.length >= 2) {
      const variants = phoneVariants(tokenDigits);
      if (digitHays.some((hay) => variants.some((v) => hay.includes(v)))) return true;
    }
    return false;
  });
}
