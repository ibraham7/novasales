import type { IAssignmentStrategy, AssignmentStrategyInput } from "./strategy";

export const manualStrategy: IAssignmentStrategy = {
  id: "manual",
  async pick(input: AssignmentStrategyInput & { preselectedUserId?: string }) {
    if (!input.preselectedUserId) {
      throw new Error("Manual strategy requires an explicit toUserId");
    }
    return input.preselectedUserId;
  },
};

// TODO: round_robin — يوزّع بالتناوب على المندوبين المتاحين في القسم.
// TODO: least_loaded — يختار المندوب الأقل حِملاً (open opportunities).
// TODO: random — يختار عشوائياً من المتاحين.
export const strategyRegistry = new Map<string, IAssignmentStrategy>([
  [manualStrategy.id, manualStrategy],
]);

export function getStrategy(id: string): IAssignmentStrategy {
  const s = strategyRegistry.get(id);
  if (!s) throw new Error(`Assignment strategy غير مدعوم: ${id}`);
  return s;
}
