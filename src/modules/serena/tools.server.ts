// The data Serena can read, always limited to one organization. Each tool returns compact JSON for the model.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reportRows } from "@/modules/commerce/reports-model";
import type { GeminiTool } from "./gemini.server";
import {
  dayRange,
  previousRange,
  productPerformance,
  redact,
  salesTotals,
  type DayRange,
  type Order,
  type OrderItem,
  type Product,
} from "./serena-model";

const db = supabaseAdmin as any;
const range = {
  from: { type: "string", description: "First day, YYYY-MM-DD" },
  to: { type: "string", description: "Last day, YYYY-MM-DD" },
};

export const serenaTools: GeminiTool[] = [
  {
    name: "sales_summary",
    description:
      "Confirmed sales for a date range and the previous period of the same length: revenue, orders, units, customers, average order, discounts and profit (when product costs are set), per currency.",
    parameters: { type: "object", properties: range },
  },
  {
    name: "product_performance",
    description:
      "Per product for a date range: units sold, revenue, orders, customers, average price, discount, profit and margin, sales per day, current stock, days of stock left, best variants (size, colour...). Also lists active products with stock that sold nothing (slow movers).",
    parameters: {
      type: "object",
      properties: {
        ...range,
        limit: { type: "integer", description: "Products to return, default 40, max 100" },
      },
    },
  },
  {
    name: "stock_status",
    description:
      "Current stock of every active product with price, unit cost when known, and batches that expire within 60 days.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "customer_messages",
    description:
      "Recent WhatsApp messages written by customers (inbound text only, phone numbers and emails removed) to learn what customers ask for, complain about or cannot find. Use search to look for a word, for example a product, colour or size.",
    parameters: {
      type: "object",
      properties: {
        ...range,
        search: { type: "string", description: "Optional word or phrase to find in the messages" },
        limit: { type: "integer", description: "Messages to return, default 150, max 400" },
      },
    },
  },
  {
    name: "crm_overview",
    description:
      "Leads and opportunities for a date range: new leads by source, opportunities by stage, won and lost, and the products customers said they were interested in.",
    parameters: { type: "object", properties: range },
  },
];

async function confirmedOrders(organizationId: string, period: DayRange) {
  return (await reportRows(() =>
    db
      .from("sales_orders")
      .select("id,currency,total,discount_total,contact_id,confirmed_at")
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .gte("confirmed_at", period.fromIso)
      .lt("confirmed_at", period.toIso)
      .order("confirmed_at")
      .order("id"),
  )) as Order[];
}

async function orderItems(organizationId: string, orders: Order[]) {
  const items: OrderItem[] = [];
  for (let i = 0; i < orders.length; i += 100) {
    const ids = orders.slice(i, i + 100).map((order) => order.id);
    items.push(
      ...(await reportRows(() =>
        db
          .from("sales_order_items")
          .select(
            "id,order_id,product_id,product_name,variant_label,quantity,list_unit_price,sold_unit_price,line_total,attributes_snapshot",
          )
          .eq("organization_id", organizationId)
          .in("order_id", ids)
          .order("id"),
      )),
    );
  }
  return items;
}

async function catalog(organizationId: string) {
  const [products, inventory] = await Promise.all([
    reportRows(() =>
      db
        .from("sales_products")
        .select("id,name,price,currency,is_active,attributes")
        .eq("organization_id", organizationId)
        .order("id"),
    ),
    reportRows(() =>
      db
        .from("sales_inventory")
        .select("product_id,quantity")
        .eq("organization_id", organizationId)
        .order("product_id"),
    ),
  ]);
  return {
    products: products as Product[],
    stock: new Map<string, number>(
      inventory.map((row: any) => [row.product_id, Number(row.quantity) || 0]),
    ),
  };
}

