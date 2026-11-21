/**
 * What a customer's short answer means: yes, no, or stop. Only a SHORT message that is exactly one of the known
 * words counts. «نعم بس بدي أسأل عن السعر» is not a «yes», and «لا أريد إيقاف الخدمة» is not a «stop»: when in doubt
 * the answer is «unknown» and nothing changes. Pure.
 */
import { normalizeText } from "../../lib/fuzzy-search.ts";

export type ReplyIntent = "yes" | "no" | "stop" | "unknown";
const MAX_LENGTH = 24;

const WORDS: Record<Exclude<ReplyIntent, "unknown">, string[]> = {
  stop: ["ايقاف", "stop", "توقف", "وقف", "الغاء", "الغاء الاشتراك", "unsubscribe", "stop all", "ايقاف الرسائل"],
  yes: ["نعم", "اي", "ايه", "اكيد", "تمام", "اوكي", "اوك", "موافق", "yes", "ok", "okay", "y", "اي نعم", "نعم اكيد"],
  no: ["لا", "كلا", "لا شكرا", "no", "n", "غير موافق", "لا اريد"],
};
const INDEX = new Map<string, ReplyIntent>();
for (const intent of ["yes", "no", "stop"] as const) for (const word of WORDS[intent]) INDEX.set(normalizeText(word), intent);

export function classifyReply(text: string | null | undefined): ReplyIntent {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > MAX_LENGTH) return "unknown";
  // Punctuation, emoji-free: «نعم!» «ايقاف.» are the same word.
  const clean = normalizeText(raw).replace(/[.!؟?،,:;"'«»()\-_*~]+/g, " ").replace(/\s+/g, " ").trim();
  return INDEX.get(clean) ?? "unknown";
}
