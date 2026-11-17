// Instagram channel logic over the database. The database client and every network call come in as
// arguments, so the same code runs against the real services and against test doubles.
// Every query below is tied to an organization: a message or an account of one organization is never
// read or written under another.
import {
  INSTAGRAM_CHANNEL_TYPE,
  INSTAGRAM_PROVIDER_ID,
  LINK_STATE_TTL_MS,
  WINDOW_CLOSED_MESSAGE,
  buildAuthorizeUrl,
  canRefreshToken,
  cleanAuthCode,
  messagingWindow,
  newLinkState,
  previewFor,
  splitForInstagram,
  tokenState,
  type InstagramInboundEvent,
} from "./instagram-core";

type Db = any;

export type InstagramDeps = {
  now: () => Date;
  seal: (plain: string) => Promise<string>;
  open: (cipher: string) => Promise<string>;
  exchangeCode: (code: string, redirectUri: string) => Promise<{ accessToken: string; userId: string }>;
  longLivedToken: (shortToken: string) => Promise<{ accessToken: string; expiresIn: number }>;
  refreshToken: (token: string) => Promise<{ accessToken: string; expiresIn: number }>;
  fetchProfile: (token: string) => Promise<{ userId: string | null; username: string | null }>;
  subscribe: (igUserId: string, token: string) => Promise<void>;
  sendMessage: (igUserId: string, token: string, to: string, text: string) => Promise<{ messageId: string | null }>;
  /** Best effort: the customer's name, if Instagram gives it. */
  customerProfile?: (token: string, customerId: string) => Promise<{ name: string | null; username: string | null }>;
  /** Best effort: copies a photo from Instagram's temporary link into our storage; returns its path. */
  storeImage?: (organizationId: string, sessionId: string, url: string) => Promise<string | null>;
};

/** What a person may see about a linked account. The token is never in this list. */
export const INSTAGRAM_PUBLIC_COLUMNS = "channel_account_id, ig_user_id, username, status, token_expires_at, last_error, created_at";

const fail = (message: string): never => {
  throw new Error(message);
};

// ── Linking ────────────────────────────────────────────────────────────────

export async function startInstagramLink(
  db: Db,
  deps: Pick<InstagramDeps, "now">,
  input: { organizationId: string; userId: string; appId: string; redirectUri: string },
) {
  const state = newLinkState();
  const now = deps.now();
  const { error } = await db.from("channel_oauth_states").insert({
    state,
    organization_id: input.organizationId,
    user_id: input.userId,
    channel: INSTAGRAM_CHANNEL_TYPE,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + LINK_STATE_TTL_MS).toISOString(),
  });
  if (error) fail("تعذر بدء الربط، أعد المحاولة");
  return { url: buildAuthorizeUrl({ appId: input.appId, redirectUri: input.redirectUri, state }) };
}

