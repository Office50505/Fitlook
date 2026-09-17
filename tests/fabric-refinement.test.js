import assert from 'node:assert/strict';
import test from 'node:test';
import {fabricRefinementRequest,refineWithFallback} from '../server/utils/fabricRefinement.js';
const base={bytes:Buffer.from('verified'),model:'p-image-try-on',providerCostUsd:0.015,quality:'standard'};
const refined={bytes:Buffer.from('refined'),model:'p-image-edit',providerCostUsd:0.01};

test('refinement sends only the generated image and keeps safety checking enabled',()=>{
 const request=fabricRefinementRequest({imageUrl:'https://example.com/generated',garmentDescription:'black dress'});
 assert.deepEqual(request.input.images,['https://example.com/generated']);
 assert.equal(request.input.disable_safety_checker,false);
 assert.equal(request.input.turbo,false);
 assert.equal(request.input.aspect_ratio,'match_input_image');
 assert.throws(()=>fabricRefinementRequest({}),/required/);
});

test('only verified refinement replaces the base and aggregates generation cost',async()=>{
 const result=await refineWithFallback({base,refine:async value=>{assert.equal(value,base);return refined;},verify:async()=>({passed:true})});
 assert.equal(result.bytes,refined.bytes);assert.equal(result.providerCostUsd,0.025);
 assert.equal(result.model,'p-image-try-on + p-image-edit');assert.equal(base.quality,'standard');
});

test('mismatched refinement retains the already verified preview',async()=>{
 const result=await refineWithFallback({base,refine:async()=>refined,verify:async()=>({passed:false})});
 assert.equal(result.bytes,base.bytes);assert.equal(result.quality,'standard');assert.equal(result.providerCostUsd,0.025);
});

test('provider and checker outages retain the verified base rather than failing the whole request',async()=>{
 for(const stage of ['provider','checker']) {
  const result=await refineWithFallback({base,refine:async()=>{if(stage==='provider')throw Error('provider down');return refined;},verify:async()=>{throw Error('checker down');}});
  assert.equal(result.bytes,base.bytes);assert.equal(result.model,base.model);
 }
});
