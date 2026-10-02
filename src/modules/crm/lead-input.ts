import { z } from "@/lib/validation";
import { normalizeLeadPhone } from "./lead-data";
export const LeadStatus = z.enum([
  "new",
  "working",
  "qualified",
  "unqualified",
  "converted",
  "lost",
]);
const phone = z
  .string()
  .trim()
  .max(50)
  .transform((v, ctx) => {
    if (!v) return "";
    try {
      return normalizeLeadPhone(v);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
      return z.NEVER;
    }
  });
export const leadCreateSchema = z
  .object({
    contactId: z.string().uuid().optional(),
    contactName: z.string().trim().min(1, "اسم العميل إلزامي").max(200).optional(),
    phone: phone.optional(),
    email: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
    departmentId: z.string().uuid().nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    source: z.string().trim().max(100).optional(),
    status: LeadStatus.default("new"),
    notes: z.string().trim().max(2000).optional(),
    customFields: z.record(z.unknown()).optional(),
  })
  .refine((v) => !!v.contactId || !!v.contactName, "اسم العميل إلزامي")
  .refine((v) => v.status !== "converted", "استخدم تحويل إلى فرصة لتغيير الحالة إلى محوّل");
export const leadUpdateSchema = z.object({
  leadId: z.string().uuid(),
  contactName: z.string().trim().min(1, "اسم العميل إلزامي").max(200).optional(),
  phone: phone.optional(),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
  status: LeadStatus.optional(),
  departmentId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  source: z.string().trim().max(100).nullable().optional(),
  score: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});
