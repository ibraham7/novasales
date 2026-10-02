import { z } from "zod";

const names: Record<string, string> = {
  name: "الاسم", full_name: "الاسم الكامل", fullName: "الاسم الكامل", contactName: "اسم العميل",
  code: "الكود", key: "المفتاح", label: "التسمية", email: "البريد الإلكتروني", password: "كلمة المرور",
  phone: "رقم الهاتف", title: "العنوان", body: "النص", text: "نص الرسالة", url: "الرابط",
  currency: "العملة", price: "السعر", price_monthly: "السعر الشهري", price_quarterly: "السعر الربع سنوي",
  price_yearly: "السعر السنوي", trial_days: "أيام التجربة", quantity: "الكمية", items: "منتجات الطلب",
  sold_unit_price: "سعر البيع", delta: "تعديل الكمية", reason: "السبب", limit_key: "مفتاح الحد",
  limit_value: "قيمة الحد", organization_id: "المؤسسة", userId: "المستخدم", roleId: "الصلاحية",
  accountId: "رقم واتساب", templateId: "القالب", contact_id: "العميل", providerId: "المحرك",
};
export function issueMessage(issue: z.ZodIssue): string {
  const field = names[String(issue.path[issue.path.length - 1])] ?? "الحقل";
  if (/[\u0600-\u06ff]/.test(issue.message)) return issue.message;
  switch (issue.code) {
    case "invalid_type": return `${field}: ${issue.received === "undefined" || issue.received === "null" ? "هذا الحقل إلزامي" : "أدخل قيمة صحيحة"}`;
    case "too_small": return `${field}: ${issue.type === "string" ? `أدخل ${issue.minimum} حرفًا على الأقل` : issue.type === "array" ? `اختر ${issue.minimum} عنصرًا على الأقل` : `يجب ألا تقل القيمة عن ${issue.minimum}`}`;
    case "too_big": return `${field}: ${issue.type === "string" ? `الحد الأقصى ${issue.maximum} حرفًا` : `يجب ألا تتجاوز القيمة ${issue.maximum}`}`;
    case "invalid_string": return `${field}: ${issue.validation === "email" ? "أدخل بريدًا إلكترونيًا صحيحًا" : issue.validation === "url" ? "أدخل رابطًا صحيحًا" : "الصيغة غير صحيحة"}`;
    case "invalid_enum_value": return `${field}: اختر قيمة صحيحة من القائمة`;
    default: return `${field}: القيمة غير صحيحة`;
  }
}
z.setErrorMap((issue, ctx) => ({ message: issueMessage({ ...issue, message: ctx.defaultError } as z.ZodIssue) }));
export { z };

export function arabicError(error: unknown): string {
  const message = typeof error === "string" ? error : (error as { message?: string })?.message ?? "";
  if (error instanceof z.ZodError) return error.issues.map(issueMessage).join("؛ ");
  try { const issues = JSON.parse(message); if (Array.isArray(issues) && issues.every(i => i.code && i.path)) return issues.map(issueMessage).join("؛ "); } catch { /* not a serialized validation error */ }
  if (/invalid login credentials/i.test(message)) return "اسم المستخدم أو كلمة المرور غير صحيحة";
  if (/email.*confirmed/i.test(message)) return "يرجى تأكيد البريد الإلكتروني قبل تسجيل الدخول";
  if (/already registered|already exists|duplicate key/i.test(message)) return "هذه البيانات مستخدمة بالفعل؛ أدخل قيمة مختلفة";
  if (/invalid.*email|email.*invalid/i.test(message)) return "أدخل بريدًا إلكترونيًا صحيحًا";
  if (/password.*least|password.*short/i.test(message)) return "كلمة المرور أقصر من الحد المطلوب";
  if (/fetch|network|timeout/i.test(message)) return "تعذر الاتصال بالخادم؛ تحقق من الإنترنت وحاول مجددًا";
  if (/[\u0600-\u06ff]/.test(message) && !message.includes('"code"')) return message;
  return "تعذر إتمام العملية؛ تحقق من البيانات وحاول مجددًا";
}
