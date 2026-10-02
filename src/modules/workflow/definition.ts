export function linkWorkflowSteps(steps: any[]) {
  const ids = new Set(steps.map((s) => s.id));
  return steps.map((s, i) => {
    const copy = { ...s, next: s.type === "end" ? undefined : steps[i + 1]?.id };
    for (const key of ["onTrue", "onFalse", "onEvent", "onTimeout"])
      if (copy[key] && !ids.has(copy[key])) delete copy[key];
    return copy;
  });
}
export function validateWorkflowDefinition(def: any, active = false) {
  if (!def || def.engine !== "v1" || !Array.isArray(def.steps) || def.steps.length > 100)
    throw new Error("تعريف الأتمتة غير صحيح؛ الحد الأقصى 100 خطوة");
  if (active && !def.steps.length)
    throw new Error("أضف خطوة واحدة على الأقل قبل التفعيل أو التشغيل");
  const ids = new Set<string>();
  for (const s of def.steps) {
    if (typeof s.id !== "string" || !s.id || ids.has(s.id))
      throw new Error("معرّفات الخطوات مكررة أو غير صحيحة");
    ids.add(s.id);
  }
  for (const s of def.steps) {
    if (!["action", "delay", "wait_for_event", "condition", "end"].includes(s.type))
      throw new Error("نوع الخطوة غير مدعوم");
    for (const key of ["next", "onTrue", "onFalse", "onEvent", "onTimeout"])
      if (s[key] && !ids.has(s[key])) throw new Error("إحدى الخطوات تشير إلى خطوة محذوفة");
    if (
      s.type === "delay" &&
      (!Number.isFinite(s.duration_minutes) ||
        s.duration_minutes < 1 ||
        s.duration_minutes > 525600)
    )
      throw new Error("مدة الانتظار يجب أن تكون بين دقيقة وسنة");
    if (
      s.type === "wait_for_event" &&
      (!s.event ||
        !Number.isFinite(s.timeout_minutes) ||
        s.timeout_minutes < 1 ||
        s.timeout_minutes > 525600)
    )
      throw new Error("أدخل الحدث ومهلة انتظار صحيحة");
    if (
      s.type === "action" &&
      (!s.action || !s.config || typeof s.config !== "object" || Array.isArray(s.config))
    )
      throw new Error("أدخل إجراء وإعدادات صحيحة");
    if (s.type === "condition") validateCondition(s.expr);
  }
}
export function validateCondition(expr: any, depth = 0): void {
  if (depth > 20) throw new Error("الشرط متداخل أكثر من الحد المسموح");
  if (typeof expr === "boolean") return;
  if (!expr || typeof expr !== "object" || Array.isArray(expr) || Object.keys(expr).length !== 1)
    throw new Error("صيغة الشرط غير صحيحة");
  if ("eq" in expr || "neq" in expr) {
    const value = expr.eq ?? expr.neq;
    if (!Array.isArray(value) || value.length !== 2) throw new Error("المقارنة تحتاج قيمتين");
    return;
  }
  if ("truthy" in expr) return;
  if ("and" in expr || "or" in expr) {
    const value = expr.and ?? expr.or;
    if (!Array.isArray(value) || !value.length) throw new Error("الشرط يحتاج عناصر");
    value.forEach((e) => validateCondition(e, depth + 1));
    return;
  }
  throw new Error("عملية الشرط غير مدعومة");
}
export function validTickToken(header: string | null, token: string | undefined) {
  return !!token && token.length >= 32 && header === `Bearer ${token}`;
}
