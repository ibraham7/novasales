/** Meeting statuses, the allowed moves between them (the same table as the database guard) and the outcome choices. */
export const STATUSES = ["booked", "confirmed", "in_progress", "completed", "cancelled", "no_show"] as const;
export type MeetingStatus = (typeof STATUSES)[number];
export const OUTCOMES = ["advanced", "needs_followup", "lost"] as const;
export type MeetingOutcome = (typeof OUTCOMES)[number];

export const STATUS_LABELS: Record<MeetingStatus, string> = { booked: "محجوز", confirmed: "مؤكَّد", in_progress: "جارٍ", completed: "مكتمل", cancelled: "ملغى", no_show: "لم يحضر" };
export const OUTCOME_LABELS: Record<MeetingOutcome, string> = { advanced: "تقدّمت الصفقة", needs_followup: "يحتاج متابعة", lost: "خسرنا الصفقة" };
export const CHANNELS = ["call", "whatsapp", "link", "in_person"] as const;
export type MeetingChannel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<MeetingChannel, string> = { call: "مكالمة", whatsapp: "واتساب", link: "رابط اجتماع", in_person: "حضوري" };

/** The statuses that take the agent's time (cancelled and no-show free it). */
export const BUSY_STATUSES: readonly MeetingStatus[] = ["booked", "confirmed", "in_progress", "completed"];
/** The statuses that can still change (not final). */
export const OPEN_STATUSES: readonly MeetingStatus[] = ["booked", "confirmed", "in_progress"];
export const isFinal = (status: string) => !(OPEN_STATUSES as readonly string[]).includes(status);

const MOVES: Record<MeetingStatus, readonly MeetingStatus[]> = {
  booked: ["confirmed", "in_progress", "completed", "cancelled", "no_show"],
  confirmed: ["booked", "in_progress", "completed", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};
export const canMove = (from: string, to: string): boolean => from === to || (MOVES[from as MeetingStatus] ?? []).includes(to as MeetingStatus);

/** The buttons of the details panel for a meeting in this status. */
export const ACTIONS: Record<MeetingStatus, { to: MeetingStatus; label: string }[]> = {
  booked: [{ to: "confirmed", label: "تأكيد" }, { to: "in_progress", label: "بدء الموعد" }, { to: "completed", label: "إنهاء" }, { to: "no_show", label: "لم يحضر" }, { to: "cancelled", label: "إلغاء" }],
  confirmed: [{ to: "in_progress", label: "بدء الموعد" }, { to: "completed", label: "إنهاء" }, { to: "no_show", label: "لم يحضر" }, { to: "cancelled", label: "إلغاء" }],
  in_progress: [{ to: "completed", label: "إنهاء" }, { to: "cancelled", label: "إلغاء" }],
  completed: [],
  cancelled: [],
  no_show: [],
};
/** The outcome can be recorded (or corrected) only on a completed meeting. */
export const canSetOutcome = (status: string) => status === "completed";
