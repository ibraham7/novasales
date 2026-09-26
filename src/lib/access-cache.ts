const KEY = "novasales-access-cache";
const MAX_AGE = 10 * 60 * 1000;

export interface AccessSnapshot {
  userId: string;
  permissions: string[];
  isSuperAdmin: boolean;
  at: number;
}

/** Last verified permissions for a specific user (fail-closed when absent). */
export function readAccessCache(userId: string | null): AccessSnapshot | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as AccessSnapshot;
    if (snap.userId !== userId) return null;
    if (!snap.at || Date.now() - snap.at > MAX_AGE) return null;
    return snap;
  } catch {
    return null;
  }
}

export function writeAccessCache(snap: Omit<AccessSnapshot, "at">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...snap, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function clearAccessCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
