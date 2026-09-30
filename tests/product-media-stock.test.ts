import test from 'node:test';
import assert from 'node:assert/strict';
import {variantStock,attributeStock} from '../src/modules/commerce/stock-summary.ts';
import {inventoryValues,currencyTotals,CURRENCY_CODES} from '../src/modules/commerce/currencies.ts';

test('stock summary keeps size/color combinations and excludes expired batches',()=>{
 const p={sales_product_variants:[{id:'a',label:'أحمر / M',attributes:{color:'أحمر',size:'M'}},{id:'b',label:'أحمر / L',attributes:{color:'أحمر',size:'L'}},{id:'c',label:'أزرق / M',attributes:{color:'أزرق',size:'M'}}],sales_stock_batches:[{variant_id:'a',quantity:5,expires_on:null},{variant_id:'a',quantity:3,expires_on:'2026-10-01'},{variant_id:'b',quantity:2,expires_on:null},{variant_id:'c',quantity:6,expires_on:'2026-09-01'}]};
 assert.deepEqual(variantStock(p,'2026-09-30').map((v:any)=>v.quantity),[8,2,0]);
 const result=attributeStock(p,[{id:'color',name:'اللون'},{id:'size',name:'المقاس'}],'2026-09-30');
 assert.deepEqual(result[0].values,[{value:'أحمر',quantity:10},{value:'أزرق',quantity:0}]);
 assert.deepEqual(result[1].values,[{value:'M',quantity:8},{value:'L',quantity:2}]);
});
test('currencies stay separate and expiry does not inflate inventory value',()=>{
 assert.ok(CURRENCY_CODES.includes('TRY'));assert.ok(CURRENCY_CODES.includes('SYP'));
 assert.deepEqual(inventoryValues([{currency:'USD',price:10,sales_stock_batches:[{quantity:2,expires_on:null}]},{currency:'TRY',price:100,sales_stock_batches:[{quantity:3,expires_on:null},{quantity:8,expires_on:'2026-09-01'}]}],'2026-09-30'),{USD:20,TRY:300});
 assert.deepEqual(currencyTotals([{revenueByCurrency:{USD:20,TRY:30}},{revenueByCurrency:{TRY:80}}],'revenueByCurrency'),{USD:20,TRY:110});
});
