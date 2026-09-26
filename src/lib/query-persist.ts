import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

const KEY = "novasales-query-cache";
const MAX_AGE = 24 * 60 * 60 * 1000;
const SKIP_KEYS = new Set(["my-permissions", "is-admin", "my-access", "my-owned-accounts"]);

/**
 * Lightweight offline-first cache persistence: restores the last known query
 * results from localStorage on boot (so pages render instantly on slow/broken
 * networks) and saves them back, throttled.
 */
export function setupQueryPersistence(queryClient: QueryClient) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __nsQueryPersist?: boolean };
  if (w.__nsQueryPersist) return;
  w.__nsQueryPersist = true;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { at: number; state: unknown };
      if (parsed?.at && Date.now() - parsed.at < MAX_AGE) {
        hydrate(queryClient, parsed.state);
      } else {
        window.localStorage.removeItem(KEY);
      }
    }
  } catch {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        const state = dehydrate(queryClient, {
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            !SKIP_KEYS.has(String(query.queryKey?.[0] ?? "")),
          shouldDehydrateMutation: () => false,
        });
        window.localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), state }));
      } catch {
        /* storage full / unavailable — cache stays in memory only */
      }
    }, 1500);
  };

  queryClient.getQueryCache().subscribe(save);
}

export function clearPersistedQueries() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
