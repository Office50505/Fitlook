import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {garmentCropRegion,prepareCustomTryOnReferences} from '../server/utils/customTryOnPreparation.js';

test('crop retains a margin around straps and clamps to image bounds',()=>{
 assert.deepEqual(garmentCropRegion({confidence:0.95,crop:{left:0.2,top:0.3,width:0.5,height:0.6}},1000,1000),{left:175,top:274,width:550,height:651});
 const edge=garmentCropRegion({confidence:0.95,crop:{left:0,top:0,width:1,height:1}},1000,1200);
 assert.deepEqual(edge,{left:0,top:0,width:1000,height:1200});
});

test('invalid, uncertain and tiny crop detections preserve the original reference',()=>{
 for(const analysis of [null,{confidence:0.8,crop:{left:0.2,top:0.3,width:0.5,height:0.6}},
 {confidence:0.95,crop:{left:0.9,top:0.3,width:0.5,height:0.6}},
 {confidence:0.95,crop:{left:0.1,top:0.1,width:0.01,height:0.01}},
 {confidence:0.95,crop:{left:'0.1',top:0.1,width:0.5,height:0.6}}]) assert.equal(garmentCropRegion(analysis,1000,1200),null);
});

test('preparation sends only the garment for analysis and crops conservatively',async()=>{
 const previous=process.env.FAL_KEY;process.env.FAL_KEY='test';
 try {
 const person=await sharp({create:{width:300,height:500,channels:3,background:'white'}}).png().toBuffer();
 const garment=await sharp({create:{width:400,height:600,channels:3,background:'black'}}).png().toBuffer();
 const bodies=[];
 const result=await prepareCustomTryOnReferences({person,garment,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);bodies.push(body);
  assert.equal(body.image_urls.length,1);
  const target=body.prompt.startsWith('Describe this target');
  return {ok:true,json:async()=>({output:JSON.stringify(target?{description:'shopper in studio'}:{description:'black sleeveless dress',confidence:0.95,crop:{left:0.2,top:0.3,width:0.5,height:0.6}})})};
 }});
 assert.equal(bodies.length,1);
 assert.equal(result.garmentDescription,'black sleeveless dress');
 const size=await sharp(result.garmentBytes).metadata();assert.ok(size.width<400 && size.height<600);
 assert.ok(result.crop);
 }finally{if(previous===undefined)delete process.env.FAL_KEY;else process.env.FAL_KEY=previous;}
});
