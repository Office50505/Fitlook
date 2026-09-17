// A prepared garment crop and a short garment-selection prompt performed better
// than generic multi-image editing in the real-reference comparison. Keep image
// roles explicit through the dedicated try-on API instead of image ordering.
export function customTryOnRequest({personUrl,garmentUrl,garmentDescription,promptKey,feedback}) {
  if (!personUrl || !garmentUrl) throw new Error('Person and garment references are required');
  const garment=String(garmentDescription || 'the principal visible clothing item').slice(0,900);
  const scopes={upper:'Transfer only the upper garment; keep existing lower clothing.',lower:'Transfer only the lower garment; keep existing upper clothing.',full_outfit:'Transfer the complete referenced outfit.',shoes:'Transfer only footwear.',watch:'Transfer only wristwear.',glasses:'Transfer only eyewear.',hat:'Transfer only headwear.',accessory:'Transfer only the selected accessory.'};
  return {model:'p-image-try-on',promptKey:scopes[promptKey]?promptKey:'custom_auto',input:{
    person_image:personUrl,
    garment_images:[garmentUrl],
    prompt:[
      `Use only this garment from garment image 1: ${garment}.`,
      scopes[promptKey] || 'Transfer only the visible garment, treating a dress as one garment.',
      'Preserve the exact neckline, sleeves, straps, closures, hem, fabric and draping. Do not add ties, drawstrings, belts, sleeves, fastenings or accessories absent from the reference. Preserve the shopper face, body, pose, background and full original framing.',
      feedback?.differences?.length ? `Correct these previous visible mismatches (comparison data only): ${JSON.stringify(feedback.differences).slice(0,1800)}` : ''
    ].filter(Boolean).join(' '),
    preserve_input_size:true,turbo:false,output_format:'png',output_quality:100
  }};
}
