import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConversionRules } from '../src/modules/integrations/conversion-model.ts';
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
