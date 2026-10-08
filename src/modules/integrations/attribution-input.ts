import { z } from "zod";
const identifier = z
  .string()
  .trim()
  .max(256)
  .regex(/^[A-Za-z0-9._~-]+$/);
export const attributionInput = z
  .object({
    gclid: identifier.optional(),
    gbraid: identifier.optional(),
    wbraid: identifier.optional(),
    fbclid: identifier.optional(),
    ttclid: identifier.optional(),
    sc_click_id: identifier.optional(),
    utm_source: z.string().trim().max(100).optional(),
    utm_medium: z.string().trim().max(100).optional(),
    utm_campaign: z.string().trim().max(200).optional(),
    consent: z.enum(["unknown", "granted", "denied"]).default("unknown"),
  })
  .strict();
