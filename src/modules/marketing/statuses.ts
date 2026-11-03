/** The life of a discovered business, from found to a conversation. Later steps are set by the system, not by hand. */
export const PROSPECT_STATUS_LABELS = {
  new: "مكتشف حديثاً",
  review: "يحتاج مراجعة",
  qualified: "مؤهل",
  excluded: "غير مناسب",
  approved: "معتمد للتواصل",
  contacted: "تم التواصل",
  replied: "رد على الرسالة",
  interested: "مهتم",
  not_interested: "غير مهتم",
  converted: "تحوّل إلى فرصة بيع",
  opted_out: "ألغى الاشتراك",
  invalid: "غير صالح",
} as const;

export type ProspectStatus = keyof typeof PROSPECT_STATUS_LABELS;
export const PROSPECT_STATUSES = Object.keys(PROSPECT_STATUS_LABELS) as [ProspectStatus, ...ProspectStatus[]];

/** What a person may set by hand in the review table. */
export const MANUAL_STATUSES = ["new", "review", "qualified", "excluded", "approved", "invalid"] as const satisfies readonly ProspectStatus[];
export type ManualStatus = (typeof MANUAL_STATUSES)[number];
