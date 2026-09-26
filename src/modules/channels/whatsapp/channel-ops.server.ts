/**
 * طبقة عمليات موحّدة فوق أي محرّك واتساب.
 * كل باقي النظام (messaging, campaigns, workflow) يستدعي هذه الدوال بـaccountId
 * ولا يعرف أي محرّك يعمل تحته. القدرات تُفرض هنا أيضاً (لا على الواجهة فقط).
 */
import { resolveAccountProvider } from "./registry.server";
import { CAPABILITY_LABELS, type CapabilityKey, type MessageKeyRef, type OutboundQuote } from "./provider";

async function noteProviderError(accountId: string, message: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: acc } = await db
      .from("msg_channel_accounts")
      .select("provider_error_count")
      .eq("id", accountId)
      .maybeSingle();
    await db
      .from("msg_channel_accounts")
      .update({
        provider_error_count: (acc?.provider_error_count ?? 0) + 1,
        last_provider_error: message.slice(0, 500),
      })
      .eq("id", accountId);
  } catch {
    /* تسجيل الأخطاء لا يجب أن يُفشل العملية */
  }
}

async function withProvider<T>(
  accountId: string,
  capability: CapabilityKey | null,
  method: string,
  run: (args: { ref: Awaited<ReturnType<typeof resolveAccountProvider>> }) => Promise<T>,
): Promise<T> {
  const ref = await resolveAccountProvider(accountId);
  const supported =
    (capability ? ref.provider.capabilities[capability] : true) &&
    typeof (ref.provider as unknown as Record<string, unknown>)[method] === "function";
  if (!supported) {
    const label = capability ? CAPABILITY_LABELS[capability] : method;
    throw new Error(`${label} غير مدعوم في محرّك ${ref.provider.label}.`);
  }
  try {
    return await run({ ref });
  } catch (e) {
    await noteProviderError(accountId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function opSendText(
  accountId: string,
  to: string,
  text: string,
  quoted?: OutboundQuote,
) {
  return withProvider(accountId, null, "sendText", ({ ref }) =>
    ref.provider.sendText(ref.externalRef, to, text, quoted),
  );
}

export async function opSendMedia(
  accountId: string,
  to: string,
  params: {
    mediatype: "image" | "video" | "document";
    media: string;
    mimetype?: string;
    fileName?: string;
    caption?: string;
    quoted?: OutboundQuote;
  },
) {
  return withProvider(accountId, "supportsMedia", "sendMedia", ({ ref }) =>
    ref.provider.sendMedia!(ref.externalRef, to, params),
  );
}

export async function opSendAudioNote(accountId: string, to: string, audio: string, quoted?: OutboundQuote) {
  return withProvider(accountId, "supportsAudioNote", "sendAudioNote", ({ ref }) =>
    ref.provider.sendAudioNote!(ref.externalRef, to, audio, quoted),
  );
}

export async function opSendReaction(accountId: string, key: MessageKeyRef, emoji: string) {
  return withProvider(accountId, "supportsReactions", "sendReaction", ({ ref }) =>
    ref.provider.sendReaction!(ref.externalRef, key, emoji),
  );
}

export async function opEditMessage(
  accountId: string,
  params: { number: string; text: string; key: MessageKeyRef },
) {
  return withProvider(accountId, "supportsEdit", "editMessage", ({ ref }) =>
    ref.provider.editMessage!(ref.externalRef, params),
  );
}

export async function opDeleteMessage(accountId: string, key: MessageKeyRef) {
  return withProvider(accountId, "supportsDelete", "deleteMessage", ({ ref }) =>
    ref.provider.deleteMessage!(ref.externalRef, key),
  );
}

export async function opMarkRead(accountId: string, keys: MessageKeyRef[]) {
  return withProvider(accountId, "supportsMarkRead", "markRead", ({ ref }) =>
    ref.provider.markRead!(ref.externalRef, keys),
  );
}

export async function opSetTyping(accountId: string, to: string, on: boolean) {
  return withProvider(accountId, "supportsTyping", "setTyping", ({ ref }) =>
    ref.provider.setTyping!(ref.externalRef, to, on),
  );
}

export async function opFetchHistory(accountId: string, peer: string, limit = 100) {
  return withProvider(accountId, "supportsHistory", "fetchHistory", ({ ref }) =>
    ref.provider.fetchHistory!(ref.externalRef, peer, limit),
  );
}

export async function opDownloadMedia(accountId: string, key: MessageKeyRef) {
  return withProvider(accountId, "supportsMedia", "downloadMedia", ({ ref }) =>
    ref.provider.downloadMedia!(ref.externalRef, key),
  );
}

export async function opGetProfilePicture(accountId: string, identifier: string) {
  const ref = await resolveAccountProvider(accountId);
  if (!ref.provider.capabilities.supportsProfilePicture || !ref.provider.getProfilePicture) return null;
  return ref.provider.getProfilePicture(ref.externalRef, identifier).catch(() => null);
}

/** أدوات صامتة (لا ترفع خطأ) للعمليات التجميلية مثل مؤشر الكتابة والقراءة. */
export async function opTryMarkRead(accountId: string, keys: MessageKeyRef[]) {
  return opMarkRead(accountId, keys).catch(() => null);
}
export async function opTrySetTyping(accountId: string, to: string, on: boolean) {
  return opSetTyping(accountId, to, on).catch(() => null);
}
