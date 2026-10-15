// One-off: attach files to chat media messages saved without one while the crm-files bucket was
// missing. Only touches messages whose media_url is empty; downloads each file again from the
// WhatsApp server (Evolution) and stores it the same way the webhook does.
//
// Dry run (counts only):  docker compose exec -T app node --input-type=module - < scripts/backfill-chat-media.mjs
// Apply:                  docker compose exec -T -e APPLY=1 app node --input-type=module - < scripts/backfill-chat-media.mjs
//
// Prints counts only: no keys, message text or file contents.

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY } = process.env;
const APPLY = process.env.APPLY === "1";
for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY })) {
  if (!value) throw new Error(`${name} is not set`);
}

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...supabaseHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`database ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

const messages = await rest(
  "msg_messages?select=id,organization_id,session_id,external_id,direction,message_type,media_meta" +
    "&message_type=in.(image,video,audio,document)&media_url=is.null&external_id=not.is.null&order=created_at.asc&limit=2000",
);
const sessionIds = [...new Set(messages.map((m) => m.session_id))];
const sessions = sessionIds.length
  ? await rest(`msg_sessions?select=id,peer_identifier,channel_account_id&id=in.(${sessionIds.join(",")})`)
  : [];
const accountIds = [...new Set(sessions.map((s) => s.channel_account_id).filter(Boolean))];
const accounts = accountIds.length
  ? await rest(`msg_channel_accounts?select=id,external_ref&id=in.(${accountIds.join(",")})`)
  : [];
const sessionById = new Map(sessions.map((s) => [s.id, s]));
const instanceByAccount = new Map(accounts.map((a) => [a.id, a.external_ref]));

console.log(`messages without a file: ${messages.length}${APPLY ? "" : " (dry run, nothing will be changed)"}`);

const counts = { attached: 0, unavailable: 0, failed: 0, skipped: 0 };
for (const message of messages) {
  const session = sessionById.get(message.session_id);
  const instance = session && instanceByAccount.get(session.channel_account_id);
  if (!session || !instance) {
    counts.skipped++;
    continue;
  }
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { apikey: EVOLUTION_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          key: { id: message.external_id, remoteJid: session.peer_identifier, fromMe: message.direction === "outbound" },
        },
        convertToMp4: false,
      }),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    const base64 = body?.base64 ?? body?.data?.base64;
    if (!base64) {
      counts.unavailable++;
      continue;
    }
    if (!APPLY) {
      counts.attached++;
      continue;
    }
    const buffer = Buffer.from(base64, "base64");
    const mime = body.mimetype ?? "application/octet-stream";
    const safeName =
      String(body.fileName ?? `file-${message.external_id}`).replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
    const path = `chat-media/${message.organization_id}/${message.session_id}/${Date.now()}-${safeName}`;
    const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/crm-files/${path}`, {
      method: "POST",
      headers: { ...supabaseHeaders, "Content-Type": mime, "x-upsert": "false" },
      body: buffer,
    });
    if (!upload.ok) throw new Error(`storage ${upload.status}`);
    // Only fills messages that still have no file, so a re-run never overwrites anything.
    await rest(`msg_messages?id=eq.${message.id}&media_url=is.null`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        media_url: `crm-files/${path}`,
        media_meta: { ...(message.media_meta ?? {}), file_name: safeName, mime_type: mime, size: buffer.length },
      }),
    });
    counts.attached++;
  } catch (error) {
    counts.failed++;
    console.log(`failed: ${error instanceof Error ? error.message : "error"}`);
  }
}

console.log(
  `${APPLY ? "attached" : "would attach"}: ${counts.attached}, no longer on WhatsApp server: ${counts.unavailable}, ` +
    `failed: ${counts.failed}, skipped (number removed): ${counts.skipped}`,
);
