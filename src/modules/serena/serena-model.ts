// Pure helpers for Serena, the AI sales assistant: date ranges, sales and profit per product,
// stock cover, privacy redaction and phone matching. No database or network access, so they are unit-tested.

export type DayRange = { from: string; to: string; fromIso: string; toIso: string; days: number };
const DAY = 86_400_000;
const isDay = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value));

/** Inclusive YYYY-MM-DD days (UTC). Defaults to the last 30 days; at most 400 days. */
export function dayRange(from?: unknown, to?: unknown, today = new Date()): DayRange {
  const end = isDay(to) ? to : today.toISOString().slice(0, 10);
  let start = isDay(from) ? from : new Date(Date.parse(end) - 29 * DAY).toISOString().slice(0, 10);
  if (Date.parse(start) > Date.parse(end)) start = end;
  if (Date.parse(end) - Date.parse(start) > 399 * DAY)
    start = new Date(Date.parse(end) - 399 * DAY).toISOString().slice(0, 10);
  const fromMs = Date.parse(`${start}T00:00:00Z`);
  const toMs = Date.parse(`${end}T00:00:00Z`) + DAY;
  return {
    from: start,
    to: end,
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    days: Math.round((toMs - fromMs) / DAY),
  };
}

/** The period of the same length just before a range, for comparisons. */
export function previousRange(range: DayRange): DayRange {
  const toMs = Date.parse(range.fromIso);
  const fromMs = toMs - range.days * DAY;
  return {
    from: new Date(fromMs).toISOString().slice(0, 10),
    to: new Date(toMs - DAY).toISOString().slice(0, 10),
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    days: range.days,
  };
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0)) || 0;

export type Order = {
  id: string;
  currency: string;
  total: unknown;
  discount_total?: unknown;
  contact_id?: string | null;
  confirmed_at: string;
};
export type OrderItem = {
  order_id: string;
  product_id: string | null;
  product_name: string;
  variant_label?: string | null;
  quantity: unknown;
  list_unit_price?: unknown;
  sold_unit_price?: unknown;
  line_total: unknown;
  attributes_snapshot?: Record<string, unknown> | null;
};
export type Product = {
  id: string;
  name: string;
  price: unknown;
  currency: string;
  is_active: boolean;
  attributes?: Record<string, unknown> | null;
};

