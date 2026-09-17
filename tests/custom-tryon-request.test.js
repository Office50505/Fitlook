import assert from 'node:assert/strict';
import test from 'node:test';
import {customTryOnRequest} from '../server/utils/customTryOnRequest.js';
const reference={personUrl:'https://example.com/person',garmentUrl:'https://example.com/cropped-garment'};

test('prepared custom try-on keeps person and garment in dedicated API fields',()=>{
 const request=customTryOnRequest(reference);
 assert.equal(request.model,'p-image-try-on');
 assert.equal(request.input.person_image,reference.personUrl);
 assert.deepEqual(request.input.garment_images,[reference.garmentUrl]);
 assert.equal(request.input.turbo,false);
 assert.equal(request.input.preserve_input_size,true);
 assert.equal(request.input.output_format,'png');
 assert.equal('images' in request.input,false);
 assert.equal('aspect_ratio' in request.input,false);
 assert.equal('disable_safety_checker' in request.input,false);
});

test('missing references are rejected before provider submission',()=>{
 assert.throws(()=>customTryOnRequest({...reference,garmentUrl:''}),/references are required/);
});

test('reference description selects the exact item, with optional scope',()=>{
 const request=customTryOnRequest({...reference,garmentDescription:'black thin-strap V-neck mini dress'});
 assert.match(request.input.prompt,/black thin-strap V-neck mini dress/);
 assert.match(request.input.prompt,/dress as one garment/);
 assert.match(request.input.prompt,/Do not add ties, drawstrings/);
 const upper=customTryOnRequest({...reference,promptKey:'upper'});
 assert.equal(upper.promptKey,'upper');
 assert.match(upper.input.prompt,/keep existing lower clothing/);
});

test('retry correction augments instructions without changing original references',()=>{
 const feedback={differences:[{check:'construction',expected:'thin straps and V-neck',observed:'short sleeves and round neck'}]};
 const request=customTryOnRequest({...reference,feedback});
 assert.match(request.input.prompt,/thin straps and V-neck/);
 assert.match(request.input.prompt,/short sleeves and round neck/);
 assert.equal(request.input.person_image,reference.personUrl);
 assert.deepEqual(request.input.garment_images,[reference.garmentUrl]);
});
