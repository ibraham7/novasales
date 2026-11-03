/** Words with which a person asks not to be messaged again (Arabic, English, Turkish). */
const OPT_OUT_WORDS = [
  "ايقاف", "توقف", "توقفوا", "الغاء", "الغاء الاشتراك", "الغاء الاشتراك من الرسائل", "لا ترسل", "لا ترسلوا",
  "stop", "unsubscribe", "cancel", "remove me", "stop messages",
  "dur", "durdur", "iptal", "cikar", "mesaj gonderme", "abonelikten cik",
];

/** Lower case, no diacritics, no punctuation, one kind of alef/yaa/taa marbuta, Turkish letters folded. */
export function normalizeOptOutText(text: string): string {
  return String(text ?? "")
    .replace(/İ/g, "i")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_WORDS = OPT_OUT_WORDS.map(normalizeOptOutText).sort((a, b) => b.length - a.length);

/**
 * True for a short message that is just a request to stop («إيقاف» / «stop please»). A long message
 * is a conversation, not a request, and is left to a person.
 */
export function isOptOutMessage(text: string): boolean {
  const normalized = normalizeOptOutText(text);
  if (!normalized || normalized.length > 40) return false;
  return NORMALIZED_WORDS.some((word) => normalized === word || normalized.startsWith(`${word} `));
}

export const DEFAULT_OPTOUT_FOOTER = "لإيقاف الرسائل أرسل كلمة: إيقاف";
