/**
 * How a campaign run sends: the number of messages taken per run (about one minute) and a random gap
 * between them, so messages are spread over the minute like a person sending them, never in a burst.
 */
export function campaignPacing(perMinute: number, random: () => number = Math.random) {
  const base = Math.min(15000, Math.max(2500, 60000 / Math.max(1, perMinute)));
  const budgetMs = 50000;
  return {
    batch: Math.max(1, Math.min(perMinute, Math.floor(budgetMs / base) + 1)),
    budgetMs,
    gapMs: () => Math.round(base * (0.75 + random() * 0.5)),
  };
}

/** Minutes to wait before trying again when a protection limit of the number stops a send, or null. */
export function retryDelayMinutes(reason: string | undefined): number | null {
  switch (reason) {
    case "hourly_cap":
      return 15;
    case "daily_cap":
    case "new_conversation_cap":
    case "observation_window":
      return 60;
    case "circuit_breaker":
      return 60;
    default:
      return null;
  }
}
