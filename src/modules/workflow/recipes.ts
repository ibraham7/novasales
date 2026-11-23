/**
 * Ready-made workflows, one click each. A recipe is only a starting point: it is created SWITCHED OFF, the person
 * reads it, changes the words, and switches it on. Customer messages still need the organization's automatic
 * sending switched on (send settings), and staff alerts their own switch. Pure data.
 */
import { linkWorkflowSteps } from "./definition.ts";

export type RecipeStep = Record<string, any>;
export type Recipe = {
  id: string;
  title: string;
  description: string;
  category: "تجربة" | "عملاء جدد" | "متابعة" | "عروض الأسعار" | "إغلاق الصفقة" | "تنبيهات الفريق" | "الاجتماعات";
  /** What it sends: «خدمة» replies to people who wrote to us; «ترويج» only to those who agreed; «داخلي» goes to staff only. */
  audience: "خدمة" | "ترويج" | "داخلي";
  trigger: { type: "event"; config: Record<string, any> };
  steps: RecipeStep[];
};

const step = (id: string, label: string, action: string, config: Record<string, unknown>): RecipeStep => ({ id, type: "action", label, action, config });
const wait = (id: string, label: string, minutes: number): RecipeStep => ({ id, type: "delay", label, duration_minutes: minutes });

/** The recipes added in later steps are appended here. */
export const BASE_RECIPES: Recipe[] = [
  {
    id: "starter-task-on-stage",
    title: "تجربة: مهمة عند تغيّر المرحلة",
    description: "عند انتقال أي تذكرة لمرحلة جديدة تُنشأ مهمة «راجع التذكرة». لا ترسل شيئاً لأحد، فهي مناسبة لتجربة الأتمتة بأمان.",
    category: "تجربة",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "crm.opportunity.stage_changed" } },
    steps: [step("task", "إنشاء مهمة مراجعة", "crm.task.create", { title: "راجع التذكرة بعد تغيّر المرحلة", priority: "normal" })],
  },
  {
    id: "alert-assignee-on-assign",
    title: "تنبيه المندوب عند إسناد تذكرة له",
    description: "عند إسناد تذكرة لمندوب يصله تنبيه فيه اسم العميل. تنبيهات الفريق مطفأة حتى تُفعَّل من «إعدادات الإرسال».",
    category: "تنبيهات الفريق",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "crm.opportunity.assigned" } },
    steps: [step("alert", "تنبيه المندوب", "notify.staff", { to: "assignee", title: "تذكرة جديدة لك: {name}", body: "المصدر: {source} · المرحلة: {stage}" })],
  },
];

const msg = (id: string, label: string, body: string, extra: Record<string, unknown> = {}): RecipeStep =>
  step(id, label, "message.whatsapp", { kind: "service", account: "ticket", body, ...extra });
const alertStep = (id: string, to: string, title: string, body: string): RecipeStep => step(id, "تنبيه الفريق", "notify.staff", { to, title, body });
const DAY_MIN = 1440;

