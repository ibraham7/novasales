// أهلية أرقام واتساب للإسناد — تُستخدم في واجهات التوزيع.
import { createServerFn } from "@tanstack/react-start";

export const listAssignmentEligibility = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { loadOrgEligibility } = await import("@/modules/risk/eligibility.server");
  const { organizationId } = await getWorkspace();
  await requireAnyPermission(["crm.leads.assign", "opportunities.assign"]);
  return loadOrgEligibility(organizationId);
});
