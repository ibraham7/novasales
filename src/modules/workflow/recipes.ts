/**
 * Ready-made workflows, one click each. A recipe is only a starting point: it is created SWITCHED OFF, the person
 * reads it, changes the words, and switches it on. Customer messages still need the organization's automatic
 * sending switched on (send settings), and staff alerts their own switch. Pure data.
 */
import { linkWorkflowSteps } from "./definition.ts";

export type RecipeStep = Record<string, any>;
export type Recipe = {
  id: string;
  title: string;
  description: string;
  category: "تجربة" | "عملاء جدد" | "متابعة" | "عروض الأسعار" | "إغلاق الصفقة" | "تنبيهات الفريق";
  /** What it sends: «خدمة» replies to people who wrote to us; «ترويج» only to those who agreed; «داخلي» goes to staff only. */
  audience: "خدمة" | "ترويج" | "داخلي";
  trigger: { type: "event"; config: Record<string, any> };
  steps: RecipeStep[];
};

const step = (id: string, label: string, action: string, config: Record<string, unknown>): RecipeStep => ({ id, type: "action", label, action, config });
const wait = (id: string, label: string, minutes: number): RecipeStep => ({ id, type: "delay", label, duration_minutes: minutes });

/** The recipes added in later steps are appended here. */
export const BASE_RECIPES: Recipe[] = [
  {
    id: "starter-task-on-stage",
    title: "تجربة: مهمة عند تغيّر المرحلة",
    description: "عند انتقال أي تذكرة لمرحلة جديدة تُنشأ مهمة «راجع التذكرة». لا ترسل شيئاً لأحد، فهي مناسبة لتجربة الأتمتة بأمان.",
    category: "تجربة",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "crm.opportunity.stage_changed" } },
    steps: [step("task", "إنشاء مهمة مراجعة", "crm.task.create", { title: "راجع التذكرة بعد تغيّر المرحلة", priority: "normal" })],
  },
  {
    id: "alert-assignee-on-assign",
    title: "تنبيه المندوب عند إسناد تذكرة له",
    description: "عند إسناد تذكرة لمندوب يصله تنبيه فيه اسم العميل. تنبيهات الفريق مطفأة حتى تُفعَّل من «إعدادات الإرسال».",
    category: "تنبيهات الفريق",
    audience: "داخلي",
    trigger: { type: "event", config: { event: "crm.opportunity.assigned" } },
    steps: [step("alert", "تنبيه المندوب", "notify.staff", { to: "assignee", title: "تذكرة جديدة لك: {name}", body: "المصدر: {source} · المرحلة: {stage}" })],
  },
];

export const RECIPES: Recipe[] = [...BASE_RECIPES];

/** The workflow definition a recipe creates (steps chained one after the other). */
export function recipeDefinition(recipe: Recipe) {
  return { version: 1, engine: "v1", metadata: { recipe: recipe.id, createdAt: new Date().toISOString() }, steps: linkWorkflowSteps(recipe.steps) };
}
export { wait as recipeWait, step as recipeStep };
