export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parses `ALLOWED_EMAILS`: comma- or whitespace-separated, case-insensitive. */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

export function isAllowlisted(allowlist: readonly string[], email: string | undefined): boolean {
  if (!email) return false;
  return allowlist.includes(normalizeEmail(email));
}
