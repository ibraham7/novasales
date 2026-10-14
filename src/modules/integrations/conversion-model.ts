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
export const QUALITY_LEVELS = {
  very_bad: { label: "سيء جدًا", score: 0 },
  average: { label: "متوسط", score: 3 },
  good: { label: "جيد", score: 6 },
  excellent: { label: "ممتاز", score: 10 },
} as const;
export type QualityLevel = keyof typeof QUALITY_LEVELS;
export const QUALITY_LEVEL_KEYS = Object.keys(QUALITY_LEVELS) as QualityLevel[];
/** Each quality level may sit on one stage per pipeline. */
export function validateQualityLevels(
  rules: { stageId: string; qualityLevel?: QualityLevel | null }[],
  pipelineOfStage: (stageId: string) => string | undefined,
) {
  const seen = new Set<string>();
  for (const r of rules) {
    if (!r.qualityLevel) continue;
    const key = `${pipelineOfStage(r.stageId)}:${r.qualityLevel}`;
    if (seen.has(key)) throw new Error("تقييم الجودة مستخدم لأكثر من مرحلة في القمع نفسه");
    seen.add(key);
  }
}
