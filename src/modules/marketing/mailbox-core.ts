/** Organization mailboxes: save (after proving the login works), list without secrets, remove, and load one for sending. */
import { ALLOWED_SMTP_PORTS, smtpVerify, type SmtpConfig, type SmtpSecurity } from "./smtp.ts";
export { MAILBOX_PRESETS } from "./mailbox-presets.ts";
import { sealSecret, openSecret } from "./secret-box.ts";

export type MailboxInput = {
  organizationId: string;
  userId: string;
  id?: string;
  label: string;
  fromEmail: string;
  fromName?: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUser: string;
  /** Empty when editing an existing mailbox and the password is not being changed. */
  smtpPass?: string;
  dailyLimit: number;
};
export type MailboxDeps = { secret: string; allowPrivate?: boolean };

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/** A message a person can act on, instead of the server's raw reply. */
export function explainMailError(error: string, auth?: boolean): string {
  if (auth) return "رفض الخادم اسم المستخدم أو كلمة السر. في Gmail و Outlook استخدم «كلمة مرور التطبيق» (App Password) وليس كلمة سر الحساب؛ وتأكد أن SMTP مفعّل لحسابك";
  if (/ENOTFOUND|تعذر العثور/.test(error)) return "تعذر العثور على خادم البريد؛ تحقق من عنوان الخادم";
  if (/ECONNREFUSED|ETIMEDOUT|انتهت مهلة|EHOSTUNREACH/.test(error)) return "تعذر الاتصال بخادم البريد؛ تحقق من المنفذ ونوع التشفير (465=SSL، 587=STARTTLS)";
  if (/wrong version number|SSL routines|ssl3|certificate/i.test(error)) return "فشل التشفير مع الخادم؛ جرّب المنفذ 465 مع SSL أو 587 مع STARTTLS";
  return `تعذر الاتصال بالصندوق: ${error}`;
}

export async function saveMailbox(db: any, deps: MailboxDeps, input: MailboxInput) {
  const label = input.label.trim();
  const fromEmail = input.fromEmail.trim().toLowerCase();
  const host = input.smtpHost.trim().toLowerCase();
  if (!label) throw new Error("اكتب اسماً للصندوق");
  if (!EMAIL.test(fromEmail)) throw new Error("عنوان البريد غير صالح");
  if (!HOST.test(host)) throw new Error("عنوان خادم SMTP غير صالح");
  if (!deps.allowPrivate && !ALLOWED_SMTP_PORTS.includes(input.smtpPort)) throw new Error("منفذ SMTP غير مسموح؛ استخدم 465 أو 587");
  if (!input.smtpUser.trim()) throw new Error("اكتب اسم المستخدم (غالباً عنوان البريد نفسه)");
  const dailyLimit = Math.max(1, Math.min(Math.floor(input.dailyLimit) || 50, 2000));

  let existing: any = null;
  if (input.id) {
    const { data } = await db.from("ob_mailboxes").select("id,smtp_pass_enc").eq("organization_id", input.organizationId).eq("id", input.id).maybeSingle();
    if (!data) throw new Error("الصندوق غير موجود");
    existing = data;
  }
  const pass = input.smtpPass ?? "";
  if (!pass && !existing) throw new Error("اكتب كلمة سر الصندوق");
  const sealed = pass ? sealSecret(pass, deps.secret) : (existing.smtp_pass_enc as string);
  const plain = pass || openSecret(sealed, deps.secret);

  // Nothing is saved unless the login really works.
  const check = await smtpVerify({ host, port: input.smtpPort, security: input.smtpSecurity, user: input.smtpUser.trim(), pass: plain }, { allowPrivate: deps.allowPrivate });
  if (!check.ok) throw new Error(explainMailError(check.error, check.auth));

  const row = {
    organization_id: input.organizationId,
    label: label.slice(0, 100),
    from_email: fromEmail,
    from_name: input.fromName?.trim().slice(0, 100) || null,
    smtp_host: host,
    smtp_port: input.smtpPort,
    smtp_security: input.smtpSecurity,
    smtp_user: input.smtpUser.trim(),
    smtp_pass_enc: sealed,
    daily_limit: dailyLimit,
    status: "active",
    last_error: null,
    last_checked_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await db.from("ob_mailboxes").update(row).eq("organization_id", input.organizationId).eq("id", existing.id);
    if (error) throw new Error("تعذر حفظ الصندوق");
    return { id: existing.id as string };
  }
  const { data, error } = await db.from("ob_mailboxes").insert({ ...row, created_by: input.userId }).select("id").single();
  if (error || !data) throw new Error(error?.code === "23505" ? "هذا العنوان مضاف مسبقاً" : "تعذر حفظ الصندوق");
  return { id: data.id as string };
}

export async function listMailboxes(db: any, organizationId: string) {
  const { data, error } = await db.from("ob_mailboxes").select("id,label,from_email,from_name,smtp_host,smtp_port,smtp_security,smtp_user,daily_limit,status,last_error,last_checked_at,created_at").eq("organization_id", organizationId).order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function deleteMailbox(db: any, organizationId: string, id: string) {
  const { data: busy } = await db.from("ob_email_campaigns").select("id").eq("organization_id", organizationId).eq("mailbox_id", id).in("status", ["scheduled", "running"]).limit(1);
  if ((busy ?? []).length) throw new Error("توجد حملة جارية على هذا الصندوق؛ أوقفها أو انتظر انتهاءها");
  const { error } = await db.from("ob_mailboxes").delete().eq("organization_id", organizationId).eq("id", id);
  if (error) throw new Error("تعذر حذف الصندوق");
}

/** What the sender needs: connection settings, the from address and the daily limit. Null when missing or disabled. */
export async function loadMailbox(db: any, deps: MailboxDeps, organizationId: string, id: string): Promise<{ smtp: SmtpConfig; fromEmail: string; fromName: string; dailyLimit: number } | null> {
  const { data } = await db.from("ob_mailboxes").select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle();
  if (!data || data.status === "disabled") return null;
  return {
    smtp: { host: data.smtp_host, port: data.smtp_port, security: data.smtp_security, user: data.smtp_user, pass: openSecret(data.smtp_pass_enc, deps.secret) },
    fromEmail: data.from_email,
    fromName: data.from_name ?? "",
    dailyLimit: data.daily_limit,
  };
}
