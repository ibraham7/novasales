import { toast as originalToast } from "sonner";
import { arabicError } from "@/lib/validation";
export const toast = Object.assign((...args: Parameters<typeof originalToast>) => originalToast(...args), originalToast, {
  error: (message: Parameters<typeof originalToast.error>[0], options?: Parameters<typeof originalToast.error>[1]) =>
    originalToast.error(typeof message === "string" ? arabicError(message) : message, options),
});
