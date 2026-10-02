export function normalizeLeadPhone(value: string) {
  const digits = value
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[\s()-]/g, "");
  const phone = digits.startsWith("00") ? "+" + digits.slice(2) : digits;
  if (!/^\+?\d{7,15}$/.test(phone))
    throw new Error("رقم الهاتف يجب أن يحتوي على 7 إلى 15 رقمًا، ويمكن أن يبدأ بـ +");
  return phone;
}
export async function readLeadRows(makeQuery: () => any) {
  const rows: any[] = [];
  for (let offset = 0; ;) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw leadError(error);
    if (!data?.length) return rows;
    rows.push(...data);
    offset += data.length;
  }
}
export function leadError(error: any): Error {
  console.error("[Lead management]", error);
  if (error.code === "23505")
    return new Error(
      "رقم الهاتف أو البريد مستخدم مسبقًا في هذه المؤسسة؛ استخدم جهة الاتصال الموجودة",
    );
  if (/[\u0600-\u06ff]/.test(error.message ?? "")) return new Error(error.message);
  return new Error("تعذر إتمام العملية؛ أعد المحاولة أو تواصل مع الإدارة");
}
export function paginateLeads(rows: any[], page: number, pageSize: number) {
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}