async function ensureInstagramChannel(db: Db, organizationId: string): Promise<string> {
  const { data: existing } = await db
    .from("msg_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("channel_type", INSTAGRAM_CHANNEL_TYPE)
    .eq("provider", INSTAGRAM_PROVIDER_ID)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created, error } = await db
    .from("msg_channels")
    .insert({
      organization_id: organizationId,
      channel_type: INSTAGRAM_CHANNEL_TYPE,
      provider: INSTAGRAM_PROVIDER_ID,
      name: "Instagram",
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !created) fail("تعذر تجهيز قناة إنستغرام");
  return created.id;
}

export const ALREADY_LINKED_MESSAGE = "هذا الحساب في إنستغرام مربوط بحساب آخر على المنصة. افصله هناك أولاً ثم اربطه.";

/** Finishes the link when Instagram sends the person back with a code. */
export async function finishInstagramLink(
  db: Db,
  deps: InstagramDeps,
  input: { organizationId: string; userId: string; code: string; state: string; redirectUri: string },
) {
  const now = deps.now();
  const { data: row } = await db.from("channel_oauth_states").select("*").eq("state", input.state).maybeSingle();
  const stateOk =
    row &&
    row.organization_id === input.organizationId &&
    row.user_id === input.userId &&
    row.channel === INSTAGRAM_CHANNEL_TYPE &&
    !row.used_at &&
    new Date(row.expires_at).getTime() > now.getTime();
  if (!stateOk) fail("انتهت صلاحية طلب الربط أو لا يخصك. اضغط «ربط» من جديد.");
  // The state works once: claiming it first means a repeated return cannot link twice.
  const { data: claimed } = await db
    .from("channel_oauth_states")
    .update({ used_at: now.toISOString() })
    .eq("state", input.state)
    .is("used_at", null)
    .select("state");
  if (!claimed?.length) fail("تم استخدام طلب الربط هذا من قبل. اضغط «ربط» من جديد.");

  const short = await deps.exchangeCode(cleanAuthCode(input.code), input.redirectUri);
  const long = await deps.longLivedToken(short.accessToken);
  const profile = await deps.fetchProfile(long.accessToken);
  // The account id in webhook notifications is the professional account id (/me → user_id).
  const igUserId = profile.userId || short.userId;
  if (!igUserId) fail("لم يرجع إنستغرام معرّف الحساب");
  const username = profile.username;
  const expiresAt = new Date(now.getTime() + long.expiresIn * 1000).toISOString();
  const cipher = await deps.seal(long.accessToken);

  const { data: existing } = await db.from("plugin_instagram_accounts").select("*").eq("ig_user_id", igUserId).maybeSingle();
  if (existing && existing.organization_id !== input.organizationId) fail(ALREADY_LINKED_MESSAGE);

  if (existing) {
    // The same organization links it again (the token had died, or it was disconnected): same account, fresh token.
    await db
      .from("plugin_instagram_accounts")
      .update({
        username,
        access_token_cipher: cipher,
        token_expires_at: expiresAt,
        token_refreshed_at: now.toISOString(),
        status: "connected",
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("ig_user_id", igUserId)
      .eq("organization_id", input.organizationId);
    await db
      .from("msg_channel_accounts")
      .update({ status: "connected", display_name: username ? `@${username}` : igUserId })
      .eq("id", existing.channel_account_id)
      .eq("organization_id", input.organizationId);
    const warning = await subscribeQuietly(db, deps, input.organizationId, igUserId, long.accessToken);
    return { accountId: existing.channel_account_id as string, username, relinked: true, warning };
  }

  const channelId = await ensureInstagramChannel(db, input.organizationId);
  const { data: account, error: accountError } = await db
    .from("msg_channel_accounts")
    .insert({
      organization_id: input.organizationId,
      channel_id: channelId,
      owner_user_id: input.userId,
      display_name: username ? `@${username}` : igUserId,
      identifier: username ?? igUserId,
      external_ref: igUserId,
      status: "connected",
      provider_meta: { provider: INSTAGRAM_PROVIDER_ID, ig_user_id: igUserId },
    })
    .select("id")
    .single();
  if (accountError || !account) fail("تعذر إنشاء حساب القناة");
  const { error: pluginError } = await db.from("plugin_instagram_accounts").insert({
    organization_id: input.organizationId,
    channel_account_id: account.id,
    ig_user_id: igUserId,
    username,
    access_token_cipher: cipher,
    token_expires_at: expiresAt,
    token_refreshed_at: now.toISOString(),
    status: "connected",
  });
  if (pluginError) {
    // Two people linking the same account at once: the unique index let one win; undo this half.
    await db.from("msg_channel_accounts").delete().eq("id", account.id).eq("organization_id", input.organizationId);
    fail(ALREADY_LINKED_MESSAGE);
  }
  const warning = await subscribeQuietly(db, deps, input.organizationId, igUserId, long.accessToken);
  return { accountId: account.id as string, username, relinked: false, warning };
}

/** Subscribes the account to message notifications; a failure is reported, not fatal. */
async function subscribeQuietly(db: Db, deps: InstagramDeps, organizationId: string, igUserId: string, token: string) {
  try {
    await deps.subscribe(igUserId, token);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل الاشتراك";
    await db
      .from("plugin_instagram_accounts")
      .update({ last_error: `webhook_subscription_failed: ${message}`.slice(0, 500) })
      .eq("ig_user_id", igUserId)
      .eq("organization_id", organizationId);
    return "تم الربط لكن تعذر تفعيل استقبال الرسائل. أعد الربط أو تواصل مع الدعم.";
  }
}

export async function disconnectInstagram(db: Db, input: { organizationId: string; accountId: string }) {
  const { data } = await db
    .from("plugin_instagram_accounts")
    .update({ status: "disconnected", access_token_cipher: null, token_expires_at: null })
    .eq("channel_account_id", input.accountId)
    .eq("organization_id", input.organizationId)
    .select("ig_user_id");
  if (!data?.length) fail("الحساب غير موجود");
  await db
    .from("msg_channel_accounts")
    .update({ status: "disconnected" })
    .eq("id", input.accountId)
    .eq("organization_id", input.organizationId);
  return { ok: true };
}

// ── Receiving ──────────────────────────────────────────────────────────────

export type InboundHooks = {
  /** Called for a customer's message, so the chat gets its deal (the same step WhatsApp chats use). */
  onInbound?: (ctx: {
    organizationId: string;
    accountId: string;
    ownerUserId: string | null;
    customerId: string;
    sessionId: string;
    fromMe: boolean;
  }) => Promise<void>;
};

/** Stores notifications from Instagram, each under the organization that owns the account. */
export async function handleInstagramEvents(db: Db, deps: InstagramDeps, events: InstagramInboundEvent[], hooks: InboundHooks = {}) {
  let stored = 0;
  for (const event of events) {
    try {
      if (await storeEvent(db, deps, event, hooks)) stored++;
    } catch (error) {
      console.error("[INSTAGRAM_WEBHOOK] event failed", error instanceof Error ? error.message : error);
    }
  }
  return { stored };
}

async function storeEvent(db: Db, deps: InstagramDeps, event: InstagramInboundEvent, hooks: InboundHooks): Promise<boolean> {
  const { data: link } = await db
    .from("plugin_instagram_accounts")
    .select("organization_id, channel_account_id, access_token_cipher, status")
    .eq("ig_user_id", event.igUserId)
    .maybeSingle();
  if (!link || link.status === "disconnected") return false;
  const organizationId: string = link.organization_id;
  const { data: account } = await db
    .from("msg_channel_accounts")
    .select("id, owner_user_id")
    .eq("id", link.channel_account_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!account) return false;
  const accountId: string = account.id;
  const ownerUserId: string | null = account.owner_user_id ?? null;
  const fromMe = event.isEcho;

  // A session for this person on this account, if there is one already.
  const { data: existingSession } = await db
    .from("msg_sessions")
    .select("id, unread_count")
    .eq("organization_id", organizationId)
    .eq("channel_account_id", accountId)
    .eq("peer_identifier", event.customerId)
    .maybeSingle();

  if (existingSession?.id) {
    const { data: duplicate } = await db
      .from("msg_messages")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("session_id", existingSession.id)
      .eq("external_id", event.mid)
      .limit(1);
    if (duplicate?.length) return false;
  } else {
    // An echo of something we sent a person who never wrote to us is not a conversation to open.
    // (Replies are only possible after the person writes, so this is rare.)
  }

  const preview = previewFor(event);
  let isNewContact = false;
  const { data: point } = await db
    .from("crm_contact_points")
    .select("contact_id")
    .eq("organization_id", organizationId)
    .eq("channel_type", INSTAGRAM_CHANNEL_TYPE)
    .eq("identifier", event.customerId)
    .maybeSingle();
  if (!point?.contact_id) {
    const { data: contact } = await db
      .from("crm_contacts")
      .insert({ organization_id: organizationId, display_name: null, full_name: null, lifecycle_stage: "lead", last_activity_at: event.at })
      .select()
      .single();
    if (contact) {
      isNewContact = true;
      await db.from("crm_contact_points").insert({
        organization_id: organizationId,
        contact_id: contact.id,
        channel_type: INSTAGRAM_CHANNEL_TYPE,
        identifier: event.customerId,
        is_primary: true,
        verified: true,
      });
    }
  } else if (!fromMe) {
    await db
      .from("crm_contacts")
      .update({ last_activity_at: event.at })
      .eq("id", point.contact_id)
      .eq("organization_id", organizationId);
  }

  let sessionId: string;
  if (existingSession?.id) {
    sessionId = existingSession.id;
    await db
      .from("msg_sessions")
      .update({
        last_message_preview: preview,
        last_message_at: event.at,
        ...(fromMe ? {} : { unread_count: (existingSession.unread_count ?? 0) + 1 }),
      })
      .eq("id", sessionId)
      .eq("organization_id", organizationId);
  } else {
    const { data: created, error } = await db
      .from("msg_sessions")
      .insert({
        organization_id: organizationId,
        channel_account_id: accountId,
        external_thread_id: event.customerId,
        peer_identifier: event.customerId,
        last_message_preview: preview,
        last_message_at: event.at,
        unread_count: fromMe ? 0 : 1,
      })
      .select()
      .single();
    if (error || !created) return false;
    sessionId = created.id;
  }

  const image = event.attachments.find((a) => a.type === "image" && a.url);
  let mediaPath: string | null = null;
  if (image?.url && deps.storeImage) {
    mediaPath = await deps.storeImage(organizationId, sessionId, image.url).catch(() => null);
  }
  await db.from("msg_messages").insert({
    organization_id: organizationId,
    session_id: sessionId,
    external_id: event.mid,
    direction: fromMe ? "outbound" : "inbound",
    message_type: mediaPath ? "image" : "text",
    content: event.text || (mediaPath ? null : preview) || null,
    media_url: mediaPath,
    media_meta: { channel: INSTAGRAM_CHANNEL_TYPE, attachments: event.attachments.map((a) => a.type) },
    status: fromMe ? "sent" : "received",
    created_at: event.at,
  });
  await db
    .from("msg_channel_accounts")
    .update({ last_webhook_at: deps.now().toISOString(), ...(fromMe ? {} : { last_inbound_at: event.at }) })
    .eq("id", accountId)
    .eq("organization_id", organizationId);
  await db.from("domain_events").insert({
    organization_id: organizationId,
    event_type: fromMe ? "messaging.message.sent" : "messaging.message.received",
    aggregate_type: "msg_session",
    aggregate_id: sessionId,
    payload: { session_id: sessionId, channel: INSTAGRAM_CHANNEL_TYPE, provider: INSTAGRAM_PROVIDER_ID, peer: event.customerId, text: event.text.slice(0, 1000), external_id: event.mid },
  });

  if (hooks.onInbound) {
    await hooks.onInbound({ organizationId, accountId, ownerUserId, customerId: event.customerId, sessionId, fromMe }).catch((error) =>
      console.error("[INSTAGRAM_WEBHOOK] deal step failed", error instanceof Error ? error.message : error),
    );
  }

  // The customer's name, once, for a person we have just met. Never blocks or fails the message.
  if (isNewContact && !fromMe && deps.customerProfile && link.access_token_cipher) {
    try {
      const token = await deps.open(link.access_token_cipher);
      const profile = await deps.customerProfile(token, event.customerId);
      const name = profile.name || profile.username;
      if (name) {
        const { data: cp } = await db
          .from("crm_contact_points")
          .select("contact_id")
          .eq("organization_id", organizationId)
          .eq("channel_type", INSTAGRAM_CHANNEL_TYPE)
          .eq("identifier", event.customerId)
          .maybeSingle();
        if (cp?.contact_id) {
          await db.from("crm_contacts").update({ display_name: name, full_name: name }).eq("id", cp.contact_id).eq("organization_id", organizationId).is("display_name", null);
        }
        await db.from("msg_sessions").update({ push_name: name }).eq("id", sessionId).eq("organization_id", organizationId);
      }
    } catch {
      /* the name is a nicety */
    }
  }
  return true;
}

// ── Sending ────────────────────────────────────────────────────────────────

export async function sendInstagramText(db: Db, deps: InstagramDeps, input: { igUserId: string; to: string; text: string }) {
  const { data: link } = await db
    .from("plugin_instagram_accounts")
    .select("organization_id, channel_account_id, access_token_cipher, status, token_expires_at")
    .eq("ig_user_id", input.igUserId)
    .maybeSingle();
  if (!link) fail("حساب إنستغرام غير موجود");
  if (link.status !== "connected" || !link.access_token_cipher || tokenState(link.token_expires_at, deps.now()) === "expired") {
    fail("انتهى ربط حساب إنستغرام. أعد ربطه من «الجلسات».");
  }

  // Replies are allowed only within 24 hours of the customer's last message.
  const { data: session } = await db
    .from("msg_sessions")
    .select("id")
    .eq("organization_id", link.organization_id)
    .eq("channel_account_id", link.channel_account_id)
    .eq("peer_identifier", input.to)
    .maybeSingle();
  let lastInbound: string | null = null;
  if (session?.id) {
    const { data: rows } = await db
      .from("msg_messages")
      .select("created_at")
      .eq("organization_id", link.organization_id)
      .eq("session_id", session.id)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(20);
    for (const row of rows ?? []) if (!lastInbound || row.created_at > lastInbound) lastInbound = row.created_at;
  }
  if (!messagingWindow(lastInbound, deps.now()).open) fail(WINDOW_CLOSED_MESSAGE);

  const token = await deps.open(link.access_token_cipher);
  let firstId: string | null = null;
  for (const part of splitForInstagram(input.text)) {
    const sent = await deps.sendMessage(input.igUserId, token, input.to, part);
    firstId ??= sent.messageId;
  }
  return { externalId: firstId };
}

/** The window state of a chat, for the composer to show before anyone types. */
export async function instagramWindowForSession(db: Db, deps: Pick<InstagramDeps, "now">, input: { organizationId: string; sessionId: string }) {
  const { data: rows } = await db
    .from("msg_messages")
    .select("created_at")
    .eq("organization_id", input.organizationId)
    .eq("session_id", input.sessionId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(20);
  let last: string | null = null;
  for (const row of rows ?? []) if (!last || row.created_at > last) last = row.created_at;
  const window = messagingWindow(last, deps.now());
  return { open: window.open, expiresAt: window.expiresAt?.toISOString() ?? null };
}

// ── Keeping tokens alive ───────────────────────────────────────────────────

/** Renews tokens in their last week, and marks dead ones so the owner is asked to link again. */
export async function refreshDueTokens(db: Db, deps: InstagramDeps) {
  const now = deps.now();
  const { data: rows } = await db
    .from("plugin_instagram_accounts")
    .select("organization_id, ig_user_id, access_token_cipher, token_expires_at, token_refreshed_at, status")
    .eq("status", "connected");
  const result = { refreshed: 0, expired: 0, failed: 0 };
  for (const row of rows ?? []) {
    const state = tokenState(row.token_expires_at, now);
    if (state === "ok") continue;
    if (state === "expired") {
      await db
        .from("plugin_instagram_accounts")
        .update({ status: "needs_reconnect", last_error: "token_expired" })
        .eq("ig_user_id", row.ig_user_id)
        .eq("organization_id", row.organization_id);
      result.expired++;
      continue;
    }
    if (!row.access_token_cipher || !canRefreshToken(row.token_refreshed_at, row.token_expires_at, now)) continue;
    try {
      const fresh = await deps.refreshToken(await deps.open(row.access_token_cipher));
      await db
        .from("plugin_instagram_accounts")
        .update({
          access_token_cipher: await deps.seal(fresh.accessToken),
          token_expires_at: new Date(now.getTime() + fresh.expiresIn * 1000).toISOString(),
          token_refreshed_at: now.toISOString(),
          last_error: null,
        })
        .eq("ig_user_id", row.ig_user_id)
        .eq("organization_id", row.organization_id);
      result.refreshed++;
    } catch (error) {
      result.failed++;
      await db
        .from("plugin_instagram_accounts")
        .update({ last_error: `refresh_failed: ${error instanceof Error ? error.message : "unknown"}`.slice(0, 500) })
        .eq("ig_user_id", row.ig_user_id)
        .eq("organization_id", row.organization_id);
    }
  }
  return result;
}
