export const CONVERSION_LABELS = {
  none: "غير مصنّفة",
  new_lead: "تواصل جديد",
  qualified_lead: "عميل مؤهل",
  booking: "حجز مؤكد",
  purchase: "بيع ناجح",
  lost: "خسارة / إلغاء",
} as const;
export type ConversionKind = keyof typeof CONVERSION_LABELS;
export const PRIMARY_GOALS = ["qualified_lead", "booking", "purchase"] as const;
export type ConversionGoal = (typeof PRIMARY_GOALS)[number];
export function validateConversionRules(
  rules: { stageId: string; classification: ConversionKind }[],
) {
  if (new Set(rules.map((r) => r.stageId)).size !== rules.length)
    throw new Error("المرحلة مكررة في الإعدادات");
}
