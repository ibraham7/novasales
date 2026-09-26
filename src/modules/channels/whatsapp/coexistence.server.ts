/**
 * منطق ربط واتساب الرسمي (Coexistence) — خادم فقط.
 * يستقبل رمز التفويض من نافذة Embedded Signup ويكمل الربط كاملاً:
 * توكن → اشتراك الويبهوك → إنشاء حساب القناة في NovaSales.
 */
import {
  codeFingerprint,
  encryptToken,
  exchangeCodeForToken,
  getPhoneInfo,
  isCoexistenceConfigured,
  listSharedWabas,
  listWabaPhoneNumbers,
  metaPublicConfig,
  subscribeApp,
  type CloudPhoneInfo,
} from "./cloud-http";
import { COEXISTENCE_PROVIDER_ID } from "./coexistence.provider";

export function coexistenceWebhookUrl(): string | null {
  const appUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  return appUrl ? `${appUrl}/api/public/meta-webhook` : null;
}

/**
 * إعدادات المنصة المركزية اللازمة لتشغيل نافذة Meta في المتصفح فقط.
 * appId و configId يستخدمهما SDK الرسمي من Meta ولا تُعرض للمستخدم في أي واجهة،
 * وأسرار المنصة (App Secret / Verify Token) لا تخرج من الخادم أبداً.
 */
export function coexistenceSetup() {
  const cfg = metaPublicConfig();
  return {
    configured: isCoexistenceConfigured(),
    appId: cfg.appId,
    configId: cfg.configId,
    graphVersion: cfg.graphVersion,
  };
}

async function ensureCoexistenceChannel(orgId: string): Promise<string> {
  const { supabaseAdmin, WHATSAPP_CHANNEL_ID } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { data: existing } = await db
    .from("msg_channels")
    .select("id")
    .eq("organization_id", orgId)
    .eq("channel_type", "whatsapp")
    .eq("provider", COEXISTENCE_PROVIDER_ID)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created } = await db
    .from("msg_channels")
    .insert({
      organization_id: orgId,
      channel_type: "whatsapp",
      provider: COEXISTENCE_PROVIDER_ID,
      name: "WhatsApp (رسمي)",
      is_active: true,
    })
    .select("id")
    .single();
  return created?.id ?? WHATSAPP_CHANNEL_ID;
}

export type LinkCoexistenceInput = {
  code: string;
  /** رابط الصفحة الفعلي الذي فُتحت منه نافذة Meta — يجب أن يطابق ما استخدمه SDK. */
  redirectUri: string;


  /** وقت استلام الرمز في callback المتصفح، بالمللي ثانية منذ epoch. */
  codeReceivedAt?: number | undefined;
  /** appId الذي هُيئ به Facebook SDK وفتح FB.login (ليس سراً). */
  browserAppId?: string | undefined;
  wabaId?: string | undefined;
  phoneNumberId?: string | undefined;
  displayName?: string | undefined;
};


export type LinkCoexistenceResult = {
  accountId: string;
  phoneNumberId: string;
  wabaId: string;
  phoneNumber: string | null;
  verifiedName: string | null;
};

/**
 * حماية idempotency محلية: رمز التفويض أحادي الاستخدام.
 * إن وصل نفس الرمز مرتين (إعادة إرسال آلي/شبكة) نُعيد نتيجة أو خطأ المحاولة الأولى
 * بدل استهلاك الرمز عند Meta مرة ثانية. الحماية على بصمة الرمز فقط،
 * فأي رمز جديد من نافذة Meta يمرّ عادياً. هذه الخريطة تحمي الطلبات التي تصل
 * إلى Worker isolate الدافئ نفسه فقط، وليست قفلاً موزعاً بين isolates.
 */
const IDEMPOTENCY_TTL_MS = 2 * 60 * 1000;
const inFlightLinks = new Map<string, { at: number; promise: Promise<LinkCoexistenceResult> }>();

function pruneIdempotency() {
  const now = Date.now();
  for (const [k, v] of inFlightLinks) if (now - v.at > IDEMPOTENCY_TTL_MS) inFlightLinks.delete(k);
}

export async function linkCoexistenceNumber(
  userId: string,
  organizationId: string,
  input: LinkCoexistenceInput,
): Promise<LinkCoexistenceResult> {
  pruneIdempotency();
  const codeHash = await codeFingerprint(input.code);
  const cached = inFlightLinks.get(codeHash);
  if (cached) {
    console.warn(`[META_OAUTH] duplicate code reused in same isolate codeHash=${codeHash} — returning first attempt result`);
    return cached.promise;
  }
  const promise = performCoexistenceLink(userId, organizationId, input);
  inFlightLinks.set(codeHash, { at: Date.now(), promise });
  // نمنع رفض غير مُلتقط عند إعادة استخدام النتيجة لاحقاً.
  promise.catch(() => undefined);
  return promise;
}

