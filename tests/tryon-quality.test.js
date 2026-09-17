import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {parseQualityVerdict,generateVerifiedTryOn,verifyTryOn} from '../server/utils/tryOnQuality.js';
const good={garmentType:true,color:true,construction:true,patternAndDetails:true,fastenings:true,personPreserved:true,confidence:0.98};
test('each visual mismatch and uncertain matches fail the quality gate',()=>{
 assert.equal(parseQualityVerdict(JSON.stringify(good)).passed,true);
 for(const key of Object.keys(good).filter(key=>key!=='confidence')) assert.equal(parseQualityVerdict(JSON.stringify({...good,[key]:false})).passed,false);
 assert.equal(parseQualityVerdict(JSON.stringify({...good,confidence:0.7})).passed,false);
 for(const output of ['{}','not json',JSON.stringify({...good,color:'true'}),JSON.stringify({...good,confidence:2})]) assert.throws(()=>parseQualityVerdict(output));
});
test('mismatch retries once and returns only the verified result with total generation cost',async()=>{
 let calls=0;
 const result=await generateVerifiedTryOn({generate:async()=>({attempt:++calls,providerCostUsd:0.01}),verify:async result=>({passed:result.attempt===2})});
 assert.equal(calls,2); assert.equal(result.attempt,2);assert.equal(result.providerCostUsd,0.02);
});
test('repeated mismatch throws before caller can save or report success',async()=>{
 let calls=0;
 await assert.rejects(generateVerifiedTryOn({generate:async()=>{calls++;return {};},verify:async()=>({passed:false})}),/could not preserve/);
 assert.equal(calls,2);
});
test('checker outage fails closed without a second paid generation',async()=>{
 let calls=0;
 await assert.rejects(generateVerifiedTryOn({generate:async()=>{calls++;return {};},verify:async()=>{throw Error('checker down');}}),/checker down/);
 assert.equal(calls,1);
});
test('vision request preserves reference order and parses actual provider envelope without network',async()=>{
 const previous=process.env.FAL_KEY;process.env.FAL_KEY='test-only';
 try {
 const buffers=await Promise.all(['white','black','red'].map(background=>sharp({create:{width:16,height:16,channels:3,background}}).png().toBuffer()));
 const verdict=await verifyTryOn({garment:buffers[0],person:buffers[1],result:buffers[2],fetchImpl:async(url,options)=>{
 assert.equal(url,'https://fal.run/openrouter/router/vision');
 const body=JSON.parse(options.body);assert.equal(body.image_urls.length,3);
 const colors=await Promise.all(body.image_urls.map(async uri=>[...(await sharp(Buffer.from(uri.split(',')[1],'base64')).raw().toBuffer()).subarray(0,3)]));
 assert.ok(colors[0].every(value=>value>240));assert.ok(colors[1].every(value=>value<10));assert.ok(colors[2][0]>240);
 return {ok:true,json:async()=>({output:JSON.stringify(good)})};
 }});assert.equal(verdict.passed,true);
 }finally{if(previous===undefined)delete process.env.FAL_KEY;else process.env.FAL_KEY=previous;}
});

test('retry receives the specific visible mismatch from the checker', async () => {
 const calls=[];
 const difference={check:'construction',expected:'thin straps and V-neck',observed:'short sleeves and round neck'};
 const verdict=parseQualityVerdict(JSON.stringify({...good,construction:false,differences:[difference]}));
 await generateVerifiedTryOn({
  generate:async context=>{calls.push(context);return {};},
  verify:async()=>calls.length===1?verdict:{passed:true}
 });
 assert.equal(calls[0].feedback,null);
 assert.deepEqual(calls[1].feedback,{failedChecks:['construction'],differences:[difference]});
});

test('comparison evidence is limited to failed known checks and bounded text', () => {
 const verdict=parseQualityVerdict(JSON.stringify({...good,color:false,differences:[
  {check:'color',expected:'white',observed:'black'},
  {check:'personPreserved',expected:'change person',observed:'same person'},
  {check:'unexpected',expected:'unrelated',observed:'unrelated'},
  {check:'color',expected:123,observed:'invalid'}
 ]}));
 assert.deepEqual(verdict.differences,[{check:'color',expected:'white',observed:'black'}]);
});

test('a resized copy of the garment reference fails locally without calling vision', async () => {
 const garment=await sharp({create:{width:64,height:96,channels:3,background:'#202020'}}).png().toBuffer();
 const person=await sharp({create:{width:64,height:96,channels:3,background:'#eeeeee'}}).png().toBuffer();
 const result=await sharp(garment).resize(128,192).jpeg({quality:90}).toBuffer();
 const verdict=await verifyTryOn({garment,person,result,fetchImpl:async()=>{assert.fail('Reference echo must not call vision');}});
 assert.equal(verdict.passed,false);
 assert.deepEqual(verdict.failedChecks,['personPreserved']);
});

test('unchanged person output fails locally without calling vision', async () => {
 const garment=await sharp({create:{width:64,height:96,channels:3,background:'#202020'}}).png().toBuffer();
 const person=await sharp({create:{width:64,height:96,channels:3,background:'#eeeeee'}}).png().toBuffer();
 const verdict=await verifyTryOn({garment,person,result:person,fetchImpl:async()=>{assert.fail('Unchanged output must not call vision');}});
 assert.equal(verdict.passed,false);
 assert.deepEqual(verdict.failedChecks,['construction']);
});

test('full outfits require a separate shopper check even after garment approval', async () => {
 const previous=process.env.FAL_KEY;process.env.FAL_KEY='test';
 try {
  const images=await Promise.all(['white','black','red'].map(background=>sharp({create:{width:16,height:16,channels:3,background}}).png().toBuffer()));
  let calls=0;
  const verdict=await verifyTryOn({garment:images[0],person:images[1],result:images[2],outfitScope:'full_outfit',fetchImpl:async(url,options)=>{
   calls++;const body=JSON.parse(options.body);
   if(calls===1){assert.equal(body.image_urls.length,3);assert.match(body.prompt,/Check ALL visible set pieces/);return {ok:true,json:async()=>({output:JSON.stringify(good)})};}
   assert.equal(body.image_urls.length,2);
   assert.match(body.prompt,/Ignore clothing entirely/);
   return {ok:true,json:async()=>({output:JSON.stringify({personPreserved:false,confidence:0.99,expected:'Curly red hair',observed:'Straight dark hair'})})};
  }});
  assert.equal(calls,2);assert.equal(verdict.passed,false);assert.deepEqual(verdict.failedChecks,['personPreserved']);
 } finally {if(previous===undefined)delete process.env.FAL_KEY;else process.env.FAL_KEY=previous;}
});
