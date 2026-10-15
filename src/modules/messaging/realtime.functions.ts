import { createServerFn } from "@tanstack/react-start";

/** Private realtime topic on which the database signals chat activity for the caller's organization. */
export const getChatRealtimeTopic = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { organizationId } = await getWorkspace();
  return `org:${organizationId}:chats`;
});