async function performCoexistenceLink(
  userId: string,
  organizationId: string,
  input: LinkCoexistenceInput,
): Promise<LinkCoexistenceResult> {
  if (!isCoexistenceConfigured()) {
    // لا نكشف أسماء أسرار المنصة للمستخدم النهائي.
    throw new Error("خدمة الربط الرسمي غير متاحة حالياً — تواصل مع إدارة NovaSales.");
  }

  // رمز التفويض مربوط بـ redirect_uri وقت الإصدار — نرسل نفس القيمة حرفياً.
  console.log(`[META_OAUTH] start redirect_uri=${input.redirectUri}`);
  const { token } = await exchangeCodeForToken(input.code, input.redirectUri, {
    codeReceivedAt: input.codeReceivedAt,
    browserAppId: input.browserAppId,
  });
  console.log(`[META_OAUTH] تم قبول الرمز`);



  // 1) تحديد حساب واتساب للأعمال والرقم
  let wabaId = input.wabaId?.trim() || "";
  if (!wabaId) {
    const shared = await listSharedWabas(token);
    wabaId = shared[0] ?? "";
  }
  if (!wabaId) throw new Error("لم نتمكن من قراءة حساب واتساب للأعمال من تفويض Meta — أعد المحاولة.");

  let phone: CloudPhoneInfo | null = null;
  if (input.phoneNumberId) {
    phone = (await getPhoneInfo(input.phoneNumberId, token)) ?? { id: input.phoneNumberId };
  } else {
    const numbers = await listWabaPhoneNumbers(wabaId, token);
    phone = numbers[0] ?? null;
  }
  if (!phone?.id) throw new Error("لا يوجد رقم متاح في حساب واتساب للأعمال بعد — أكمل خطوات Meta ثم أعد المحاولة.");

  // 2) اشتراك تطبيقنا في أحداث الحساب حتى تصل الرسائل (بعد نجاح التوكن، وبفشل آمن)
  const subscribedFields = await subscribeApp(wabaId, token);


  const digits = (phone.display_phone_number ?? "").replace(/\D/g, "") || null;
  const displayName = input.displayName?.trim() || phone.verified_name || (digits ? `+${digits}` : "رقم رسمي");

  const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const channelId = await ensureCoexistenceChannel(organizationId);

  // 3) حساب القناة: خارجي المرجع = phone_number_id (ثابت عند Meta)
  const { data: existingAcc } = await db
    .from("msg_channel_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("external_ref", phone.id)
    .maybeSingle();

  let accountId: string = existingAcc?.id ?? "";
  const accountPayload = {
    organization_id: organizationId,
    channel_id: channelId,
    owner_user_id: userId,
    display_name: displayName,
    identifier: digits ?? phone.id,
    external_ref: phone.id,
    phone_number: digits,
    status: "connected",
    webhook_configured: subscribedFields.length > 0,
    provider_meta: {
      provider: COEXISTENCE_PROVIDER_ID,
      official: true,
      coexistence: true,
      waba_id: wabaId,
      subscribed_fields: subscribedFields,

      verified_name: phone.verified_name ?? null,
      quality_rating: phone.quality_rating ?? null,
      platform_type: phone.platform_type ?? null,
    },
  };

  if (accountId) {
    const { error } = await db.from("msg_channel_accounts").update(accountPayload).eq("id", accountId);
    if (error) throw new Error(error.message);
  } else {
    const { data: acc, error } = await db
      .from("msg_channel_accounts")
      .insert(accountPayload)
      .select("id")
      .single();
    if (error || !acc) throw new Error(error?.message ?? "فشل إنشاء حساب الرقم الرسمي");
    accountId = acc.id;
  }

  // 4) الاعتمادات (توكن مشفّر) — جدول محجوز للخادم فقط
  const cipher = await encryptToken(token);
  const { error: credErr } = await db.from("plugin_whatsapp_cloud_accounts").upsert(
    {
      organization_id: organizationId,
      channel_account_id: accountId,
      waba_id: wabaId,
      phone_number_id: phone.id,
      display_phone_number: digits,
      verified_name: phone.verified_name ?? null,
      quality_rating: phone.quality_rating ?? null,
      is_coexistence: true,
      access_token_cipher: cipher,
      status: "connected",
      last_error: null,
      raw_state: phone as unknown as Record<string, unknown>,
    },
    { onConflict: "phone_number_id" },
  );
  if (credErr) throw new Error(credErr.message);

  return {
    accountId,
    phoneNumberId: phone.id,
    wabaId,
    phoneNumber: digits,
    verifiedName: phone.verified_name ?? null,
  };
}