/** Sales recipes. Every one is created switched off; wording is a starting point for the team to edit. */
export const SALES_RECIPES: Recipe[] = [
  {
    id: "welcome-new-ticket",
    title: "ترحيب بالعميل الجديد",
    description: "عند فتح تذكرة جديدة يصل العميل ترحيب قصير باسمه، مرة واحدة فقط لكل عميل خلال سنة (حتى لو فُتحت له عدة تذاكر). يُرسل فقط لمن راسلنا من قبل.",
    category: "عملاء جدد",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "crm.opportunity.created" } },
    steps: [msg("welcome", "رسالة الترحيب", "{أهلاً|مرحباً} {first_name}، شكراً لتواصلك مع {org}. معك {assignee} وسأساعدك بكل سرور.", { once_per_contact_days: 365 })],
  },
  {
    id: "no-reply-followups",
    title: "متابعة العميل الذي لم يردّ (ساعة، يوم، 3 أيام، 7 أيام)",
    description: "إذا لم يردّ العميل على آخر رسالة منّا بعد ساعة تُرسل متابعة، ثم بعد يوم، ثم 3 أيام، ثم 7 أيام. تتوقف كلها فور ردّ العميل أو انتقال التذكرة لمرحلة أخرى.",
    category: "متابعة",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "time.no_reply", after_minutes: 60, stop_on: ["customer_reply", "stage_change"] } },
    steps: [
      msg("f1", "متابعة بعد ساعة", "{أهلاً|مرحباً} {first_name}، حبيت أتأكد أن رسالتي وصلتك. هل عندك أي سؤال؟"),
      wait("w1", "انتظار حتى اليوم التالي", DAY_MIN - 60),
      msg("f2", "متابعة بعد يوم", "{first_name}، ما زلت جاهزاً لمساعدتك. هل تحب أن نكمل؟"),
      wait("w2", "انتظار يومين", 2 * DAY_MIN),
      msg("f3", "متابعة بعد 3 أيام", "{أهلاً|مرحباً} {first_name}، أتابع معك بخصوص طلبك. أخبرني متى يناسبك."),
      wait("w3", "انتظار 4 أيام", 4 * DAY_MIN),
      msg("f4", "متابعة بعد 7 أيام", "{first_name}، هذه آخر متابعة مني. إن احتجت أي شيء لاحقاً راسلني في أي وقت."),
    ],
  },
  {
    id: "after-quote-followup",
    title: "متابعة بعد إرسال عرض السعر",
    description: "عندما تنتقل التذكرة لمرحلة «عرض سعر» تُرسل متابعة بعد يوم، وتتوقف إن ردّ العميل. غيّر اسم المرحلة في المشغّل ليطابق مرحلتك.",
    category: "عروض الأسعار",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "crm.opportunity.stage_changed", match: { to_stage_name: "عرض سعر" }, stop_on: ["customer_reply", "stage_change"] } },
    steps: [wait("w", "انتظار يوم", DAY_MIN), msg("q", "متابعة العرض", "{أهلاً|مرحباً} {first_name}، هل اطّلعت على عرض السعر؟ يسعدني الإجابة عن أي سؤال.")],
  },
  {
    id: "thanks-on-win",
    title: "شكر العميل عند إتمام الصفقة",
    description: "عند انتقال التذكرة لمرحلة الفوز يصل العميل شكر. غيّر اسم المرحلة في المشغّل ليطابق مرحلتك.",
    category: "إغلاق الصفقة",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "crm.opportunity.stage_changed", match: { to_stage_name: "تم الفوز" } } },
    steps: [msg("thanks", "رسالة الشكر", "شكراً لثقتك {first_name} 🙏 يسعدنا خدمتك في {org}، ونحن بجانبك دائماً.")],
  },
  {
    id: "recontact-lost",
    title: "إعادة التواصل مع العميل المفقود بعد 30 يوماً",
    description: "بعد 30 يوماً من انتقال التذكرة للمهمل يُرسل عرض عودة. رسالة ترويجية: لا تُرسل إلا لمن وافق على الترويج، وتحمل جملة إيقاف تلقائياً. غيّر اسم المرحلة ليطابق مرحلتك.",
    category: "إغلاق الصفقة",
    audience: "ترويج",
    trigger: { type: "event", config: { event: "crm.opportunity.stage_changed", match: { to_stage_name: "مهمل" }, stop_on: ["customer_reply"] } },
    steps: [wait("w", "انتظار 30 يوماً", 30 * DAY_MIN), msg("back", "رسالة العودة", "{أهلاً|مرحباً} {first_name}، عندنا جديد في {org} قد يناسبك. هل تحب أن أخبرك به؟", { kind: "promo" })],
  },
  {
    id: "review-request",
    title: "طلب تقييم بعد إتمام الصفقة",
    description: "بعد 3 أيام من الفوز يُطلب من العميل تقييم تجربته. غيّر اسم المرحلة في المشغّل، وضع رابط التقييم في الرسالة.",
    category: "إغلاق الصفقة",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "crm.opportunity.stage_changed", match: { to_stage_name: "تم الفوز" } } },
    steps: [wait("w", "انتظار 3 أيام", 3 * DAY_MIN), msg("review", "طلب التقييم", "{first_name}، رأيك يهمنا في {org}. هل تشاركنا تقييم تجربتك؟ (ضع الرابط هنا)")],
  },
  {
    id: "alert-unassigned",
    title: "تنبيه المدير: تذكرة بلا مندوب",
    description: "إذا بقيت تذكرة بلا مندوب 30 دقيقة يصل المدراء تنبيه. تنبيه داخلي فقط ويتطلب تفعيل «تنبيهات الفريق».",
    category: "تنبيهات الفريق",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "time.unassigned", after_minutes: 30 } },
    steps: [alertStep("a", "managers", "تذكرة بلا مندوب: {name}", "المصدر: {source} · المرحلة: {stage}")],
  },
  {
    id: "alert-stale",
    title: "تنبيه المندوب: تذكرة راكدة",
    description: "إذا لم يحدث أي نشاط على التذكرة 3 أيام يصل المندوب تنبيه. داخلي فقط.",
    category: "تنبيهات الفريق",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "time.stale", after_minutes: 3 * DAY_MIN } },
    steps: [alertStep("a", "assignee", "تذكرة راكدة: {name}", "لا نشاط منذ 3 أيام · المرحلة: {stage}")],
  },
  {
    id: "alert-followup-due",
    title: "تنبيه المندوب: متابعة متأخرة",
    description: "عند تأخر مهمة متابعة يصل صاحبها تنبيه. داخلي فقط.",
    category: "تنبيهات الفريق",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "time.task_overdue", after_minutes: 0 } },
    steps: [alertStep("a", "assignee", "متابعة متأخرة", "عندك مهمة تجاوزت موعدها. راجع مهامك.")],
  },
  {
    id: "morning-digest",
    title: "ملخص الصباح لكل مندوب",
    description: "كل صباح (9:00 بتوقيت المؤسسة) يصل كل مندوب عنده مهام اليوم أو متأخرة ملخص بعددها. داخلي فقط.",
    category: "تنبيهات الفريق",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "time.daily_digest", hour: 9 } },
    steps: [alertStep("a", "assignee", "ملخص يومك", "مهام اليوم: {due_today} · متأخرة: {overdue}")],
  },
  {
    id: "alert-channel-disconnected",
    title: "تنبيه: انقطع حساب واتساب",
    description: "إذا بقي حساب واتساب غير متصل 10 دقائق يصل المدراء تنبيه. داخلي فقط.",
    category: "تنبيهات الفريق",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "time.channel_disconnected", after_minutes: 10 } },
    steps: [alertStep("a", "managers", "انقطع واتساب: {account}", "الحساب غير متصل. افتح صفحة القنوات وأعد الربط.")],
  },
];

