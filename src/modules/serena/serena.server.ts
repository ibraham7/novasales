// Serena's settings (with the encrypted API key) and the question-answer loop used by the app and WhatsApp.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { GeminiError, runGemini, type GeminiContent } from "./gemini.server";
import { runSerenaTool, serenaTools } from "./tools.server";

const db = supabaseAdmin as any;

export type SerenaSettings = {
  provider: "google";
  model: string | null;
  apiKeyCipher: string | null;
  apiKeyHint: string | null;
  costAttributeId: string | null;
  whatsappEnabled: boolean;
  whatsappNumbers: string[];
};

// ---- API key encryption (AES-GCM) ----------------------------------------------------------

async function cryptoKey() {
  const secret = process.env.SERENA_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("مفتاح التشفير غير مضبوط على الخادم.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`serena:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptKey(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await cryptoKey(),
      new TextEncoder().encode(plain),
    ),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return Buffer.from(packed).toString("base64");
}

export async function decryptKey(packedB64: string) {
  const packed = new Uint8Array(Buffer.from(packedB64, "base64"));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(0, 12) },
    await cryptoKey(),
    packed.slice(12),
  );
  return new TextDecoder().decode(plain);
}

// ---- Settings --------------------------------------------------------------------------------

export async function loadSettings(organizationId: string): Promise<SerenaSettings | null> {
  const { data, error } = await db
    .from("serena_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error("تعذر قراءة إعدادات سيرينا. تأكد من تطبيق آخر تحديث لقاعدة البيانات.");
  if (!data) return null;
  return {
    provider: "google",
    model: data.model,
    apiKeyCipher: data.api_key_cipher,
    apiKeyHint: data.api_key_hint,
    costAttributeId: data.cost_attribute_id,
    whatsappEnabled: data.whatsapp_enabled,
    whatsappNumbers: data.whatsapp_numbers ?? [],
  };
}

export async function saveSettings(
  organizationId: string,
  userId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await db.from("serena_settings").upsert(
    {
      organization_id: organizationId,
      ...patch,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) throw new Error("تعذر حفظ إعدادات سيرينا.");
}

// ---- Asking ----------------------------------------------------------------------------------

function systemPrompt(organizationName: string, channel: "app" | "whatsapp", costKnown: boolean) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Serena (سيرينا), the sales and business assistant inside NovaSales for the company "${organizationName}".
NovaSales is the company's sales system: products and stock, confirmed sales orders, a CRM pipeline, and the WhatsApp chats between the sales team and customers.

Your job: help the owner and managers decide what to buy, stock, promote and fix, using the company's own data. Typical questions: which products are in demand and which are not, how much we earn or lose and on what, what to order for tomorrow, what customers keep asking for that we don't sell, and what to change to grow profit.

How to work:
- Get facts with the tools before answering. Compare periods (the previous period, or before and after a date) when it helps.
- Read customer messages to learn what customers want, ask about, complain about, or could not find (for example a colour or size we don't have). Quote short examples in your own words; never reveal names or numbers.
- Profit: ${costKnown ? "product costs come from the cost property; when costCoveragePercent is below 100 some lines have no cost, so say the profit is partial." : "no cost property is chosen in Serena's settings, so profit cannot be calculated. Say so when asked, and suggest choosing or creating a cost property (Settings → Serena)."}
- Give concrete, numbered recommendations a small team can act on now (what to reorder and roughly how much from the sales pace and stock left, bundles and offers, prices, products to clear out, replies the sales team should use). Tie each one to the number behind it.
- Never invent numbers. Always give concrete suggestions right away, even with little or no data: never answer only "there is not enough data". With little data, say so in one short line, then give the most useful actions anyway (proven sales, stock and offer practices for this kind of business), and mark which points come from the data and which are general advice.
- Answer in the user's language and dialect (usually Arabic). ${channel === "whatsapp" ? "This is WhatsApp: plain text only, no markdown tables or headings, short lines, at most about 1200 characters." : "Use short headings and bullet points; keep it brief."}
- Today is ${today}. Dates are YYYY-MM-DD.`;
}

export type SerenaTurn = { role: "user" | "assistant"; content: string };

export async function askSerena(
  organizationId: string,
  channel: "app" | "whatsapp",
  history: SerenaTurn[],
) {
  const settings = await loadSettings(organizationId);
  if (!settings?.apiKeyCipher || !settings.model)
    return { ok: false as const, error: "not_configured" };
  const [{ data: organization }, apiKey] = await Promise.all([
    db.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    decryptKey(settings.apiKeyCipher),
  ]);
  const contents: GeminiContent[] = history.map((turn) => ({
    role: turn.role === "user" ? "user" : "model",
    parts: [{ text: turn.content }],
  }));
  try {
    const result = await runGemini({
      apiKey,
      model: settings.model,
      system: systemPrompt(organization?.name ?? "", channel, Boolean(settings.costAttributeId)),
      contents,
      tools: serenaTools,
      runTool: (name, args) => runSerenaTool(organizationId, settings.costAttributeId, name, args),
    });
    if (result.blocked) return { ok: false as const, error: "blocked" };
    if (!result.text)
      return { ok: false as const, error: result.tooManySteps ? "too_many_steps" : "empty" };
    return {
      ok: true as const,
      text: result.text,
      used: result.used,
      truncated: Boolean(result.truncated),
    };
  } catch (error) {
    if (error instanceof GeminiError)
      return {
        ok: false as const,
        error:
          error.status === 429
            ? "rate_limited"
            : error.status === 400 || error.status === 403
              ? "bad_key_or_model"
              : "provider_failed",
      };
    throw error;
  }
}

export async function logTurns(
  rows: {
    organization_id: string;
    channel: "app" | "whatsapp";
    user_ref: string;
    role: "user" | "assistant";
    content: string;
    external_id?: string | null;
  }[],
) {
  const { error } = await db
    .from("serena_messages")
    .insert(rows.map((row) => ({ ...row, content: row.content.slice(0, 20000) })));
  return !error;
}

export async function recentTurns(
  organizationId: string,
  channel: "app" | "whatsapp",
  userRef: string,
  limit = 12,
): Promise<SerenaTurn[]> {
  const { data } = await db
    .from("serena_messages")
    .select("role,content,created_at")
    .eq("organization_id", organizationId)
    .eq("channel", channel)
    .eq("user_ref", userRef)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as SerenaTurn[]).reverse().map(({ role, content }) => ({ role, content }));
}

export const serenaErrors: Record<string, string> = {
  not_configured: "سيرينا غير مفعّلة بعد. يضيفها المالك من الإعدادات ← سيرينا.",
  blocked: "اعتذرت سيرينا عن الإجابة على هذا الطلب. جرّب صياغة أخرى.",
  empty: "لم تصل إجابة من سيرينا. أعد المحاولة.",
  too_many_steps: "احتاجت سيرينا خطوات كثيرة. اسأل سؤالًا أكثر تحديدًا.",
  rate_limited: "تم تجاوز حد الاستخدام عند Google مؤقتًا. حاول بعد دقيقة.",
  bad_key_or_model: "مفتاح Google أو الموديل غير صالح. راجع الإعدادات ← سيرينا.",
  provider_failed: "تعذر الاتصال بخدمة Google الآن. أعد المحاولة.",
};
