export function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("ar", { timeZone: value });
    return !!value.trim();
  } catch {
    return false;
  }
}
