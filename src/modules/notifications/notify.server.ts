import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWebPush, type VapidKeys } from "./webpush";
import { createNotifier, type NotifyInput } from "./notify-core";

export type { Audience, NotifyInput, NotifyResult } from "./notify-core";

/** VAPID keys from the environment, or null when push is not set up yet. They never leave the server except the public key. */
export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

const notifier = createNotifier({ db: supabaseAdmin as any, send: sendWebPush, vapid: vapidKeys });
export const { notifyUsers, resolveManagerIds, resolveAudienceUserIds } = notifier;

/** For events inside a request: never slows the action down and never breaks it. */
export function notifyInBackground(input: NotifyInput): void {
  void notifyUsers(input).catch((error) => console.error("[push] notification failed", error instanceof Error ? error.message : error));
}
