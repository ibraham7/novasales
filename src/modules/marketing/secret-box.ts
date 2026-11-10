/** Encrypts mailbox passwords before they reach the database (AES-256-GCM). The key lives only in the server environment. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const keyFrom = (secret: string) => createHash("sha256").update(secret).digest();

export function sealSecret(plain: string, secret: string): string {
  if (!secret || secret.length < 16) throw new Error("مفتاح التشفير (MAILBOX_ENCRYPTION_KEY) غير مضبوط على الخادم");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function openSecret(sealed: string, secret: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("كلمة سر الصندوق تالفة؛ أعد حفظ الصندوق");
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("تعذر فك تشفير كلمة سر الصندوق؛ أعد حفظ الصندوق");
  }
}
