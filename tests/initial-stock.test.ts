import test from 'node:test';import assert from 'node:assert/strict';
import {initialStockPayload,type InitialVariantDraft} from '../src/modules/commerce/initial-stock.ts';
const row:InitialVariantDraft={key:'v',label:'خمري / M',attributes:{size:'M'},batches:[{key:'b1',batchCode:'LOT-1',expiresOn:'2026-10-10',quantity:'20'},{key:'b2',batchCode:'LOT-2',expiresOn:'2026-12-10',quantity:'20'}]};
test('initial inventory preserves two expiration batches instead of collapsing into forty',()=>{const payload=initialStockPayload([row]);assert.equal(payload[0].batches.length,2);assert.deepEqual(payload[0].batches.map(b=>[b.quantity,b.expiresOn]),[[20,'2026-10-10'],[20,'2026-12-10']]);});
test('draft inventory rejects duplicate lots, invalid dates and fractional precision',()=>{
 assert.throws(()=>initialStockPayload([{...row,batches:[row.batches[0],row.batches[0]]}]));
 for(const change of [{quantity:''},{quantity:'-1'},{quantity:'0.0001'},{expiresOn:'2026-02-30'}])assert.throws(()=>initialStockPayload([{...row,batches:[{...row.batches[0],...change}]}]));
});
test('service or stockless product may be created with no initial inventory',()=>assert.deepEqual(initialStockPayload([]),[]));
