// Assignment Strategy interface — قابل للتوسع لاحقاً (Round Robin, Least Loaded…)
export interface AssignmentStrategyInput {
  organizationId: string;
  departmentId?: string | null;
  leadId: string;
  candidateUserIds: string[];
}

export interface IAssignmentStrategy {
  readonly id: string; // "manual" | "round_robin" | "least_loaded" | "random"
  /** يختار مندوباً من المرشحين. Manual يتطلب toUserId من المشرف. */
  pick(input: AssignmentStrategyInput & { preselectedUserId?: string }): Promise<string>;
}
