const AUTH_STORAGE_PREFIX = "sb-";
const AUTH_STORAGE_SUFFIX = "-auth-token";

export const AUTH_TIMEOUT_MS = 12_000;

export function clearLocalAuthStorage() {
  if (typeof window === "undefined") return;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(AUTH_STORAGE_PREFIX) && key.endsWith(AUTH_STORAGE_SUFFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}

export async function withAuthTimeout<T>(promise: PromiseLike<T>, timeoutMs = AUTH_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("خدمة تسجيل الدخول لا تستجيب حالياً. حاول مرة أخرى بعد لحظات."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}