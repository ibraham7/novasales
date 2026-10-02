import test from 'node:test';import assert from 'node:assert/strict';import {planPrice,billingMoney,usageLimit} from '../src/modules/billing/billing-model.ts';
test('billing prices respect monthly quarterly and yearly periods',()=>{const p={price_monthly:10,price_quarterly:25,price_yearly:90};assert.equal(planPrice(p,'monthly'),10);assert.equal(planPrice(p,'quarterly'),25);assert.equal(planPrice(p,'yearly'),90);});
test('undefined limit differs from unlimited and zero',()=>{assert.equal(usageLimit(undefined),'غير محدد');assert.equal(usageLimit(-1),'غير محدود');assert.equal(usageLimit(0),'0');});
test('currency formatting does not add a dollar sign to EUR',()=>{assert.equal(billingMoney(20,'EUR').includes('$'),false);assert.ok(billingMoney(20,'EUR').includes('€'));});