export async function runSerenaTool(
  organizationId: string,
  costAttributeId: string | null,
  name: string,
  args: Record<string, unknown>,
) {
  const period = dayRange(args.from, args.to);
  if (name === "sales_summary") {
    const before = previousRange(period);
    const [{ products }, orders, previousOrders] = await Promise.all([
      catalog(organizationId),
      confirmedOrders(organizationId, period),
      confirmedOrders(organizationId, before),
    ]);
    const byId = new Map(products.map((product) => [product.id, product]));
    const [items, previousItems] = await Promise.all([
      orderItems(organizationId, orders),
      orderItems(organizationId, previousOrders),
    ]);
    return {
      period: { from: period.from, to: period.to, days: period.days },
      totals: salesTotals(orders, items, byId, costAttributeId),
      previousPeriod: {
        from: before.from,
        to: before.to,
        totals: salesTotals(previousOrders, previousItems, byId, costAttributeId),
      },
      costKnown: Boolean(costAttributeId),
    };
  }
  if (name === "product_performance") {
    const [{ products, stock }, orders] = await Promise.all([
      catalog(organizationId),
      confirmedOrders(organizationId, period),
    ]);
    const items = await orderItems(organizationId, orders);
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 40));
    const result = productPerformance({
      orders,
      items,
      products,
      stock,
      days: period.days,
      costAttributeId,
    });
    return {
      period: { from: period.from, to: period.to, days: period.days },
      costKnown: Boolean(costAttributeId),
      sold: result.sold.slice(0, limit),
      soldProducts: result.sold.length,
      unsold: result.unsold.slice(0, 50),
      unsoldProducts: result.unsold.length,
    };
  }
  if (name === "stock_status") {
    const { products, stock } = await catalog(organizationId);
    const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const batches = await reportRows(() =>
      db
        .from("sales_stock_batches")
        .select("product_id,batch_code,expires_on,quantity")
        .eq("organization_id", organizationId)
        .gt("quantity", 0)
        .not("expires_on", "is", null)
        .lte("expires_on", soon)
        .order("expires_on")
        .order("id"),
    );
    const names = new Map(products.map((product) => [product.id, product.name]));
    return {
      products: products
        .filter((product) => product.is_active)
        .slice(0, 300)
        .map((product) => ({
          name: product.name,
          price: Number(product.price) || 0,
          currency: product.currency,
          stock: stock.get(product.id) ?? 0,
          unitCost:
            costAttributeId && typeof product.attributes?.[costAttributeId] === "number"
              ? product.attributes[costAttributeId]
              : null,
        })),
      expiringSoon: batches.slice(0, 100).map((batch: any) => ({
        product: names.get(batch.product_id) ?? batch.product_id,
        batch: batch.batch_code,
        expiresOn: batch.expires_on,
        quantity: Number(batch.quantity),
      })),
    };
  }
  if (name === "customer_messages") {
    const limit = Math.min(400, Math.max(1, Number(args.limit) || 150));
    const search =
      typeof args.search === "string"
        ? args.search
            .trim()
            .slice(0, 60)
            .replace(/[%_,()]/g, " ")
        : "";
    let query = db
      .from("msg_messages")
      .select("content,created_at,session_id", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("direction", "inbound")
      .eq("is_internal", false)
      .not("content", "is", null)
      .gte("created_at", period.fromIso)
      .lt("created_at", period.toIso)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (search) query = query.ilike("content", `%${search}%`);
    const { data, count, error } = await query;
    if (error) throw new Error("تعذر قراءة المحادثات");
    // Sessions become short letters, so the model can tell customers apart without knowing who they are.
    const sessions = new Map<string, string>();
    const customer = (id: string) =>
      sessions.get(id) ?? (sessions.set(id, `C${sessions.size + 1}`), sessions.get(id)!);
    return {
      period: { from: period.from, to: period.to },
      search: search || null,
      totalMatching: count ?? data?.length ?? 0,
      messages: (data ?? []).map((message: any) => ({
        day: String(message.created_at).slice(0, 10),
        customer: customer(message.session_id),
        text: redact(String(message.content)).slice(0, 400),
      })),
    };
  }
  if (name === "crm_overview") {
    const pipelines = await reportRows(() =>
      db.from("crm_pipelines").select("id").eq("organization_id", organizationId).order("id"),
    );
    const [leads, opportunities, stages] = await Promise.all([
      reportRows(() =>
        db
          .from("crm_leads")
          .select("id,source,status,opened_at,converted_at")
          .eq("organization_id", organizationId)
          .gte("opened_at", period.fromIso)
          .lt("opened_at", period.toIso)
          .order("id"),
      ),
      reportRows(() =>
        db
          .from("opp_opportunities")
          .select("id,stage_id,outcome,product_interest,value,currency,opened_at,closed_at")
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .gte("opened_at", period.fromIso)
          .lt("opened_at", period.toIso)
          .order("id"),
      ),
      pipelines.length
        ? reportRows(() =>
            db
              .from("crm_pipeline_stages")
              .select("id,name,is_won,is_lost")
              .in(
                "pipeline_id",
                pipelines.map((pipeline: any) => pipeline.id),
              )
              .order("id"),
          )
        : Promise.resolve([]),
    ]);
    const count = (values: (string | null | undefined)[]) => {
      const map = new Map<string, number>();
      for (const value of values) {
        const key = (value ?? "").trim() || "غير محدد";
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([label, total]) => ({ label, total }));
    };
    const stageById = new Map(stages.map((stage: any) => [stage.id, stage]));
    return {
      period: { from: period.from, to: period.to },
      newLeads: leads.length,
      leadsBySource: count(leads.map((lead: any) => lead.source)),
      convertedLeads: leads.filter((lead: any) => lead.converted_at).length,
      opportunities: opportunities.length,
      byStage: count(
        opportunities.map((opportunity: any) => stageById.get(opportunity.stage_id)?.name),
      ),
      won: opportunities.filter(
        (opportunity: any) =>
          stageById.get(opportunity.stage_id)?.is_won || opportunity.outcome === "won",
      ).length,
      lost: opportunities.filter(
        (opportunity: any) =>
          stageById.get(opportunity.stage_id)?.is_lost || opportunity.outcome === "lost",
      ).length,
      productInterest: count(
        opportunities.map((opportunity: any) => opportunity.product_interest).filter(Boolean),
      ),
    };
  }
  throw new Error(`Unknown tool ${name}`);
}