/** Meeting recipes (calendar). All created switched off; customer messages still need «إرسال الرسائل للعملاء» in the send settings. */
export const CALENDAR_RECIPES: Recipe[] = [
  {
    id: "meeting-reminder-day",
    title: "تذكير العميل قبل الاجتماع بيوم",
    description: "قبل موعد الاجتماع بـ 24 ساعة تصل العميل رسالة بتاريخ ووقت الاجتماع. لا تُرسل إن حُجز الاجتماع قبل أقل من يوم من موعده.",
    category: "الاجتماعات",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "time.meeting_starts_in", before_minutes: 1440 } },
    steps: [msg("remind", "تذكير قبل يوم", "{أهلاً|مرحباً} {first_name}، نذكّرك باجتماعنا {meeting_date} الساعة {meeting_time}. إن احتجت تغيير الموعد أخبرنا.")],
  },
  {
    id: "meeting-reminder-hour",
    title: "تذكير العميل قبل الاجتماع بساعة",
    description: "قبل موعد الاجتماع بساعة تصل العميل رسالة تذكير قصيرة.",
    category: "الاجتماعات",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "time.meeting_starts_in", before_minutes: 60 } },
    steps: [msg("remind", "تذكير قبل ساعة", "{first_name}، اجتماعنا اليوم الساعة {meeting_time}. بانتظارك.")],
  },
  {
    id: "meeting-confirm-reply",
    title: "تأكيد الاجتماع بردّ العميل «نعم»",
    description: "قبل الاجتماع بيوم يُسأل العميل أن يردّ «نعم» للتأكيد. عند ردّه يتحول الاجتماع إلى «مؤكَّد» تلقائياً؛ وإن لم يردّ خلال 12 ساعة يصل المندوب تنبيه. يعمل الردّ عندما يكون الاجتماع مرتبطاً بفرصة.",
    category: "الاجتماعات",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "time.meeting_starts_in", before_minutes: 1440 } },
    steps: [
      msg("ask", "سؤال التأكيد", "{أهلاً|مرحباً} {first_name}، موعدنا {meeting_date} الساعة {meeting_time}. هل تؤكد حضورك؟ ردّ بكلمة: نعم"),
      { id: "wait", type: "wait_for_event", label: "انتظار ردّ «نعم»", event: "messaging.reply.yes", match: { opportunity_id: "{{trigger.opportunity_id}}" }, timeout_minutes: 720, onEvent: "confirm", onTimeout: "noanswer" },
      step("confirm", "تأكيد الاجتماع", "calendar.meeting.confirm", {}),
      { id: "end-confirmed", type: "end", label: "تم التأكيد" },
      alertStep("noanswer", "assignee", "لم يؤكد العميل الاجتماع: {name}", "الاجتماع {meeting_date} الساعة {meeting_time}. تواصل معه."),
      { id: "end-unanswered", type: "end", label: "بلا ردّ" },
    ],
  },
  {
    id: "meeting-agent-prestart",
    title: "تنبيه المندوب قبل اجتماعه بـ 15 دقيقة",
    description: "قبل بدء الاجتماع بـ 15 دقيقة يصل المندوب تنبيه داخلي. داخلي فقط.",
    category: "الاجتماعات",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "time.meeting_starts_in", before_minutes: 15 } },
    steps: [alertStep("a", "assignee", "اجتماعك بعد قليل: {name}", "{meeting_type} الساعة {meeting_time}")],
  },
  {
    id: "meetings-morning-digest",
    title: "ملخص اجتماعات اليوم لكل مندوب",
    description: "كل صباح (8:00 بتوقيت المؤسسة) يصل كل مندوب عنده اجتماعات اليوم تنبيه بعددها. داخلي فقط.",
    category: "الاجتماعات",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "time.meetings_digest", hour: 8 } },
    steps: [alertStep("a", "assignee", "اجتماعاتك اليوم", "عندك {meetings_today} اجتماع اليوم.")],
  },
  {
    id: "meeting-created-notify",
    title: "تنبيه المندوب عند حجز اجتماع له",
    description: "عند حجز اجتماع جديد يصل المندوب المسؤول تنبيه بنوعه وموعده. داخلي فقط.",
    category: "الاجتماعات",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "calendar.meeting.created" } },
    steps: [alertStep("a", "assignee", "اجتماع جديد: {name}", "{meeting_type} {meeting_date} الساعة {meeting_time}")],
  },
  {
    id: "meeting-cancelled-notify",
    title: "تنبيه المندوب عند إلغاء اجتماع",
    description: "عند إلغاء اجتماع يصل المندوب المسؤول تنبيه. داخلي فقط.",
    category: "الاجتماعات",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "calendar.meeting.cancelled" } },
    steps: [alertStep("a", "assignee", "أُلغي اجتماع: {name}", "{meeting_type} {meeting_date} الساعة {meeting_time}")],
  },
  {
    id: "meeting-thanks",
    title: "شكر العميل بعد الاجتماع",
    description: "عند تسجيل انتهاء الاجتماع تصل العميل رسالة شكر قصيرة.",
    category: "الاجتماعات",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "calendar.meeting.completed" } },
    steps: [msg("thanks", "رسالة الشكر", "شكراً لوقتك {first_name}. سعدنا بلقائك، وأنا بانتظار أي سؤال عندك.")],
  },
  {
    id: "meeting-no-show",
    title: "متابعة العميل الذي لم يحضر",
    description: "عند تسجيل «لم يحضر» تصل العميل رسالة لطيفة تعرض إعادة الجدولة.",
    category: "الاجتماعات",
    audience: "خدمة",
    trigger: { type: "event", config: { event: "calendar.meeting.no_show" } },
    steps: [msg("again", "عرض إعادة الجدولة", "{أهلاً|مرحباً} {first_name}، فاتنا لقاؤك اليوم. هل تحب أن نحدد موعداً آخر يناسبك؟")],
  },
];

export const RECIPES: Recipe[] = [...BASE_RECIPES, ...SALES_RECIPES, ...CALENDAR_RECIPES];

/** The workflow definition a recipe creates (steps chained one after the other). */
export function recipeDefinition(recipe: Recipe) {
  return { version: 1, engine: "v1", metadata: { recipe: recipe.id, createdAt: new Date().toISOString() }, steps: linkWorkflowSteps(recipe.steps) };
}
export { wait as recipeWait, step as recipeStep };
