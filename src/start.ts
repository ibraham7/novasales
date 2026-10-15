import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./platform/errors/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Log-only: records server functions slower than 400 ms (name and duration, never data) so
// speed work targets what is actually slow in production. Does not change any result.
const slowServerFnLog = createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
  const started = performance.now();
  try {
    return await next();
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms >= 400) console.log(`[SLOW_FN] ${ms}ms ${serverFnMeta?.name ?? "unknown"}`);
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, slowServerFnLog],
  requestMiddleware: [errorMiddleware],
}));
