/**
 * Some moves must not start any automation (for example redistributing abandoned tickets must never make an
 * automation message the customers). The database records the stage/owner events by itself, so after such a
 * change the code marks those fresh events as «skipped», before the worker can take them.
 */
export const SKIPPED_BY_DESIGN_NOTE = "تغيير لا يُطلق أتمتة";
const CHUNK = 100;

export async function skipTriggerEvents(db: any, input: { organizationId: string; opportunityIds: string[]; types: string[]; since: string }): Promise<void> {
  const ids = [...new Set(input.opportunityIds)];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await db
      .from("domain_events")
      .update({ workflow_status: "done", workflow_error: SKIPPED_BY_DESIGN_NOTE })
      .eq("organization_id", input.organizationId)
      .eq("aggregate_type", "opportunity")
      .eq("workflow_status", "pending")
      .in("event_type", input.types)
      .in("aggregate_id", ids.slice(i, i + CHUNK))
      .gte("created_at", input.since);
    if (error) throw new Error(error.message);
  }
}
