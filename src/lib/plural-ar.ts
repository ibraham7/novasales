/** Arabic number agreement for the few counted words the marketing screens use. */

/** «رسالة» after a number: 1 رسالة, 2 رسالتان, 3–10 رسائل, 11+ رسالة. */
export function messageWord(n: number): string {
  if (n === 2) return "رسالتان";
  return n >= 3 && n <= 10 ? "رسائل" : "رسالة";
}

/** «آخر N يوماً»: 3–10 take the plural «أيام» (آخر 7 أيام), the others «يوماً» (آخر 30 يوماً). */
export function lastDays(n: number): string {
  if (n === 2) return "آخر يومين";
  return n >= 3 && n <= 10 ? `آخر ${n} أيام` : `آخر ${n} يوماً`;
}
