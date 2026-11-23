/**
 * Message text with variables and varied wording, pure. Two kinds of braces:
 *   {مرحباً|أهلاً}   a choice (it has a «|»): one option is picked for each recipient, so a thousand messages do not
 *                    carry the same words (identical messages to many numbers are what WhatsApp flags);
 *   {name}           a variable, filled from the customer, the ticket and the organization.
 * The old double-brace form {{contact_name}} is still understood. A variable with no value is left empty, never
 * shown as «{name}» to a customer; the unknown ones are reported at save time instead (see unknownVariables).
 */
export const MESSAGE_VARIABLES: Record<string, string> = {
  name: "اسم العميل",
  first_name: "الاسم الأول للعميل",
  phone: "رقم هاتف العميل",
  stage: "المرحلة (الجديدة)",
  assignee: "اسم المندوب المسؤول",
  source: "مصدر العميل",
  org: "اسم الشركة",
  value: "قيمة الصفقة",
  due_today: "عدد مهام اليوم (الملخص)",
  overdue: "عدد المهام المتأخرة (الملخص)",
  account: "اسم حساب واتساب",
  meeting_day: "يوم الاجتماع وتاريخه (تذكير الاجتماع)",
  meeting_time: "ساعة الاجتماع (تذكير الاجتماع)",
  meeting_type: "نوع الاجتماع (تذكير الاجتماع)",
  meeting_in: "المدة المتبقية، مثل «خلال ساعة» (تذكير الاجتماع)",
};

/** Names used by earlier templates (double braces), mapped to the current ones. */
const ALIASES: Record<string, string> = { contact_name: "name", agent_name: "assignee", rep_name: "assignee", department_name: "org", org_name: "org", stage_name: "stage" };

export type Vars = Partial<Record<keyof typeof MESSAGE_VARIABLES, string | null | undefined>>;
export const MAX_MESSAGE_LENGTH = 1000;

const SPIN = /\{([^{}|]+(?:\|[^{}|]+)+)\}/g;
const DOUBLE = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g;
const SINGLE = /\{\s*([A-Za-z_][\w]*)\s*\}/g;

const canonical = (key: string) => ALIASES[key] ?? key;

export function renderMessage(template: string, vars: Vars, random: () => number = Math.random): string {
  const spun = template.replace(SPIN, (_m, inner: string) => {
    const options = inner.split("|").map((x) => x.trim()).filter(Boolean);
    return options[Math.min(options.length - 1, Math.floor(random() * options.length))] ?? "";
  });
  const fill = (_m: string, key: string) => String(vars[canonical(key) as keyof Vars] ?? "").trim();
  return spun
    .replace(DOUBLE, fill)
    .replace(SINGLE, fill)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** The variables a template uses that do not exist (so the person who writes it is told when saving). */
export function unknownVariables(template: string): string[] {
  const withoutSpin = template.replace(SPIN, "");
  const found = new Set<string>();
  for (const re of [DOUBLE, SINGLE]) {
    re.lastIndex = 0;
    for (const m of withoutSpin.matchAll(re)) if (!(canonical(m[1]!) in MESSAGE_VARIABLES)) found.add(m[1]!);
  }
  return [...found].sort();
}

/** Every wording a template can produce for one recipient (for previews and tests): the number of combinations. */
export function wordingCount(template: string): number {
  let n = 1;
  for (const m of template.matchAll(SPIN)) n *= m[1]!.split("|").map((x) => x.trim()).filter(Boolean).length;
  return n;
}

export const first = (name: string | null | undefined): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";
