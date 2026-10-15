import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const arabicDateTime = new Intl.DateTimeFormat("ar-u-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Date and time for Arabic screens, e.g. "28 سبتمبر 2026، 5:41 م". The month is a word, so there are
 * no slashes for right-to-left text to reorder (toLocaleString("ar") showed "2026/9/28" jumbled).
 */
export function formatDateTime(value: string | number | Date) {
  return arabicDateTime.format(new Date(value));
}
