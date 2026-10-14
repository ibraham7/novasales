import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConversionRules, validateQualityLevels, QUALITY_LEVELS, QUALITY_LEVEL_KEYS } from '../src/modules/integrations/conversion-model.ts';
import { attributionInput } from '../src/modules/integrations/attribution-input.ts';
test('reject duplicate stage classifications',()=>{
 const rule={stageId:'same',classification:'qualified_lead' as const};
 assert.throws(()=>validateConversionRules([rule,rule]),/مكررة/);
 validateConversionRules([rule]);
});
test('bounded attribution accepts click ids and explicit consent',()=>{
 const parsed=attributionInput.parse({gclid:'Google_test-1',utm_source:'google',consent:'granted'});
 assert.equal(parsed.consent,'granted');
 assert.equal(attributionInput.parse({}).consent,'unknown');
 assert.equal(attributionInput.parse({consent:'denied'}).consent,'denied');
});
test('reject arbitrary customer data and invalid identifiers',()=>{
 for(const input of [{phone:'+123'},{gclid:'<script>'},{gclid:'a'.repeat(257)},{consent:'yes'}])
  assert.equal(attributionInput.safeParse(input).success,false);
});
test('quality levels map to fixed scores and stay unique per pipeline',()=>{
 assert.deepEqual(QUALITY_LEVEL_KEYS.map(k=>QUALITY_LEVELS[k].score),[0,3,6,10]);
 const pipe=(id:string)=>id.startsWith('a')?'A':'B';
 validateQualityLevels([{stageId:'a1',qualityLevel:'good'},{stageId:'b1',qualityLevel:'good'},{stageId:'a2',qualityLevel:null}],pipe);
 assert.throws(()=>validateQualityLevels([{stageId:'a1',qualityLevel:'good'},{stageId:'a2',qualityLevel:'good'}],pipe),/أكثر من مرحلة/);
});
