import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { createRateLimiter } from "@/modules/notifications/rate-limit";

const limiter = createRateLimiter(10, 60_000);
const tokenSchema = z.object({ token: z.string().trim().min(20).max(40).regex(/^[\w-]+$/) });

/** Public (no login): the page a recipient reaches from the stop link in a message. Reading it changes nothing. */
export const getStopLink = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: rows } = await db.from("cmp_recipients").select("organization_id").eq("stop_token", data.token).limit(1);
    let organizationId = rows?.[0]?.organization_id;
    if (!organizationId) {
      // An email's unsubscribe link (the table does not exist before the email migration).
      const { data: mails } = await db.from("ob_email_messages").select("organization_id").eq("stop_token", data.token).limit(1);
      organizationId = mails?.[0]?.organization_id;
    }
    if (!organizationId) return { valid: false as const };
    const { data: org } = await db.from("organizations").select("name").eq("id", organizationId).maybeSingle();
    return { valid: true as const, sender: (org?.name as string | undefined) ?? "" };
  });

/** Public: the recipient confirms. Their number goes on the do-not-send list. */
export const confirmStopLink = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    if (!limiter.allow(data.token)) throw new Error("محاولات كثيرة؛ انتظر قليلاً");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { handleStopLink } = await import("./outbound-core");
    const { handleEmailStop } = await import("./email-core");
    const db = supabaseAdmin as any;
    const whatsapp = await handleStopLink(db, data.token);
    return whatsapp.ok ? whatsapp : handleEmailStop(db, data.token);
  });
