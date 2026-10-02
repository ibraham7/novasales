// Action registry: maps namespaced action ids to handlers.
// Handlers never touch DB tables of other modules directly — they call module services.
export interface ActionContext {
  organizationId: string;
  runId: string;
  workflowId: string;
  triggerPayload: Record<string, unknown>;
  runContext: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export type ActionHandler = (
  config: Record<string, unknown>,
  ctx: ActionContext,
) => Promise<ActionResult>;

const registry = new Map<string, ActionHandler>();

export function registerAction(name: string, handler: ActionHandler) {
  registry.set(name, handler);
}

export function getAction(name: string): ActionHandler | undefined {
  return registry.get(name);
}

export function listActions(): string[] {
  return Array.from(registry.keys());
}

// Lazily register built-in actions
let _initialized = false;
export async function ensureActionsRegistered() {
  if (_initialized) return;
  _initialized = true;
  const [messaging, crm, assign, platform] = await Promise.all([
    import("./messaging.send.server"),
    import("./crm.actions.server"),
    import("./assignments.actions.server"),
    import("./platform.actions.server"),
  ]);
  messaging.register();
  crm.register();
  assign.register();
  platform.register();
}
