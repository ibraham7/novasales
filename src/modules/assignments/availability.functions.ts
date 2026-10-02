// Agent availability — يستخدم جدول id_availability الموجود.
import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const StatusEnum = z.enum(["available", "busy", "away", "offline"]);
export type AgentStatus = z.infer<typeof StatusEnum>;

async function ctx() {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const ws = await getWorkspace();
  return { db: supabaseAdmin as any, ...ws };
}

export const getMyAvailability = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { db, userId } = await ctx();
    const { data } = await db
      .from("id_availability")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    return (data ?? { user_id: userId, status: "available", note: null, since: null }) as {
      user_id: string;
      status: AgentStatus;
      note: string | null;
      since: string | null;
    };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("Unauthorized")) {
      return { user_id: "", status: "offline" as AgentStatus, note: null, since: null };
    }
    throw e;
  }
});

export const setMyAvailability = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ status: StatusEnum, note: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { db, userId } = await ctx();
    const now = new Date().toISOString();
    await db
      .from("id_availability")
      .upsert(
        {
          user_id: userId,
          status: data.status,
          note: data.note ?? null,
          since: now,
        },
        { onConflict: "user_id" },
      );
    return { ok: true };
  });

export const listAvailabilities = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ userIds: z.array(z.string().uuid()).max(500) }).parse(d),
  )
  .handler(async ({ data }) => {
    if (!data.userIds.length) return [] as Array<{ user_id: string; status: AgentStatus }>;
    const { db } = await ctx();
    const { data: rows } = await db
      .from("id_availability")
      .select("user_id, status, note, since")
      .in("user_id", data.userIds);
    return (rows ?? []) as Array<{
      user_id: string;
      status: AgentStatus;
      note: string | null;
      since: string | null;
    }>;
  });
