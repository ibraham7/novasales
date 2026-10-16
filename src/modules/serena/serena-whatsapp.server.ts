// Talking to Serena on WhatsApp: a message from one of the allowed numbers (set in Settings → Serena)
// to any of the company's WhatsApp numbers is answered by Serena instead of entering the CRM as a lead.
import {
  askSerena,
  logTurns,
  loadSettings,
  recentTurns,
  serenaErrors,
  type SerenaSettings,
} from "./serena.server";
import { digitsOnly, phoneAllowed } from "./serena-model";

// Every incoming message checks this, so settings are cached briefly per organization.
const cache = new Map<string, { at: number; settings: SerenaSettings | null }>();
async function cachedSettings(organizationId: string) {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < 60_000) return hit.settings;
  const settings = await loadSettings(organizationId).catch(() => null);
  cache.set(organizationId, { at: Date.now(), settings });
  return settings;
}

type Send = (accountId: string, to: string, text: string) => Promise<unknown>;

/** Returns true when the message was for Serena (and so must not be handled as a customer message). */
export async function handleSerenaWhatsApp(
  input: {
    organizationId: string;
    accountId: string;
    phone: string;
    text: string;
    externalId: string | null;
  },
  send?: Send,
): Promise<boolean> {
  const settings = await cachedSettings(input.organizationId);
  if (!settings?.whatsappEnabled || !phoneAllowed(input.phone, settings.whatsappNumbers))
    return false;
  const sendText: Send =
    send ??
    (async (accountId, to, text) =>
      (await import("@/modules/channels/whatsapp/channel-ops.server")).opSendText(
        accountId,
        to,
        text,
      ));
  const phone = digitsOnly(input.phone);
  const question = input.text.trim();
  if (!question) {
    await sendText(
      input.accountId,
      phone,
      "أهلًا، أنا سيرينا 👋 أرسل لي سؤالك كتابةً، مثل: شو أكثر بضاعة عليها طلب هالشهر؟",
    );
    return true;
  }
  // The question is logged first with the WhatsApp message id: a redelivered webhook stops here.
  const fresh = await logTurns([
    {
      organization_id: input.organizationId,
      channel: "whatsapp",
      user_ref: phone,
      role: "user",
      content: question,
      external_id: input.externalId,
    },
  ]);
  if (!fresh) return true;
  const history = await recentTurns(input.organizationId, "whatsapp", phone);
  let answer: string;
  try {
    const result = await askSerena(input.organizationId, "whatsapp", history);
    answer = result.ok ? result.text : (serenaErrors[result.error] ?? serenaErrors.provider_failed);
    if (result.ok)
      await logTurns([
        {
          organization_id: input.organizationId,
          channel: "whatsapp",
          user_ref: phone,
          role: "assistant",
          content: answer,
        },
      ]);
  } catch (error) {
    console.error("[SERENA_WA] failed", error);
    answer = serenaErrors.provider_failed;
  }
  // WhatsApp limits a message to 4096 characters; long answers go in parts.
  for (let start = 0; start < answer.length; start += 3500)
    await sendText(input.accountId, phone, answer.slice(start, start + 3500));
  return true;
}
