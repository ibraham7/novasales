/**
 * What went wrong, in words a person can act on, plus the technical reason for those who need it.
 * `friendly` is always safe to show; `technical` is the raw reason (shortened, no stack) and is shown
 * only to people who manage the organization. Pure, so it is tested without a browser.
 */
export type Explained = { friendly: string; technical: string | null };

const ARABIC = /[؀-ۿ]/;
const cut = (text: string, max = 400) => (text.length > max ? `${text.slice(0, max)}…` : text);
const quoted = (text: string, pattern: RegExp) => pattern.exec(text)?.[1];

export function explainError(error: unknown): Explained {
  const raw = (typeof error === "string" ? error : ((error as { message?: unknown })?.message as string | undefined) ?? "").trim();
  const technical = raw ? cut(raw.replace(/\s+/g, " ")) : null;
  if (!raw) return { friendly: "حدث خطأ غير متوقع", technical: null };

  // A disconnected WhatsApp number is the most common cause of failed sends.
  if (/connection closed/i.test(raw)) {
    return { friendly: "رقم واتساب غير متصل (انفصلت الجلسة). أعد ربطه من صفحة أرقام الواتساب ثم أعد المحاولة", technical };
  }
  if (/evolution api/i.test(raw) && /\b(5\d\d)\b/.test(raw)) {
    return { friendly: "خادم واتساب (Evolution) رفض الرسالة. تحقق أن الرقم متصل ثم أعد المحاولة", technical };
  }

  // Database
  if (/duplicate key value|violates unique constraint/i.test(raw)) {
    const name = quoted(raw, /unique constraint "([^"]+)"/i);
    return { friendly: "هذه البيانات موجودة مسبقاً (مكررة)" + (name ? ` · القيد: ${name}` : ""), technical };
  }
  if (/violates foreign key constraint/i.test(raw)) {
    const name = quoted(raw, /foreign key constraint "([^"]+)"/i);
    return { friendly: "هذا السجل مرتبط بسجل آخر غير موجود أو لا يمكن حذفه" + (name ? ` · القيد: ${name}` : ""), technical };
  }
  if (/violates check constraint/i.test(raw)) {
    const name = quoted(raw, /check constraint "([^"]+)"/i);
    return { friendly: "قيمة غير مسموحة بقاعدة البيانات" + (name ? ` · القيد: ${name}` : ""), technical };
  }
  if (/null value in column/i.test(raw)) {
    const column = quoted(raw, /null value in column "([^"]+)"/i);
    return { friendly: "حقل مطلوب لم يُرسل" + (column ? ` · الحقل: ${column}` : ""), technical };
  }
  if (/row-level security|permission denied for|violates row-level/i.test(raw)) {
    return { friendly: "قاعدة البيانات رفضت العملية بسبب الصلاحيات", technical };
  }
  if (/schema cache|does not exist|PGRST20\d|could not find the .* column/i.test(raw)) {
    return { friendly: "ينقص تحديث لقاعدة البيانات (جدول أو عمود غير موجود). شغّل ملف SQL الخاص بالميزة", technical };
  }
  if (/statement timeout|canceling statement/i.test(raw)) {
    return { friendly: "استغرق الطلب وقتاً طويلاً وأُلغي. أعد المحاولة", technical };
  }
  if (/forbidden: missing permission/i.test(raw)) {
    const permission = quoted(raw, /"([^"]+)"/);
    return { friendly: "ليس لديك صلاحية لهذه العملية" + (permission ? ` · الصلاحية: ${permission}` : ""), technical };
  }
  if (/unauthorized/i.test(raw)) {
    return { friendly: "انتهت الجلسة. سجّل الدخول من جديد", technical };
  }

  // Network
  if (/failed to fetch|fetch failed|networkerror|econnrefused|econnreset|etimedout|enotfound|socket hang up/i.test(raw)) {
    return { friendly: "تعذر الاتصال بالخدمة (الشبكة أو الخادم). تحقق من الإنترنت وأعد المحاولة", technical };
  }
  if (/aborted|timed? ?out|انتهت مهلة/i.test(raw) && !ARABIC.test(raw)) {
    return { friendly: "انتهت مهلة الطلب. أعد المحاولة", technical };
  }

  // Messages our own code wrote for people are already clear.
  if (ARABIC.test(raw)) return { friendly: raw, technical: null };
  return { friendly: "حدث خطأ غير متوقع", technical };
}

// Who may see the technical reason: set by the app once it knows the user's permissions.
let detailsAllowed = false;
export const setErrorDetailsAllowed = (allowed: boolean) => {
  detailsAllowed = allowed;
};
export const errorDetailsAllowed = () => detailsAllowed;
