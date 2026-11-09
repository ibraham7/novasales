import { toast as originalToast } from "sonner";
import { arabicError } from "@/lib/validation";
import { errorDetailsAllowed, explainError } from "@/lib/explain-error";

type ErrorOptions = Parameters<typeof originalToast.error>[1];

/** Shows the friendly explanation; people who manage the organization also get the exact reason, with a copy button. */
function showError(message: Parameters<typeof originalToast.error>[0], options?: ErrorOptions) {
  if (typeof message !== "string") return originalToast.error(message, options);
  const friendly = arabicError(message);
  const detail = errorDetailsAllowed() ? explainError(message).technical : null;
  if (!detail || detail === friendly) return originalToast.error(friendly, options);
  return originalToast.error(friendly, {
    duration: 15000,
    description: detail,
    action: { label: "نسخ", onClick: () => void navigator.clipboard?.writeText(`${friendly}\n${detail}`) },
    ...options,
  });
}

export const toast = Object.assign((...args: Parameters<typeof originalToast>) => originalToast(...args), originalToast, {
  error: showError,
});
