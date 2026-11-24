import { usePermission } from "@/platform/rbac/use-permission";

/** May this user move tickets (and their chats) to the trash? All three hooks run every time (never chain hooks with «||»). */
export function useCanDeleteTickets(): boolean {
  const a = usePermission("crm.opportunities.delete");
  const b = usePermission("opportunities.delete");
  const c = usePermission("opportunities.manage");
  return a || b || c;
}