/** Purchase cost of one unit: the variant value first, then the product value. Null when unknown. */
export function unitCost(
  costAttributeId: string | null | undefined,
  item: Pick<OrderItem, "attributes_snapshot">,
  product?: Pick<Product, "attributes">,
) {
  if (!costAttributeId) return null;
  const value =
    item.attributes_snapshot?.[costAttributeId] ?? product?.attributes?.[costAttributeId];
  const cost =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

/** Totals per currency: revenue, orders, units, customers and, where the cost is known, profit. */
export function salesTotals(
  orders: Order[],
  items: OrderItem[],
  products: Map<string, Product>,
  costAttributeId?: string | null,
) {
  const byOrder = new Map(orders.map((order) => [order.id, order]));
  const totals = new Map<
    string,
    {
      currency: string;
      revenue: number;
      discounts: number;
      orders: number;
      units: number;
      customers: Set<string>;
      costedRevenue: number;
      cost: number;
    }
  >();
  for (const order of orders) {
    const row = totals.get(order.currency) ?? {
      currency: order.currency,
      revenue: 0,
      discounts: 0,
      orders: 0,
      units: 0,
      customers: new Set<string>(),
      costedRevenue: 0,
      cost: 0,
    };
    row.revenue += num(order.total);
    row.discounts += num(order.discount_total);
    row.orders += 1;
    if (order.contact_id) row.customers.add(order.contact_id);
    totals.set(order.currency, row);
  }
  for (const item of items) {
    const order = byOrder.get(item.order_id);
    if (!order) continue;
    const row = totals.get(order.currency)!;
    row.units += num(item.quantity);
    const cost = unitCost(
      costAttributeId,
      item,
      item.product_id ? products.get(item.product_id) : undefined,
    );
    if (cost !== null) {
      row.cost += cost * num(item.quantity);
      row.costedRevenue += num(item.line_total);
    }
  }
  return [...totals.values()].map(({ customers, costedRevenue, cost, ...row }) => ({
    ...row,
    revenue: round(row.revenue),
    discounts: round(row.discounts),
    customers: customers.size,
    averageOrder: row.orders ? round(row.revenue / row.orders) : 0,
    // Profit only covers lines whose cost is known; costCoverage says how much of the revenue that is.
    profit: costedRevenue ? round(costedRevenue - cost) : null,
    marginPercent: costedRevenue ? round(((costedRevenue - cost) / costedRevenue) * 100, 1) : null,
    costCoveragePercent: row.revenue ? round((costedRevenue / row.revenue) * 100, 1) : 0,
  }));
}

/** Per product: units, revenue, discount, profit, stock and how many days the stock lasts at this pace. */
export function productPerformance(input: {
  orders: Order[];
  items: OrderItem[];
  products: Product[];
  stock: Map<string, number>;
  days: number;
  costAttributeId?: string | null;
}) {
  const byOrder = new Map(input.orders.map((order) => [order.id, order]));
  const products = new Map(input.products.map((product) => [product.id, product]));
  type Row = {
    productId: string | null;
    name: string;
    currency: string;
    units: number;
    revenue: number;
    listValue: number;
    orders: Set<string>;
    customers: Set<string>;
    cost: number;
    costedRevenue: number;
    variants: Map<string, number>;
    firstSale: string;
    lastSale: string;
  };
  const rows = new Map<string, Row>();
  for (const item of input.items) {
    const order = byOrder.get(item.order_id);
    if (!order) continue;
    const key = `${item.product_id ?? item.product_name}|${order.currency}`;
    const row = rows.get(key) ?? {
      productId: item.product_id,
      name: products.get(item.product_id ?? "")?.name ?? item.product_name,
      currency: order.currency,
      units: 0,
      revenue: 0,
      listValue: 0,
      orders: new Set<string>(),
      customers: new Set<string>(),
      cost: 0,
      costedRevenue: 0,
      variants: new Map<string, number>(),
      firstSale: order.confirmed_at,
      lastSale: order.confirmed_at,
    };
    const quantity = num(item.quantity);
    row.units += quantity;
    row.revenue += num(item.line_total);
    row.listValue += num(item.list_unit_price ?? item.sold_unit_price) * quantity;
    row.orders.add(order.id);
    if (order.contact_id) row.customers.add(order.contact_id);
    if (item.variant_label)
      row.variants.set(item.variant_label, (row.variants.get(item.variant_label) ?? 0) + quantity);
    const cost = unitCost(input.costAttributeId, item, products.get(item.product_id ?? ""));
    if (cost !== null) {
      row.cost += cost * quantity;
      row.costedRevenue += num(item.line_total);
    }
    if (order.confirmed_at < row.firstSale) row.firstSale = order.confirmed_at;
    if (order.confirmed_at > row.lastSale) row.lastSale = order.confirmed_at;
    rows.set(key, row);
  }
  const sold = [...rows.values()].map((row) => {
    const stock = row.productId ? (input.stock.get(row.productId) ?? null) : null;
    const perDay = row.units / Math.max(1, input.days);
    return {
      productId: row.productId,
      name: row.name,
      currency: row.currency,
      unitsSold: round(row.units),
      revenue: round(row.revenue),
      orders: row.orders.size,
      customers: row.customers.size,
      averageSoldPrice: row.units ? round(row.revenue / row.units) : 0,
      discountPercent: row.listValue
        ? round(((row.listValue - row.revenue) / row.listValue) * 100, 1)
        : 0,
      profit: row.costedRevenue ? round(row.costedRevenue - row.cost) : null,
      marginPercent: row.costedRevenue
        ? round(((row.costedRevenue - row.cost) / row.costedRevenue) * 100, 1)
        : null,
      unitsPerDay: round(perDay, 2),
      stock,
      daysOfStockLeft: stock !== null && perDay > 0 ? Math.floor(stock / perDay) : null,
      topVariants: [...row.variants.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, units]) => ({ label, units: round(units) })),
      firstSale: row.firstSale.slice(0, 10),
      lastSale: row.lastSale.slice(0, 10),
    };
  });
  const soldIds = new Set(sold.map((row) => row.productId));
  // Active products with stock that sold nothing in the period: money sitting on the shelf.
  const unsold = input.products
    .filter(
      (product) =>
        product.is_active && !soldIds.has(product.id) && (input.stock.get(product.id) ?? 0) > 0,
    )
    .map((product) => ({
      productId: product.id,
      name: product.name,
      price: round(num(product.price)),
      currency: product.currency,
      stock: input.stock.get(product.id) ?? 0,
      unitCost: unitCost(input.costAttributeId, {}, product),
    }));
  return { sold: sold.sort((a, b) => b.revenue - a.revenue), unsold };
}

/** Customer messages go to the AI provider without phone numbers, emails or links. */
export function redact(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[إيميل]")
    .replace(/https?:\/\/\S+/g, "[رابط]")
    .replace(/(?:\+|00)?\d[\d\s().-]{6,}\d/g, "[رقم]");
}

export const digitsOnly = (value: string) =>
  value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/\D/g, "")
    .replace(/^00/, "");

/** True when a WhatsApp sender is one of the numbers allowed to talk to Serena (country code optional on one side). */
export function phoneAllowed(sender: string, allowed: string[]) {
  const from = digitsOnly(sender);
  if (from.length < 7) return false;
  return allowed
    .map(digitsOnly)
    .some(
      (number) =>
        number.length >= 7 &&
        (number === from ||
          (Math.min(number.length, from.length) >= 9 &&
            (number.endsWith(from) || from.endsWith(number)))),
    );
}

/** "1234" style hint so the admin can recognise the saved key without seeing it. */
export const keyHint = (key: string) => key.trim().slice(-4);

/** Models that can answer chat requests, the fast "flash" ones first. */
export function chatModels(
  models: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[],
) {
  return models
    .filter(
      (model) =>
        model.supportedGenerationMethods?.includes("generateContent") &&
        /gemini/i.test(model.name) &&
        !/embedding|image|tts|audio|live|vision/i.test(model.name),
    )
    .map((model) => ({
      id: model.name.replace(/^models\//, ""),
      label: model.displayName ?? model.name.replace(/^models\//, ""),
    }))
    .sort(
      (a, b) =>
        Number(/flash/i.test(b.id)) - Number(/flash/i.test(a.id)) || a.id.localeCompare(b.id),
    );
}
