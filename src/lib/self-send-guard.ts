/**
 * Tracks the moment the current user sent a message so the global realtime
 * notifier can stay silent for their own activity (and its WhatsApp echo).
 */
let lastSelfSendAt = 0;

export function markSelfSend() {
  lastSelfSendAt = Date.now();
}

export function isSelfSendRecent(windowMs = 4000) {
  return Date.now() - lastSelfSendAt < windowMs;
}
