/**
 * Social and ad platforms an organization can connect on «ربط وسائل التواصل». Each organization keeps
 * its own ids; nothing here is shared between organizations.
 */
export const SOCIAL_PLATFORMS = {
  facebook: { label: "فيسبوك (Meta Pixel)", idLabel: "Pixel ID", pattern: /^\d{10,20}$/, example: "4618096201805650" },
  instagram: { label: "إنستغرام", idLabel: "Pixel ID", pattern: /^\d{10,20}$/, example: "نفس بكسل ميتا عادةً" },
  tiktok: { label: "تيك توك (TikTok Pixel)", idLabel: "Pixel ID", pattern: /^[A-Z0-9]{10,40}$/i, example: "C4ABCDEF123456789" },
  snapchat: { label: "سناب شات (Snap Pixel)", idLabel: "Pixel ID", pattern: /^[0-9a-f-]{20,40}$/i, example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
  x: { label: "تويتر (X Pixel)", idLabel: "Pixel ID", pattern: /^[a-z0-9]{4,20}$/i, example: "o1abc" },
  linkedin: { label: "لينكد إن (Insight Tag)", idLabel: "Partner ID", pattern: /^\d{4,12}$/, example: "1234567" },
  google: { label: "يوتيوب / Google tag", idLabel: "Tag ID", pattern: /^(G|AW|GT|DC)-[A-Z0-9]{4,20}$/i, example: "AW-123456789" },
} as const;

export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;
export const SOCIAL_PLATFORM_KEYS = Object.keys(SOCIAL_PLATFORMS) as SocialPlatform[];

/** Platforms whose conversion events the server already sends (Meta Conversions API). */
export const DELIVERING_PLATFORMS: SocialPlatform[] = ["facebook"];

/** The cleaned id, or an Arabic error. */
export function cleanPixelId(platform: SocialPlatform, raw: string): string {
  const value = String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .trim();
  const spec = SOCIAL_PLATFORMS[platform];
  if (!spec.pattern.test(value)) throw new Error(`${spec.idLabel} غير صحيح لـ ${spec.label} (مثال: ${spec.example})`);
  return value;
}
