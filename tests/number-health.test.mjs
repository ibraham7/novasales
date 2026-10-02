import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
const module = { exports: {} };
new Function('require','module','exports',ts.transpileModule(readFileSync(new URL('../src/modules/risk/query.server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(require,module,module.exports);
const { checkedDb, readAllRows } = module.exports;
test('reads every row beyond API page caps without skipping short pages', async () => {
 const data=Array.from({length:1203},(_,id)=>({id}));
 const ranges=[];
 const rows=await readAllRows(()=>({range:async (from,to)=>{ranges.push(from);return {data:data.slice(from,Math.min(to+1,from+127)),error:null};}}));
 assert.deepEqual(rows,data);assert.equal(ranges.at(-1),1203);
});
test('empty table is empty, but read failures are never reported as zero', async () => {
 assert.deepEqual(await readAllRows(()=>({range:async()=>({data:[],error:null})})),[]);
 await assert.rejects(readAllRows(()=>({range:async()=>({data:null,error:{code:'42P01'}})})),/تعذر/);
});
test('checked queries preserve chained results and reject failed reads/writes',async()=>{
 const query=(error)=>({select(){return this},update(){return this},eq(){return this},then(resolve,reject){return Promise.resolve({data:error?null:[{id:1}],error}).then(resolve,reject)}});
 const good=checkedDb({from:()=>query(null)});
 assert.deepEqual((await good.from('table').select('*').eq('id',1)).data,[{id:1}]);
 const bad=checkedDb({from:()=>query({code:'23514'})});
 await assert.rejects(async()=>await bad.from('table').update({}).eq('id',1),/تعذر/);
});
const accessModule={exports:{}};
new Function('require','module','exports',ts.transpileModule(readFileSync(new URL('../src/modules/channels/whatsapp/move-access.server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(require,accessModule,accessModule.exports);
const {resolveMoveOrganization}=accessModule.exports;
test('super admin moves accounts in their tenant, while others stay scoped and need permission',async()=>{
 const workspace={userId:'admin',organizationId:'current'};
 const adminDb={rpc:async()=>({data:true,error:null}),from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{organization_id:'target'},error:null})})};
 assert.equal(await resolveMoveOrganization(adminDb,workspace,'number',async()=>assert.fail('unneeded org permission')),'target');
 let checked=0;
 assert.equal(await resolveMoveOrganization({rpc:async()=>({data:false,error:null})},workspace,'number',async()=>{checked++}),'current');
 assert.equal(checked,1);
 await assert.rejects(resolveMoveOrganization({rpc:async()=>({data:false,error:null})},workspace,'number',async()=>{throw new Error('denied')}),/denied/);
 await assert.rejects(resolveMoveOrganization({rpc:async()=>({data:null,error:{}})},workspace,'number',async()=>{}),/تعذر/);
});
