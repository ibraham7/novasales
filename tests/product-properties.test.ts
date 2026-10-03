import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAttributes,type AttributeDefinition} from '../src/modules/commerce/product-attributes.ts';
import {filterProducts,EMPTY_PRODUCT_FILTERS} from '../src/modules/commerce/product-filters.ts';
const defs:AttributeDefinition[]=[{id:'yes',name:'متاح',kind:'boolean',scope:'product',options:[],is_price_floor:false},{id:'link',name:'رابط',kind:'url',scope:'product',options:[],is_price_floor:false},{id:'file',name:'ملف',kind:'file',scope:'product',options:[],is_price_floor:false}];
test('property values preserve false and reject unsafe links and string booleans',()=>{
 validateAttributes({yes:false,link:'https://example.com',file:'https://example.com/manual.pdf'},defs,'product');
 assert.throws(()=>validateAttributes({yes:'false'},defs,'product'));
 assert.throws(()=>validateAttributes({link:'javascript:alert(1)'},defs,'product'));
 assert.throws(()=>validateAttributes({file:'file:///etc/passwd'},defs,'product'));
});
test('boolean property filters distinguish false from missing value',()=>{
 const rows=[{id:'a',attributes:{yes:false}},{id:'b',attributes:{yes:true}},{id:'c',attributes:{}}];
 assert.deepEqual(filterProducts(rows,defs,{...EMPTY_PRODUCT_FILTERS,attributes:{yes:{values:['false']}}}).map(p=>p.id),['a']);
});
