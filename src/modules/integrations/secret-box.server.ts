/**
 * Encrypts the access tokens of social connections (AES-GCM). The key comes from SOCIAL_TOKEN_KEY,
 * META_APP_SECRET or the server's service key, whichever is set first. Opening tries every key that
 * is set, so adding a better key later does not lock out tokens saved under the one used before.
 */
const keyNames = ["SOCIAL_TOKEN_KEY", "META_APP_SECRET", "SUPABASE_SERVICE_ROLE_KEY"] as const;

async function keys(): Promise<CryptoKey[]> {
  const secrets = keyNames.map((name) => process.env[name]).filter((value): value is string => !!value);
  if (!secrets.length) throw new Error("لا يوجد مفتاح تشفير على الخادم (SOCIAL_TOKEN_KEY أو META_APP_SECRET)");
  return Promise.all(
    secrets.map(async (secret) =>
      crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)), { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]),
    ),
  );
}

export async function sealSecret(plain: string): Promise<string> {
  const [key] = await keys();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return Buffer.from([...iv, ...cipher]).toString("base64");
}

export async function openSecret(packed: string): Promise<string> {
  const bytes = new Uint8Array(Buffer.from(packed, "base64"));
  for (const key of await keys()) {
    try {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
    } catch {
      /* the next key */
    }
  }
  throw new Error("تعذّر فك تشفير الرمز المحفوظ؛ أدخل الرمز من جديد");
}
