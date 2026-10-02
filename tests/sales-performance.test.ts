import { test } from "node:test";
import assert from "node:assert/strict";
import { visiblePerformanceRep, responseSamples, performanceSortKey, performanceLeader } from "../src/modules/commerce/performance-model.ts";

test("performance visibility fails closed for own and department scopes", () => {
 const users=new Set(["u1"]);
 assert.equal(visiblePerformanceRep("u2","own","u1",users),false);
 assert.equal(visiblePerformanceRep("u1","own","u1",users),true);
 assert.equal(visiblePerformanceRep("u2","department","u1",users),false);
 assert.equal(visiblePerformanceRep("u1","department","u1",new Set()),false);
 assert.equal(visiblePerformanceRep("u2","all","u1",users),true);
});
test("response uses first successful attributable outbound after opening, not failures, internal, automated or future messages",()=>{
 const opp={id:"o",owner_agent_id:"u1",opened_at:"2026-10-01T10:00:00Z"};
 const base={session_id:"s",sent_by_user_id:"u1",direction:"outbound",status:"sent",is_internal:false,created_at:"2026-10-01T10:05:00Z"};
 const messages=[{...base,created_at:"2026-10-01T09:00:00Z"},{...base,status:"failed",created_at:"2026-10-01T10:01:00Z"},{...base,is_internal:true,created_at:"2026-10-01T10:02:00Z"},{...base,sent_by_user_id:null,created_at:"2026-10-01T10:03:00Z"},{...base,sent_by_user_id:"u2",created_at:"2026-10-01T10:04:00Z"},base,{...base,created_at:"2026-10-01T10:07:00Z"},{...base,created_at:"2026-10-04T10:00:00Z"}];
 assert.deepEqual(responseSamples([opp],[{opportunity_id:"o",session_ref:"s"}],messages,"2026-10-03T00:00:00Z").get("u1"),[5]);
 assert.equal(responseSamples([opp],[],messages,"2026-10-03T00:00:00Z").size,0);
});
test("mixed currency ranking falls back to counts and ties/zero never award leader",()=>{
 assert.equal(performanceSortKey("revenue",true),"orders");
 assert.equal(performanceSortKey("revenue",false),"revenue");
 assert.equal(performanceLeader([{confirmedOrders:0},{confirmedOrders:0}],"orders"),false);
 assert.equal(performanceLeader([{confirmedOrders:2},{confirmedOrders:2}],"orders"),false);
 assert.equal(performanceLeader([{confirmedOrders:3},{confirmedOrders:2}],"orders"),true);
 assert.equal(performanceLeader([{avgResponseMinutes:null}],"response"),false);
 assert.equal(performanceLeader([{avgResponseMinutes:0},{avgResponseMinutes:1}],"response"),true);
});
