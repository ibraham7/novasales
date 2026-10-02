import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type FieldType =
  "text" | "number" | "date" | "select" | "multiselect" | "boolean" | "phone" | "email";

export type Visibility = "everyone" | "agent" | "supervisor" | "admin" | "owner";

export interface FieldDef {
  id: string;
  organization_id: string;
  entity_type: string;
  key: string;
  label: string;
  field_type: FieldType;
  field_group: string;
  options: Array<{ value: string; label: string }>;
  default_value: unknown;
  validation: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    regex?: string;
  };
  visibility: Visibility;
  is_required: boolean;
  read_only: boolean;
  system_field: boolean;
  is_searchable: boolean;
  is_filterable: boolean;
  is_active: boolean;
  ord: number;
}

const ROLE_LEVEL: Record<string, number> = {
  agent: 1,
  supervisor: 2,
  admin: 3,
  owner: 4,
};
const VIS_LEVEL: Record<Visibility, number> = {
  everyone: 0,
  agent: 1,
  supervisor: 2,
  admin: 3,
  owner: 4,
};

export function canSeeField(def: FieldDef, role: string | null | undefined): boolean {
  const level = role ? (ROLE_LEVEL[role] ?? 0) : 0;
  return level >= VIS_LEVEL[def.visibility];
}

export function filterVisibleFields(defs: FieldDef[], role: string | null | undefined): FieldDef[] {
  return defs.filter((d) => canSeeField(d, role));
}

export async function loadFieldDefs(
  organizationId: string,
  entityType: string,
): Promise<FieldDef[]> {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("crm_field_defs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("entity_type", entityType)
    .eq("is_active", true)
    .order("ord", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FieldDef[];
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

export async function validateAndApplyCustomFields(
  organizationId: string,
  entityType: string,
  incoming: Record<string, unknown> | null | undefined,
  opts: { existing?: Record<string, unknown>; role?: string | null } = {},
): Promise<Record<string, unknown>> {
  const defs = await loadFieldDefs(organizationId, entityType);
  const existing = opts.existing ?? {};
  const values = { ...existing, ...(incoming ?? {}) };

  for (const def of defs) {
    // Hidden definitions cannot be supplied or made mandatory for the current editor.
    if (opts.role && !canSeeField(def, opts.role)) {
      if (existing[def.key] !== undefined) values[def.key] = existing[def.key];
      else if (def.default_value !== null && def.default_value !== undefined)
        values[def.key] = def.default_value;
      else delete values[def.key];
      continue;
    }
    // Apply defaults if missing
    if (isEmpty(values[def.key]) && def.default_value !== null && def.default_value !== undefined) {
      values[def.key] = def.default_value;
    }
    // Read-only protection: cannot overwrite existing values
    if (def.read_only && incoming && def.key in incoming) {
      if (existing[def.key] !== undefined) {
        values[def.key] = existing[def.key];
      }
    }
    // Visibility check on write
    if (opts.role && !canSeeField(def, opts.role) && incoming && def.key in incoming) {
      if (existing[def.key] !== undefined) values[def.key] = existing[def.key];
      else delete values[def.key];
    }
    // Required
    if (def.is_required && isEmpty(values[def.key])) {
      throw new Error(`الحقل "${def.label}" مطلوب`);
    }
    // Type validation
    const v = values[def.key];
    if (!isEmpty(v)) {
      switch (def.field_type) {
        case "number": {
          const n = typeof v === "number" ? v : Number(v);
          if (Number.isNaN(n)) throw new Error(`"${def.label}" يجب أن يكون رقماً`);
          if (def.validation.min !== undefined && n < def.validation.min)
            throw new Error(`"${def.label}" أقل من الحد الأدنى ${def.validation.min}`);
          if (def.validation.max !== undefined && n > def.validation.max)
            throw new Error(`"${def.label}" أكبر من الحد الأقصى ${def.validation.max}`);
          values[def.key] = n;
          break;
        }
        case "boolean":
          values[def.key] = Boolean(v);
          break;
        case "date":
          if (typeof v !== "string" || Number.isNaN(Date.parse(v)))
            throw new Error(`"${def.label}" تاريخ غير صالح`);
          break;
        case "email":
          if (typeof v !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
            throw new Error(`"${def.label}" بريد غير صالح`);
          break;
        case "phone":
          if (typeof v !== "string" || v.replace(/\D/g, "").length < 5)
            throw new Error(`"${def.label}" رقم هاتف غير صالح`);
          break;
        case "select": {
          const allowed = def.options.map((o) => o.value);
          if (typeof v !== "string" || !allowed.includes(v))
            throw new Error(`"${def.label}" خيار غير صالح`);
          break;
        }
        case "multiselect": {
          if (!Array.isArray(v)) throw new Error(`"${def.label}" يجب أن يكون قائمة`);
          const allowed = def.options.map((o) => o.value);
          for (const item of v) {
            if (typeof item !== "string" || !allowed.includes(item))
              throw new Error(`"${def.label}" يحتوي خياراً غير صالح`);
          }
          break;
        }
        case "text": {
          if (typeof v !== "string") throw new Error(`"${def.label}" يجب أن يكون نصاً`);
          if (def.validation.minLength !== undefined && v.length < def.validation.minLength)
            throw new Error(`"${def.label}" قصير جداً`);
          if (def.validation.maxLength !== undefined && v.length > def.validation.maxLength)
            throw new Error(`"${def.label}" طويل جداً`);
          if (def.validation.regex) {
            try {
              const re = new RegExp(def.validation.regex);
              if (!re.test(v)) throw new Error(`"${def.label}" لا يطابق الصيغة المطلوبة`);
            } catch {
              /* ignore invalid regex */
            }
          }
          break;
        }
      }
    }
  }

  // Drop keys that are not defined fields (whitelist)
  const allowedKeys = new Set(defs.map((d) => d.key));
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (allowedKeys.has(k)) clean[k] = v;
  }
  return clean;
}
