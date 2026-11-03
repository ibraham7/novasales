/**
 * Marketing is limited to a short list of people for now (MARKETING_ALLOWED_EMAILS, comma separated).
 * Empty or missing means nobody: the page stays closed until someone is named.
 */
export function parseAllowedEmails(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: string | undefined | null, raw: string | undefined | null): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return !!e && parseAllowedEmails(raw).has(e);
}
