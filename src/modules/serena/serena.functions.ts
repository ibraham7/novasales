import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

// Serena: settings for the owner, and the chat used inside the app.
const SETTINGS_PERMISSIONS = ["org.manage"];
const CHAT_PERMISSIONS = ["reports.view", "org.manage"];

export const getSerenaSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { loadSettings } = await import("./serena.server");
  const { organizationId } = await requireAnyPermission(SETTINGS_PERMISSIONS);
  const settings = await loadSettings(organizationId);
  // Money properties that can hold the purchase cost.
  const { data: properties } = await (supabaseAdmin as any)
    .from("sales_product_attributes")
    .select("id,name,scope,is_price_floor")
    .eq("organization_id", organizationId)
    .eq("kind", "money")
    .order("name");
  return {
    provider: "google" as const,
    model: settings?.model ?? null,
    apiKeyHint: settings?.apiKeyHint ?? null,
    costAttributeId: settings?.costAttributeId ?? null,
    whatsappEnabled: settings?.whatsappEnabled ?? false,
    whatsappNumbers: settings?.whatsappNumbers ?? [],
    moneyProperties: (properties ?? []) as {
      id: string;
      name: string;
      scope: string;
      is_price_floor: boolean;
    }[],
  };
});

/** Lists the chat models the key can use; with no key in the request, the saved key is used. */
export const listSerenaModels = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ apiKey: z.string().trim().max(200).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { loadSettings, decryptKey } = await import("./serena.server");
    const { listGeminiModels, GeminiError } = await import("./gemini.server");
    const { chatModels } = await import("./serena-model");
    const { organizationId } = await requireAnyPermission(SETTINGS_PERMISSIONS);
    let apiKey = data.apiKey;
    if (!apiKey) {
      const settings = await loadSettings(organizationId);
      if (!settings?.apiKeyCipher) throw new Error("أدخل مفتاح Google أولًا.");
      apiKey = await decryptKey(settings.apiKeyCipher);
    }
    try {
      return { models: chatModels(await listGeminiModels(apiKey)) };
    } catch (error) {
      if (error instanceof GeminiError)
        throw new Error(
          error.status === 400 || error.status === 403
            ? "مفتاح Google غير صحيح أو غير مفعّل."
            : "تعذر الاتصال بـ Google. أعد المحاولة.",
        );
      throw error;
    }
  });

export const saveSerenaSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        apiKey: z.string().trim().min(20).max(200).optional(),
        model: z
          .string()
          .trim()
          .regex(/^[\w.-]{3,120}$/),
        costAttributeId: z.string().uuid().nullable(),
        whatsappEnabled: z.boolean(),
        whatsappNumbers: z.array(z.string().trim().max(30)).max(10),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadSettings, saveSettings, encryptKey } = await import("./serena.server");
    const { digitsOnly, keyHint } = await import("./serena-model");
    const { organizationId, userId } = await requireAnyPermission(SETTINGS_PERMISSIONS);
    const existing = await loadSettings(organizationId);
    if (!data.apiKey && !existing?.apiKeyCipher) throw new Error("أدخل مفتاح Google.");
    if (data.costAttributeId) {
      const { data: property } = await (supabaseAdmin as any)
        .from("sales_product_attributes")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("id", data.costAttributeId)
        .eq("kind", "money")
        .maybeSingle();
      if (!property) throw new Error("خاصية سعر التكلفة غير موجودة.");
    }
    const numbers = [
      ...new Set(
        data.whatsappNumbers
          .map(digitsOnly)
          .filter((number) => number.length >= 9 && number.length <= 15),
      ),
    ];
    if (data.whatsappEnabled && !numbers.length)
      throw new Error("أضف رقم واتساب واحدًا على الأقل يُسمح له بمحادثة سيرينا.");
    await saveSettings(organizationId, userId, {
      provider: "google",
      model: data.model,
      ...(data.apiKey
        ? { api_key_cipher: await encryptKey(data.apiKey), api_key_hint: keyHint(data.apiKey) }
        : {}),
      cost_attribute_id: data.costAttributeId,
      whatsapp_enabled: data.whatsappEnabled,
      whatsapp_numbers: numbers,
    });
    return { ok: true };
  });

export const askSerenaFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ question: z.string().trim().min(1).max(4000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { askSerena, logTurns, recentTurns, serenaErrors } = await import("./serena.server");
    const { organizationId, userId } = await requireAnyPermission(CHAT_PERMISSIONS);
    const history = await recentTurns(organizationId, "app", userId);
    const result = await askSerena(organizationId, "app", [
      ...history,
      { role: "user", content: data.question },
    ]);
    if (!result.ok)
      return {
        ok: false as const,
        error: serenaErrors[result.error] ?? serenaErrors.provider_failed,
      };
    await logTurns([
      {
        organization_id: organizationId,
        channel: "app",
        user_ref: userId,
        role: "user",
        content: data.question,
      },
      {
        organization_id: organizationId,
        channel: "app",
        user_ref: userId,
        role: "assistant",
        content: result.text,
      },
    ]);
    return { ok: true as const, answer: result.text };
  });

export const getSerenaHistory = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { recentTurns } = await import("./serena.server");
  const { organizationId, userId } = await requireAnyPermission(CHAT_PERMISSIONS);
  return { turns: await recentTurns(organizationId, "app", userId, 40) };
});

/** Starts a fresh conversation: older turns stay in the log but are no longer sent to the model. */
export const clearSerenaHistory = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { organizationId, userId } = await requireAnyPermission(CHAT_PERMISSIONS);
  await (supabaseAdmin as any)
    .from("serena_messages")
    .update({ user_ref: `${userId}:archived` })
    .eq("organization_id", organizationId)
    .eq("channel", "app")
    .eq("user_ref", userId);
  return { ok: true };
});
