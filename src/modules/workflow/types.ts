// Workflow definition types (versioned).
export const WORKFLOW_ENGINE_VERSION = "v1";
export const WORKFLOW_MAX_STEPS = 100;

export type WfStepType = "action" | "delay" | "wait_for_event" | "condition" | "branch" | "end";

export interface WfStepBase {
  id: string;
  type: WfStepType;
  label?: string;
  description?: string;
  icon?: string;
  next?: string; // default next step id
}

export interface WfActionStep extends WfStepBase {
  type: "action";
  action: string; // namespaced e.g. "messaging.send"
  config: Record<string, unknown>;
}

export interface WfDelayStep extends WfStepBase {
  type: "delay";
  duration_minutes: number;
}

export interface WfWaitEventStep extends WfStepBase {
  type: "wait_for_event";
  event: string;
  match?: Record<string, unknown>;
  timeout_minutes: number;
  onTimeout?: string;
  onEvent?: string;
}

export interface WfConditionStep extends WfStepBase {
  type: "condition";
  expr: unknown; // simple JSON logic
  onTrue?: string;
  onFalse?: string;
}

export interface WfEndStep extends WfStepBase {
  type: "end";
}

export type WfStep = WfActionStep | WfDelayStep | WfWaitEventStep | WfConditionStep | WfEndStep;

export interface WfDefinition {
  version: number;
  engine: string;
  metadata: Record<string, unknown>;
  steps: WfStep[];
}

export const emptyDefinition = (createdBy?: string): WfDefinition => ({
  version: 1,
  engine: WORKFLOW_ENGINE_VERSION,
  metadata: { createdBy: createdBy ?? null, createdAt: new Date().toISOString() },
  steps: [],
});
