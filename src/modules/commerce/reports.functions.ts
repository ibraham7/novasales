import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ReportsInput = z.object({
    period: z
        .enum(["7d", "30d", "90d", "all"])
        .default("30d"),
});

function getCutoff(
    period: "7d" | "30d" | "90d" | "all",
) {
    if (period === "all") {
        return null;
    }

    const days =
        period === "7d"
            ? 7
            : period === "30d"
                ? 30
                : 90;

    return new Date(
        Date.now() -
        days * 24 * 60 * 60 * 1000,
    ).toISOString();
}

export const getSalesReports =
    createServerFn({
        method: "GET",
    })
        .validator((input: unknown) =>
            ReportsInput.parse(input ?? {}),
        )
        .handler(async ({ data }) => {
            const {
                getWorkspace,
                supabaseAdmin,
            } = await import(
                "@/platform/workspace/workspace.server"
            );

            const {
                requireAnyPermission,
            } = await import(
                "@/platform/rbac/rbac.server"
            );

            const db =
                supabaseAdmin as any;

            const {
                organizationId,
            } =
                await getWorkspace();

            const access =
                await requireAnyPermission([
                    "sales.reports.view",
                    "reports.view",
                ]);

            const {
                applySalesOrderScope,
            } = await import(
                "@/platform/rbac/data-scope.server"
            );

            const cutoff =
                getCutoff(
                    data.period,
                );

            let ordersQuery =
                db
                    .from(
                        "sales_orders",
                    )
                    .select(`
            id,
            contact_id,
            sales_rep_user_id,
            department_id,
            status,
            currency,
            subtotal,
            discount_total,
            total,
            confirmed_at,
            created_at
          `)
                    .eq(
                        "organization_id",
                        organizationId,
                    )
                    .eq(
                        "status",
                        "confirmed",
                    )
                    .order(
                        "confirmed_at",
                        {
                            ascending: true,
                        },
                    )
                    .limit(10000);

            const scopedOrdersQuery =
                applySalesOrderScope(
                    ordersQuery,
                    access,
                );

            if (!scopedOrdersQuery) {
                return {
                    summary: {
                        orders: 0,
                        customers: 0,
                        unitsSold: 0,
                        currencies: {},
                        discounts: {},
                    },
                    daily: [],
                    reps: [],
                    products: [],
                    departments: [],
                };
            }

            ordersQuery = scopedOrdersQuery;

            if (cutoff) {
                ordersQuery =
                    ordersQuery.gte(
                        "confirmed_at",
                        cutoff,
                    );
            }

            const {
                data: orders,
                error:
                ordersError,
            } =
                await ordersQuery;

            if (ordersError) {
                throw new Error(
                    ordersError.message,
                );
            }

            const orderRows =
                orders ?? [];

            if (
                orderRows.length ===
                0
            ) {
                return {
                    summary: {
                        orders: 0,
                        customers: 0,
                        unitsSold: 0,
                        currencies: {},
                        discounts: {},
                    },

                    daily: [],

                    reps: [],

                    products: [],

                    departments: [],
                };
            }

            const orderIds =
                orderRows.map(
                    (order: any) =>
                        order.id,
                );

            const repIds = [
                ...new Set(
                    orderRows
                        .map(
                            (order: any) =>
                                order.sales_rep_user_id,
                        )
                        .filter(Boolean),
                ),
            ];

            const departmentIds =
                [
                    ...new Set(
                        orderRows
                            .map(
                                (order: any) =>
                                    order.department_id,
                            )
                            .filter(Boolean),
                    ),
                ];

            const [
                itemsResult,
                repsResult,
                departmentsResult,
            ] =
                await Promise.all([
                    db
                        .from(
                            "sales_order_items",
                        )
                        .select(`
              id,
              order_id,
              product_id,
              product_name,
              sku,
              quantity,
              list_unit_price,
              sold_unit_price,
              line_total
            `)
                        .eq(
                            "organization_id",
                            organizationId,
                        )
                        .in(
                            "order_id",
                            orderIds,
                        )
                        .limit(20000),

                    repIds.length
                        ? db
                            .from(
                                "profiles",
                            )
                            .select(`
                  id,
                  full_name,
                  avatar_url
                `)
                            .in(
                                "id",
                                repIds,
                            )
                        : Promise.resolve({
                            data: [],
                            error: null,
                        }),

                    departmentIds.length
                        ? db
                            .from(
                                "org_departments",
                            )
                            .select(`
                  id,
                  name
                `)
                            .in(
                                "id",
                                departmentIds,
                            )
                        : Promise.resolve({
                            data: [],
                            error: null,
                        }),
                ]);

            if (
                itemsResult.error
            ) {
                throw new Error(
                    itemsResult.error.message,
                );
            }

            if (
                repsResult.error
            ) {
                throw new Error(
                    repsResult.error.message,
                );
            }

            if (
                departmentsResult.error
            ) {
                throw new Error(
                    departmentsResult.error.message,
                );
            }

            const items =
                itemsResult.data ??
                [];

            const repMap =
                new Map(
                    (
                        repsResult.data ??
                        []
                    ).map(
                        (row: any) => [
                            row.id,
                            row,
                        ],
                    ),
                );

            const departmentMap =
                new Map(
                    (
                        departmentsResult.data ??
                        []
                    ).map(
                        (row: any) => [
                            row.id,
                            row,
                        ],
                    ),
                );

            const orderMap =
                new Map(
                    orderRows.map(
                        (order: any) => [
                            order.id,
                            order,
                        ],
                    ),
                );

            const customerIds =
                new Set(
                    orderRows
                        .map(
                            (order: any) =>
                                order.contact_id,
                        )
                        .filter(Boolean),
                );

            const currencies: Record<
                string,
                number
            > = {};

            const discounts: Record<
                string,
                number
            > = {};

            let unitsSold =
                0;

            for (const order of
                orderRows) {
                const currency =
                    String(
                        order.currency ??
                        "USD",
                    );

                currencies[
                    currency
                ] =
                    (
                        currencies[
                        currency
                        ] ?? 0
                    ) +
                    Number(
                        order.total ??
                        0,
                    );

                discounts[
                    currency
                ] =
                    (
                        discounts[
                        currency
                        ] ?? 0
                    ) +
                    Number(
                        order.discount_total ??
                        0,
                    );
            }

            for (const item of
                items) {
                unitsSold +=
                    Number(
                        item.quantity ??
                        0,
                    );
            }

            const dailyMap =
                new Map<
                    string,
                    {
                        date: string;
                        orders: number;
                        units: number;
                        currencies: Record<
                            string,
                            number
                        >;
                        discounts: Record<
                            string,
                            number
                        >;
                    }
                >();

            for (const order of
                orderRows) {
                const date =
                    String(
                        order.confirmed_at ??
                        order.created_at,
                    ).slice(
                        0,
                        10,
                    );

                if (
                    !dailyMap.has(
                        date,
                    )
                ) {
                    dailyMap.set(
                        date,
                        {
                            date,
                            orders: 0,
                            units: 0,
                            currencies:
                                {},
                            discounts:
                                {},
                        },
                    );
                }

                const row =
                    dailyMap.get(
                        date,
                    )!;

                const currency =
                    String(
                        order.currency ??
                        "USD",
                    );

                row.orders +=
                    1;

                row.currencies[
                    currency
                ] =
                    (
                        row.currencies[
                        currency
                        ] ?? 0
                    ) +
                    Number(
                        order.total ??
                        0,
                    );

                row.discounts[
                    currency
                ] =
                    (
                        row.discounts[
                        currency
                        ] ?? 0
                    ) +
                    Number(
                        order.discount_total ??
                        0,
                    );
            }

            for (const item of
                items) {
                const order =
                    orderMap.get(
                        item.order_id,
                    );

                if (!order) {
                    continue;
                }

                const date =
                    String(
                        order.confirmed_at ??
                        order.created_at,
                    ).slice(
                        0,
                        10,
                    );

                const row =
                    dailyMap.get(
                        date,
                    );

                if (row) {
                    row.units +=
                        Number(
                            item.quantity ??
                            0,
                        );
                }
            }

            const repsMap =
                new Map<
                    string,
                    {
                        id: string;
                        name: string;
                        avatarUrl:
                        | string
                        | null;
                        orders: number;
                        customers: Set<string>;
                        units: number;
                        currencies: Record<
                            string,
                            number
                        >;
                        discounts: Record<
                            string,
                            number
                        >;
                    }
                >();

            for (const order of
                orderRows) {
                if (
                    !order.sales_rep_user_id
                ) {
                    continue;
                }

                const rep =
                    repMap.get(
                        order.sales_rep_user_id,
                    );

                if (
                    !repsMap.has(
                        order.sales_rep_user_id,
                    )
                ) {
                    repsMap.set(
                        order.sales_rep_user_id,
                        {
                            id:
                                order.sales_rep_user_id,

                            name:
                                rep?.full_name ||
                                "مندوب",

                            avatarUrl:
                                rep?.avatar_url ??
                                null,

                            orders:
                                0,

                            customers:
                                new Set(),

                            units:
                                0,

                            currencies:
                                {},

                            discounts:
                                {},
                        },
                    );
                }

                const row =
                    repsMap.get(
                        order.sales_rep_user_id,
                    )!;

                row.orders +=
                    1;

                if (
                    order.contact_id
                ) {
                    row.customers.add(
                        order.contact_id,
                    );
                }

                const currency =
                    String(
                        order.currency ??
                        "USD",
                    );

                row.currencies[
                    currency
                ] =
                    (
                        row.currencies[
                        currency
                        ] ?? 0
                    ) +
                    Number(
                        order.total ??
                        0,
                    );

                row.discounts[
                    currency
                ] =
                    (
                        row.discounts[
                        currency
                        ] ?? 0
                    ) +
                    Number(
                        order.discount_total ??
                        0,
                    );
            }

            for (const item of
                items) {
                const order =
                    orderMap.get(
                        item.order_id,
                    );

                if (
                    !order?.sales_rep_user_id
                ) {
                    continue;
                }

                const row =
                    repsMap.get(
                        order.sales_rep_user_id,
                    );

                if (row) {
                    row.units +=
                        Number(
                            item.quantity ??
                            0,
                        );
                }
            }

            const productMap =
                new Map<
                    string,
                    {
                        productId:
                        string;
                        name: string;
                        sku:
                        | string
                        | null;
                        units: number;
                        orders:
                        Set<string>;
                        currencies: Record<
                            string,
                            number
                        >;
                        discounts: Record<
                            string,
                            number
                        >;
                    }
                >();

            for (const item of
                items) {
                const order =
                    orderMap.get(
                        item.order_id,
                    );

                if (!order) {
                    continue;
                }

                const productKey =
                    item.product_id ??
                    item.product_name;

                if (
                    !productMap.has(
                        productKey,
                    )
                ) {
                    productMap.set(
                        productKey,
                        {
                            productId:
                                item.product_id,

                            name:
                                item.product_name,

                            sku:
                                item.sku,

                            units:
                                0,

                            orders:
                                new Set(),

                            currencies:
                                {},

                            discounts:
                                {},
                        },
                    );
                }

                const row =
                    productMap.get(
                        productKey,
                    )!;

                const quantity =
                    Number(
                        item.quantity ??
                        0,
                    );

                const listPrice =
                    Number(
                        item.list_unit_price ??
                        0,
                    );

                const soldPrice =
                    Number(
                        item.sold_unit_price ??
                        0,
                    );

                const lineTotal =
                    Number(
                        item.line_total ??
                        soldPrice *
                        quantity,
                    );

                const currency =
                    String(
                        order.currency ??
                        "USD",
                    );

                row.units +=
                    quantity;

                row.orders.add(
                    item.order_id,
                );

                row.currencies[
                    currency
                ] =
                    (
                        row.currencies[
                        currency
                        ] ?? 0
                    ) +
                    lineTotal;

                row.discounts[
                    currency
                ] =
                    (
                        row.discounts[
                        currency
                        ] ?? 0
                    ) +
                    Math.max(
                        0,
                        (
                            listPrice -
                            soldPrice
                        ) *
                        quantity,
                    );
            }

            const departmentStats =
                new Map<
                    string,
                    {
                        id: string;
                        name: string;
                        orders: number;
                        customers:
                        Set<string>;
                        units: number;
                        currencies: Record<
                            string,
                            number
                        >;
                    }
                >();

            for (const order of
                orderRows) {
                if (
                    !order.department_id
                ) {
                    continue;
                }

                const department =
                    departmentMap.get(
                        order.department_id,
                    );

                if (
                    !departmentStats.has(
                        order.department_id,
                    )
                ) {
                    departmentStats.set(
                        order.department_id,
                        {
                            id:
                                order.department_id,

                            name:
                                department?.name ||
                                "قسم",

                            orders:
                                0,

                            customers:
                                new Set(),

                            units:
                                0,

                            currencies:
                                {},
                        },
                    );
                }

                const row =
                    departmentStats.get(
                        order.department_id,
                    )!;

                row.orders +=
                    1;

                if (
                    order.contact_id
                ) {
                    row.customers.add(
                        order.contact_id,
                    );
                }

                const currency =
                    String(
                        order.currency ??
                        "USD",
                    );

                row.currencies[
                    currency
                ] =
                    (
                        row.currencies[
                        currency
                        ] ?? 0
                    ) +
                    Number(
                        order.total ??
                        0,
                    );
            }

            for (const item of
                items) {
                const order =
                    orderMap.get(
                        item.order_id,
                    );

                if (
                    !order?.department_id
                ) {
                    continue;
                }

                const row =
                    departmentStats.get(
                        order.department_id,
                    );

                if (row) {
                    row.units +=
                        Number(
                            item.quantity ??
                            0,
                        );
                }
            }

            return {
                summary: {
                    orders:
                        orderRows.length,

                    customers:
                        customerIds.size,

                    unitsSold,

                    currencies,

                    discounts,
                },

                daily:
                    Array.from(
                        dailyMap.values(),
                    ).sort(
                        (a, b) =>
                            a.date.localeCompare(
                                b.date,
                            ),
                    ),

                reps:
                    Array.from(
                        repsMap.values(),
                    )
                        .map(
                            (row) => ({
                                id:
                                    row.id,

                                name:
                                    row.name,

                                avatarUrl:
                                    row.avatarUrl,

                                orders:
                                    row.orders,

                                customers:
                                    row.customers.size,

                                units:
                                    row.units,

                                currencies:
                                    row.currencies,

                                discounts:
                                    row.discounts,
                            }),
                        )
                        .sort(
                            (a, b) =>
                                b.units -
                                a.units,
                        ),

                products:
                    Array.from(
                        productMap.values(),
                    )
                        .map(
                            (row) => ({
                                productId:
                                    row.productId,

                                name:
                                    row.name,

                                sku:
                                    row.sku,

                                units:
                                    row.units,

                                orders:
                                    row.orders.size,

                                currencies:
                                    row.currencies,

                                discounts:
                                    row.discounts,
                            }),
                        )
                        .sort(
                            (a, b) =>
                                b.units -
                                a.units,
                        ),

                departments:
                    Array.from(
                        departmentStats.values(),
                    )
                        .map(
                            (row) => ({
                                id:
                                    row.id,

                                name:
                                    row.name,

                                orders:
                                    row.orders,

                                customers:
                                    row.customers.size,

                                units:
                                    row.units,

                                currencies:
                                    row.currencies,
                            }),
                        )
                        .sort(
                            (a, b) =>
                                b.units -
                                a.units,
                        ),
            };
        });