// Shared auth helpers for /api/v1/* — verifies bearer API keys and returns a caller,
// or a 401/403 Response the handler should return directly.
import type { ApiCaller } from "@/modules/integrations/api-keys.server";

export const V1_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
} as const;

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...V1_CORS, ...(init.headers ?? {}) },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

export async function authenticate(
  request: Request,
  requiredScope: string,
): Promise<{ caller: ApiCaller } | Response> {
  const { verifyApiKey, hasScope } = await import("@/modules/integrations/api-keys.server");
  const caller = await verifyApiKey(request.headers.get("authorization"));
  if (!caller) return errorResponse(401, "unauthorized", "Missing or invalid API key. Send `Authorization: Bearer wsk_...`.");
  if (!hasScope(caller, requiredScope)) {
    return errorResponse(403, "forbidden", `Missing required scope: ${requiredScope}`);
  }
  return { caller };
}

export async function logRequest(
  caller: ApiCaller,
  request: Request,
  status: number,
  durationMs: number,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const url = new URL(request.url);
    await (supabaseAdmin as any).from("integ_api_request_logs").insert({
      organization_id: caller.organizationId,
      api_key_id: caller.apiKeyId,
      method: request.method,
      path: url.pathname,
      status_code: status,
      duration_ms: durationMs,
      ip: request.headers.get("x-forwarded-for") ?? null,
      user_agent: request.headers.get("user-agent") ?? null,
    });
  } catch (e) {
    console.error("[api-log] failed", e);
  }
}
