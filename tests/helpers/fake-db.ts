/**
 * A small in-memory stand-in for the supabase client: the chain methods the app uses, applied to
 * arrays. `calls` records every operation, so tests can check that each query is scoped to one
 * organization.
 */
export type FakeCall = { table: string; op: string; filters: [string, string, unknown][] };

export function fakeDb(seed: Record<string, any[]> = {}, unique: Record<string, string[]> = {}) {
  const tables: Record<string, any[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const calls: FakeCall[] = [];
  let counter = 0;
  class Query {
    private table: string;
    private filters: ((row: any) => boolean)[] = [];
    private described: [string, string, unknown][] = [];
    private op: "select" | "upsert" | "update" | "delete" | "insert" = "select";
    private payload: any;
    private options: any;
    private wantsOne = false;
    private rangeFrom = 0;
    private rangeTo = Infinity;
    constructor(table: string) {
      this.table = table;
      tables[table] ??= [];
    }
    private add(op: string, column: string, value: unknown, test: (row: any) => boolean) {
      this.described.push([op, column, value]);
      this.filters.push(test);
      return this;
    }
    select() {
      return this;
    }
    eq(c: string, v: unknown) {
      return this.add("eq", c, v, (r) => r[c] === v);
    }
    in(c: string, vs: unknown[]) {
      return this.add("in", c, vs, (r) => vs.includes(r[c]));
    }
    gte(c: string, v: number | string) {
      return this.add("gte", c, v, (r) => r[c] != null && r[c] >= v);
    }
    is(c: string, v: unknown) {
      return this.add("is", c, v, (r) => (v === null ? r[c] == null : r[c] === v));
    }
    single() {
      this.wantsOne = true;
      return this;
    }
    maybeSingle() {
      this.wantsOne = true;
      return this;
    }
    not(c: string, op: string, v: unknown) {
      return this.add(`not.${op}`, c, v, (r) => !(op === "is" && v === null ? r[c] == null : r[c] === v));
    }
    or(expression: string) {
      return this.add("or", "*", expression, () => true);
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    range(from: number, to: number) {
      this.rangeFrom = from;
      this.rangeTo = to;
      return this;
    }
    insert(rows: any) {
      this.op = "insert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    upsert(rows: any, options: any) {
      this.op = "upsert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.options = options;
      return this;
    }
    update(patch: any) {
      this.op = "update";
      this.payload = patch;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    private matches() {
      return tables[this.table].filter((r) => this.filters.every((f) => f(r)));
    }
    private run() {
      const result = this.execute();
      if (this.wantsOne && !result.error) return { ...result, data: result.data?.[0] ?? null };
      return result;
    }
    private execute(): any {
      calls.push({ table: this.table, op: this.op, filters: this.described });
      const rows = tables[this.table];
      if (this.op === "select") {
        const hit = this.matches();
        return { data: hit.slice(this.rangeFrom, this.rangeTo + 1).map((r) => ({ ...r })), count: hit.length, error: null };
      }
      if (this.op === "update") {
        const hit = this.matches();
        hit.forEach((r) => Object.assign(r, this.payload));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (this.op === "delete") {
        const hit = new Set(this.matches());
        tables[this.table] = rows.filter((r) => !hit.has(r));
        return { data: [], error: null };
      }
      const inserted: any[] = [];
      for (const row of this.payload) {
        const keys = unique[this.table];
        const duplicate = keys && keys.every((k) => row[k] != null) && rows.some((r) => keys.every((k) => r[k] === row[k]));
        if (duplicate && this.options?.ignoreDuplicates) continue;
        const stored = { id: `id-${++counter}`, ...row };
        rows.push(stored);
        inserted.push({ ...stored });
      }
      return { data: inserted, error: null };
    }
    then(resolve: (value: any) => void, reject?: (reason: any) => void) {
      try {
        resolve(this.run());
      } catch (e) {
        reject?.(e);
      }
    }
  }
  return { tables, calls, from: (table: string) => new Query(table) };
}
