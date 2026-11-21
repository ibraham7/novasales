/**
 * The automation worker inside the server process. OFF unless WORKFLOW_AUTO_TICK=1, and it only runs inside the
 * minute loop of the campaign ticker (which itself needs CAMPAIGN_AUTO_TICK=1). An error here never stops the
 * campaigns, and a campaign error never stops this.
 */
export function workflowTickEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WORKFLOW_AUTO_TICK === "1";
}

export async function runWorkflowTick(env: Record<string, string | undefined> = process.env) {
  if (!workflowTickEnabled(env)) return null;
  const { tickWorkflows } = await import("./jobs.server");
  return tickWorkflows();
}
