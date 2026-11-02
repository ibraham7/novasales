/**
 * The kinds of notification a user can receive. One entry per kind: adding a kind means adding it
 * here and calling `notifyUsers` with its key from the place where the event happens.
 */
export const NOTIFICATION_TYPES = {
  lead_created: { label: "عميل جديد", description: "عند إضافة عميل جديد", group: "العملاء" },
  assignment: { label: "إسناد عميل أو فرصة", description: "عند إسناد عميل أو فرصة مبيعات إليك", group: "العملاء" },
  sale_created: { label: "عملية بيع جديدة", description: "عند إنشاء عملية بيع", group: "المبيعات" },
  sale_status: { label: "تحديث حالة عملية بيع", description: "عند تأكيد عملية بيع أو إلغائها أو حذفها", group: "المبيعات" },
  task_assigned: { label: "إسناد مهمة", description: "عند إسناد مهمة أو متابعة إليك", group: "المهام" },
  task_due: { label: "مهمة أو متابعة مستحقة", description: "عند حلول موعد مهمة أو متابعة", group: "المهام" },
  manual: { label: "رسائل من الإدارة", description: "إشعارات يرسلها المدير يدوياً", group: "الإدارة" },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

/** What the service worker receives. Kept small: push payloads are limited to about 4 KB. */
export type PushPayload = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  tag?: string;
};

/**
 * An internal path to open when the notification is clicked. Anything that is not a path inside
 * the site (another host, a script URL) falls back to the home page.
 */
export function safeInternalUrl(value: string | null | undefined, fallback = "/"): string {
  const url = String(value ?? "").trim();
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\") || /[\u0000-\u001f]/.test(url)) return fallback;
  return url.slice(0, 300);
}

/** Notification text is plain text and short, so it fits one push message and one lock screen. */
export function clip(text: string | null | undefined, max: number): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
