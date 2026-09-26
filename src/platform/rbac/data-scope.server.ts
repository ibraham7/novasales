import type { WorkspaceAccess } from "./rbac.server";

export type VisibilityScope = "all" | "department" | "own";

const ALL_ROLE_KEYS = new Set([
  "admin",
  "owner",
  "org_owner",
  "supervisor",
]);

export function getOpportunityVisibility(
  access: WorkspaceAccess,
): VisibilityScope {
  if (
    access.isSuperAdmin ||
    access.roleKeys.some((role) => ALL_ROLE_KEYS.has(role))
  ) {
    return "all";
  }

  if (
    access.roleKeys.includes("department_supervisor") ||
    access.permissions.includes("opportunities.view_department") ||
    access.permissions.includes("reports.view_department")
  ) {
    return "department";
  }

  return "own";
}

export function filterRequestedDepartment(
  access: WorkspaceAccess,
  requestedDepartmentId?: string | null,
) {
  const scope = getOpportunityVisibility(access);

  if (scope === "all") {
    return {
      scope,
      departmentIds: requestedDepartmentId
        ? [requestedDepartmentId]
        : [],
    };
  }

  if (scope === "department") {
    if (requestedDepartmentId) {
      const allowed =
        access.departmentIds.includes(
          requestedDepartmentId,
        );

      return {
        scope,
        departmentIds: allowed
          ? [requestedDepartmentId]
          : [],
        denied: !allowed,
      };
    }

    return {
      scope,
      departmentIds: access.departmentIds,
      denied: access.departmentIds.length === 0,
    };
  }

  return {
    scope,
    departmentIds: [],
  };
}

/**
 * Opportunity scope
 */
export function applyOpportunityScope(
  query: any,
  access: WorkspaceAccess,
  filters: {
    departmentId?: string;
    ownerAgentId?: string;
  } = {},
) {
  const scoped =
    filterRequestedDepartment(
      access,
      filters.departmentId,
    );

  if (scoped.denied) {
    return null;
  }

  let q = query;

  if (
    scoped.scope === "department" &&
    scoped.departmentIds.length > 0
  ) {
    q = q.in(
      "department_id",
      scoped.departmentIds,
    );

    if (filters.ownerAgentId) {
      q = q.eq(
        "owner_agent_id",
        filters.ownerAgentId,
      );
    }
  } else if (scoped.scope === "own") {
    q = q.eq(
      "owner_agent_id",
      access.userId,
    );
  } else {
    if (filters.departmentId) {
      q = q.eq(
        "department_id",
        filters.departmentId,
      );
    }

    if (filters.ownerAgentId) {
      q = q.eq(
        "owner_agent_id",
        filters.ownerAgentId,
      );
    }
  }

  return q;
}

/**
 * Lead scope
 */
export function applyLeadScope(
  query: any,
  access: WorkspaceAccess,
  filters: {
    departmentId?: string;
    ownerId?: string;
  } = {},
) {
  const scoped =
    filterRequestedDepartment(
      access,
      filters.departmentId,
    );

  if (scoped.denied) {
    return null;
  }

  let q = query;

  if (
    scoped.scope === "department" &&
    scoped.departmentIds.length > 0
  ) {
    q = q.in(
      "department_id",
      scoped.departmentIds,
    );

    if (filters.ownerId) {
      q = q.eq(
        "owner_user_id",
        filters.ownerId,
      );
    }
  } else if (scoped.scope === "own") {
    q = q.eq(
      "owner_user_id",
      access.userId,
    );
  } else {
    if (filters.departmentId) {
      q = q.eq(
        "department_id",
        filters.departmentId,
      );
    }

    if (filters.ownerId) {
      q = q.eq(
        "owner_user_id",
        filters.ownerId,
      );
    }
  }

  return q;
}

/**
 * Sales orders scope
 *
 * all:
 *   يرى جميع طلبات المؤسسة.
 *
 * department:
 *   يرى الطلبات الخاصة بالأقسام التي يشرف عليها.
 *
 * own:
 *   يرى الطلبات المسجلة باسمه كمندوب فقط.
 */
export function applySalesOrderScope(
  query: any,
  access: WorkspaceAccess,
  filters: {
    departmentId?: string;
    salesRepUserId?: string;
  } = {},
) {
  const scoped =
    filterRequestedDepartment(
      access,
      filters.departmentId,
    );

  if (scoped.denied) {
    return null;
  }

  let q = query;

  if (scoped.scope === "department") {
    if (scoped.departmentIds.length === 0) {
      return null;
    }

    q = q.in(
      "department_id",
      scoped.departmentIds,
    );

    if (filters.salesRepUserId) {
      q = q.eq(
        "sales_rep_user_id",
        filters.salesRepUserId,
      );
    }

    return q;
  }

  if (scoped.scope === "own") {
    return q.eq(
      "sales_rep_user_id",
      access.userId,
    );
  }

  if (filters.departmentId) {
    q = q.eq(
      "department_id",
      filters.departmentId,
    );
  }

  if (filters.salesRepUserId) {
    q = q.eq(
      "sales_rep_user_id",
      filters.salesRepUserId,
    );
  }

  return q;
}

export function canAccessOpportunityRow(
  access: WorkspaceAccess,
  opportunity: {
    owner_agent_id?: string | null;
    department_id?: string | null;
  },
) {
  const scope =
    getOpportunityVisibility(access);

  if (scope === "all") {
    return true;
  }

  if (scope === "department") {
    return (
      !!opportunity.department_id &&
      access.departmentIds.includes(
        opportunity.department_id,
      )
    );
  }

  return (
    opportunity.owner_agent_id ===
    access.userId
  );
}

export function canAccessSalesOrderRow(
  access: WorkspaceAccess,
  order: {
    sales_rep_user_id?: string | null;
    department_id?: string | null;
  },
) {
  const scope =
    getOpportunityVisibility(access);

  if (scope === "all") {
    return true;
  }

  if (scope === "department") {
    return (
      !!order.department_id &&
      access.departmentIds.includes(
        order.department_id,
      )
    );
  }

  return (
    order.sales_rep_user_id ===
    access.userId
  );
}

export function scopedDashboardFilters<
  T extends {
    departmentId?: string;
    ownerId?: string;
  },
>(
  access: WorkspaceAccess,
  filters: T,
): T {
  const scope =
    getOpportunityVisibility(access);

  if (scope === "all") {
    return filters;
  }

  if (scope === "department") {
    const departmentId =
      filters.departmentId &&
        access.departmentIds.includes(
          filters.departmentId,
        )
        ? filters.departmentId
        : access.departmentIds[0];

    return {
      ...filters,
      departmentId,
      ownerId: filters.ownerId,
    };
  }

  return {
    ...filters,
    ownerId: access.userId,
  };
}