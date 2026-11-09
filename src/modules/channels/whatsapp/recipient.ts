/**
 * Where to send to a chat. A normal chat is answered at its phone number. A chat whose customer
 * reached us from a hidden WhatsApp id (…@lid, which holds no phone number) must be answered at that
 * full id; sending to its digits alone makes WhatsApp reject the message (HTTP 400 «Bad Request»).
 */
export function sendTarget(peer: unknown): string {
  const id = String(peer ?? "").trim();
  if (/@lid$/i.test(id)) return id;
  return id.split("@")[0] ?? "";
}
