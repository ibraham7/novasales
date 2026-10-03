import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.LEAD_DB_MODULE);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table sales_products(id uuid primary key, organization_id uuid);
create table sales_inventory(product_id uuid primary key references sales_products(id) on delete cascade, organization_id uuid, quantity numeric);
create table sales_product_variants(id uuid primary key, product_id uuid references sales_products(id), organization_id uuid);
create table sales_stock_batches(id uuid primary key, product_id uuid references sales_products(id), variant_id uuid references sales_product_variants(id), organization_id uuid, quantity numeric);
create table sales_order_items(product_id uuid references sales_products(id));
create table sales_inventory_movements(product_id uuid references sales_products(id));
`);
await db.exec(await readFile(new URL('../migrations/20261003200010_delete_unused_sales_product.sql', import.meta.url), 'utf8'));
const org = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
async function product(quantity = 0) {
  const { rows: [p] } = await db.query('insert into sales_products values(gen_random_uuid(),$1) returning id', [org]);
  await db.query('insert into sales_inventory values($1,$2,$3)', [p.id, org, quantity]);
  const { rows: [v] } = await db.query('insert into sales_product_variants values(gen_random_uuid(),$1,$2) returning id', [p.id, org]);
  await db.query('insert into sales_stock_batches values(gen_random_uuid(),$1,$2,$3,$4)', [p.id,v.id,org,quantity]);
  return p.id;
}
const remove = (id, organization = org) => db.query('select delete_unused_sales_product($1,$2)', [organization,id]);
const exists = async (id) => (await db.query('select count(*)::int as n from sales_products where id=$1',[id])).rows[0].n;
const unused = await product();
await assert.rejects(remove(unused,other), /المنتج غير موجود/);
assert.equal(await exists(unused),1);
await remove(unused);
assert.equal(await exists(unused),0);
for (const table of ['sales_inventory','sales_stock_batches','sales_product_variants'])
  assert.equal((await db.query(`select count(*)::int as n from ${table} where product_id=$1`,[unused])).rows[0].n,0);
for (const table of ['sales_order_items','sales_inventory_movements']) {
  const id = await product();
  await db.query(`insert into ${table} values($1)`, [id]);
  await assert.rejects(remove(id), /مبيعات أو حركات مخزون/);
  assert.equal(await exists(id),1);
}
const stocked = await product(5);
await assert.rejects(remove(stocked), /كمية في المخزون/);
assert.equal(await exists(stocked),1);
await db.query('update sales_inventory set quantity=0 where product_id=$1',[stocked]);
await assert.rejects(remove(stocked), /كمية في المخزون/);
// A late FK failure rolls back every preceding deletion inside the RPC.
await db.exec('create table additional_reference(product_id uuid references sales_products(id));');
const referenced = await product();
await db.query('insert into additional_reference values($1)',[referenced]);
await assert.rejects(remove(referenced));
for (const table of ['sales_inventory','sales_stock_batches','sales_product_variants'])
  assert.equal((await db.query(`select count(*)::int as n from ${table} where product_id=$1`,[referenced])).rows[0].n,1);
for (const role of ['anon','authenticated'])
  assert.equal((await db.query("select has_function_privilege($1,'delete_unused_sales_product(uuid,uuid)','execute') as ok",[role])).rows[0].ok,false);
assert.equal((await db.query("select has_function_privilege('service_role','delete_unused_sales_product(uuid,uuid)','execute') as ok")).rows[0].ok,true);
console.log('PASS: scoped deletion, empty variants/lots cleanup, stock and history protection, full rollback, server-only permissions');
await db.close();
