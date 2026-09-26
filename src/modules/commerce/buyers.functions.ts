import { createServerFn } from "@tanstack/react-start";

export const listBuyers =
    createServerFn({
        method: "GET",
    }).handler(async () => {
        const {
            requirePermission,
            getWorkspaceAccess,
        } = await import(
            "@/platform/rbac/rbac.server"
        );

        const {
            applySalesOrderScope,
        } = await import(
            "@/platform/rbac/data-scope.server"
        );

        const {
            supabaseAdmin,
        } = await import(
            "@/integrations/supabase/client.server"
        );

        const {
            organizationId,
        } =
            await requirePermission(
                "sales.orders.view",
            );
        const access =
            await getWorkspaceAccess();

        const db =
            supabaseAdmin as any;

        let query = db
            .from("sales_orders")
            .select(`
        id,
        contact_id,
        opportunity_id,
        sales_rep_user_id,
        department_id,
        status,
        currency,
        subtotal,
        discount_total,
        total,
        confirmed_at,
        created_at,
        sales_order_items(
          id,
          product_id,
          product_name,
          sku,
          quantity,
          list_unit_price,
          sold_unit_price,
          line_total
        )
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
                    ascending: false,
                },
            )
            .limit(10000);

        const scopedQuery =
            applySalesOrderScope(
                query,
                access,
            );

        if (!scopedQuery) {
            return [];
        }

        query = scopedQuery;

        const {
            data: orders,
            error,
        } =
            await query;

        if (error) {
            throw new Error(
                error.message,
            );
        }

        if (
            !orders?.length
        ) {
            return [];
        }

        const contactIds = [
            ...new Set(
                orders
                    .map(
                        (order: any) =>
                            order.contact_id,
                    )
                    .filter(Boolean),
            ),
        ];

        const repIds = [
            ...new Set(
                orders
                    .map(
                        (order: any) =>
                            order.sales_rep_user_id,
                    )
                    .filter(Boolean),
            ),
        ];

        const departmentIds = [
            ...new Set(
                orders
                    .map(
                        (order: any) =>
                            order.department_id,
                    )
                    .filter(Boolean),
            ),
        ];

        const [
            contactsResult,
            repsResult,
            departmentsResult,
        ] =
            await Promise.all([
                contactIds.length
                    ? db
                        .from(
                            "crm_contacts",
                        )
                        .select(`
                id,
                display_name,
                full_name,
                lifecycle_stage,
                created_at
              `)
                        .in(
                            "id",
                            contactIds,
                        )
                    : Promise.resolve({
                        data: [],
                        error: null,
                    }),

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
            contactsResult.error
        ) {
            throw new Error(
                contactsResult.error.message,
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

        const contactMap =
            new Map(
                (
                    contactsResult.data ??
                    []
                ).map(
                    (row: any) => [
                        row.id,
                        row,
                    ],
                ),
            );

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

        const buyerMap =
            new Map<
                string,
                {
                    contactId: string;
                    name: string;
                    lifecycleStage:
                    | string
                    | null;
                    orders: any[];
                    orderCount: number;
                    productsCount: number;
                    lastPurchaseAt:
                    | string
                    | null;
                    currencies: Record<
                        string,
                        number
                    >;
                    discountByCurrency: Record<
                        string,
                        number
                    >;
                    reps: Map<
                        string,
                        {
                            id: string;
                            name: string;
                            avatarUrl:
                            | string
                            | null;
                        }
                    >;
                    departments: Set<string>;
                }
            >();

        for (const order of
            orders) {
            const contact =
                contactMap.get(
                    order.contact_id,
                );

            const buyerName =
                contact?.display_name ||
                contact?.full_name ||
                "عميل بدون اسم";

            if (
                !buyerMap.has(
                    order.contact_id,
                )
            ) {
                buyerMap.set(
                    order.contact_id,
                    {
                        contactId:
                            order.contact_id,

                        name:
                            buyerName,

                        lifecycleStage:
                            contact?.lifecycle_stage ??
                            null,

                        orders: [],

                        orderCount:
                            0,

                        productsCount:
                            0,

                        lastPurchaseAt:
                            null,

                        currencies: {},

                        discountByCurrency:
                            {},

                        reps:
                            new Map(),

                        departments:
                            new Set(),
                    },
                );
            }

            const buyer =
                buyerMap.get(
                    order.contact_id,
                )!;

            const items =
                Array.isArray(
                    order.sales_order_items,
                )
                    ? order.sales_order_items
                    : [];

            const productsCount =
                items.reduce(
                    (
                        sum: number,
                        item: any,
                    ) =>
                        sum +
                        Number(
                            item.quantity ??
                            0,
                        ),
                    0,
                );

            const rep =
                order.sales_rep_user_id
                    ? repMap.get(
                        order.sales_rep_user_id,
                    )
                    : null;

            const department =
                order.department_id
                    ? departmentMap.get(
                        order.department_id,
                    )
                    : null;

            buyer.orderCount +=
                1;

            buyer.productsCount +=
                productsCount;

            const currency =
                String(
                    order.currency ??
                    "USD",
                );

            buyer.currencies[
                currency
            ] =
                (
                    buyer.currencies[
                    currency
                    ] ?? 0
                ) +
                Number(
                    order.total ??
                    0,
                );

            buyer.discountByCurrency[
                currency
            ] =
                (
                    buyer
                        .discountByCurrency[
                    currency
                    ] ?? 0
                ) +
                Number(
                    order.discount_total ??
                    0,
                );

            if (
                !buyer.lastPurchaseAt ||
                new Date(
                    order.confirmed_at,
                ).getTime() >
                new Date(
                    buyer.lastPurchaseAt,
                ).getTime()
            ) {
                buyer.lastPurchaseAt =
                    order.confirmed_at;
            }

            if (
                rep &&
                order.sales_rep_user_id
            ) {
                buyer.reps.set(
                    order.sales_rep_user_id,
                    {
                        id:
                            order.sales_rep_user_id,

                        name:
                            rep.full_name ||
                            "مندوب",

                        avatarUrl:
                            rep.avatar_url ??
                            null,
                    },
                );
            }

            if (
                department?.name
            ) {
                buyer.departments.add(
                    department.name,
                );
            }

            buyer.orders.push({
                id:
                    order.id,

                confirmedAt:
                    order.confirmed_at,

                currency,

                subtotal:
                    Number(
                        order.subtotal ??
                        0,
                    ),

                discountTotal:
                    Number(
                        order.discount_total ??
                        0,
                    ),

                total:
                    Number(
                        order.total ??
                        0,
                    ),

                salesRep:
                    rep
                        ? {
                            id:
                                order.sales_rep_user_id,

                            name:
                                rep.full_name ||
                                "مندوب",

                            avatarUrl:
                                rep.avatar_url ??
                                null,
                        }
                        : null,

                department:
                    department?.name ??
                    null,

                items:
                    items.map(
                        (item: any) => ({
                            id:
                                item.id,

                            productId:
                                item.product_id,

                            name:
                                item.product_name,

                            sku:
                                item.sku,

                            quantity:
                                Number(
                                    item.quantity ??
                                    0,
                                ),

                            listUnitPrice:
                                Number(
                                    item.list_unit_price ??
                                    0,
                                ),

                            soldUnitPrice:
                                Number(
                                    item.sold_unit_price ??
                                    0,
                                ),

                            lineTotal:
                                Number(
                                    item.line_total ??
                                    0,
                                ),
                        }),
                    ),
            });
        }

        return Array.from(
            buyerMap.values(),
        )
            .map(
                (buyer) => ({
                    contactId:
                        buyer.contactId,

                    name:
                        buyer.name,

                    lifecycleStage:
                        buyer.lifecycleStage,

                    orderCount:
                        buyer.orderCount,

                    productsCount:
                        buyer.productsCount,

                    lastPurchaseAt:
                        buyer.lastPurchaseAt,

                    currencies:
                        buyer.currencies,

                    discountByCurrency:
                        buyer.discountByCurrency,

                    reps:
                        Array.from(
                            buyer.reps.values(),
                        ),

                    departments:
                        Array.from(
                            buyer.departments,
                        ),

                    orders:
                        buyer.orders,
                }),
            )
            .sort(
                (a, b) =>
                    new Date(
                        b.lastPurchaseAt ??
                        0,
                    ).getTime() -
                    new Date(
                        a.lastPurchaseAt ??
                        0,
                    ).getTime(),
            );
    });