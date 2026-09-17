import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVerifiedProductOutfit } from '../server/utils/productOutfitTryOn.js';
import { productOutfitEditRequest } from '../server/utils/productOutfitTryOn.js';
const garment=Buffer.from('complete outfit'),person=Buffer.from('shopper');
const product={name:'Cotton Kurta and Pant with Dupatta Set'};
const prepare=async()=>({garmentBytes:Buffer.from('cropped top'),garmentDescription:'Navy long kurta, trousers and beige-bordered dupatta'});

test('complete catalog outfit keeps full reference, disables turbo and verifies every piece',async()=>{
 let checked=false;
 const result=await generateVerifiedProductOutfit({product,garment,person,prepare,
  generate:async(args)=>{
   assert.equal(args.garment,garment);
   assert.equal(args.promptKey,'full_outfit');
   const request=productOutfitEditRequest({personUrl:'person',garmentUrl:'garment',...args});
   assert.equal(request.input.turbo,false);
   assert.equal(request.model,'p-image-edit');
   assert.deepEqual(request.input.images,['garment','person']);
   assert.equal(request.input.disable_safety_checker,false);
   assert.match(request.input.prompt,/Edit image 2/);
   assert.match(request.input.prompt,/trousers and beige-bordered dupatta/);
   return {bytes:Buffer.from('good outfit'),providerCostUsd:0.015};
  },verify:async(args)=>{checked=true;assert.equal(args.garment,garment);assert.equal(args.person,person);assert.equal(args.outfitScope,'full_outfit');return {passed:true}}});
 assert.equal(checked,true);assert.equal(result.bytes.toString(),'good outfit');
});

test('wrong outfit retries original references with correction and accumulates cost',async()=>{
 let calls=0;
 const differences=[{check:'construction',expected:'kurta pants dupatta',observed:'blazer jeans'}];
 const result=await generateVerifiedProductOutfit({product,garment,person,prepare,
 generate:async(args)=>{calls++;assert.equal(args.garment,garment);if(calls===2)assert.deepEqual(args.feedback.differences,differences);return {bytes:Buffer.from(String(calls)),providerCostUsd:0.015}},
 verify:async()=>({passed:calls===2,failedChecks:['construction'],differences})});
 assert.equal(calls,2);assert.equal(result.providerCostUsd,0.03);assert.equal(result.bytes.toString(),'2');
});

test('two mismatches never return an outfit that callers could save',async()=>{
 let calls=0;
 await assert.rejects(generateVerifiedProductOutfit({product,garment,person,prepare,generate:async()=>{calls++;return {bytes:Buffer.from('wrong')}} ,verify:async()=>({passed:false})}),/No result was saved/);
 assert.equal(calls,2);
});

test('preparation outage prevents provider generation',async()=>{
 let called=false;
 await assert.rejects(generateVerifiedProductOutfit({product,garment,person,prepare:async()=>{throw Error('unavailable')},generate:async()=>{called=true}}),/unavailable/);
 assert.equal(called,false);
});
