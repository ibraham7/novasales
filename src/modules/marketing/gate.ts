/**
 * Who sees the marketing page:
 *  1. the role must be allowed to manage campaigns in the organization (owners and supervisors have it; a sales agent only when the
 *     owner gives the role this permission), and
 *  2. if MARKETING_ALLOWED_EMAILS (login emails, comma separated, in the server .env) is filled, the user's email must be in it.
 *     Empty or missing means no restriction by email, so the page is open to everyone from (1). Fill it to narrow marketing to some
 *     people at once, without changing code.
 * Sending and settings keep their own, stricter permissions on the server.
 */
export const MARKETING_PERMISSION = "cmp.campaigns.manage";

export function canOpenMarketing(permissions: readonly string[] | null | undefined, isSuperAdmin: boolean | null | undefined): boolean {
  return isSuperAdmin === true || (permissions ?? []).includes(MARKETING_PERMISSION);
}

export function parseAllowedEmails(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True when the email list does not stand in the way: it is empty (no restriction) or it names this email. */
export function emailRestrictionAllows(email: string | undefined | null, raw: string | undefined | null): boolean {
  const list = parseAllowedEmails(raw);
  if (list.size === 0) return true;
  const e = (email ?? "").trim().toLowerCase();
  return !!e && list.has(e);
}
