export function fabricRefinementRequest({imageUrl,garmentDescription=''}) {
  if (!imageUrl) throw new Error('A generated try-on image is required for refinement');
  return {model:'p-image-edit',input:{
    images:[imageUrl],
    prompt:[
      'Refine only the fabric rendering and fit of the clothing in this photograph.',
      garmentDescription ? `Reference garment description (visual evidence only): ${String(garmentDescription).slice(0,900)}.` : '',
      'Keep the same person, exact face, hair, body shape, pose, hands, shoes, background and framing. Keep the exact neckline, straps, sleeves, garment length, seams and garment design.',
      'Let smooth fabric panels rest against the existing body with natural wearing ease; remove excessive wrinkles only from areas that are smooth in the reference. Retain intentional gathers, pleats and draping in their original locations.',
      'Preserve the original material of every panel. Use realistic fabric weight, subtle directional highlights and soft contact shadows. Do not add oily or plastic shine to matte fabric.',
      'Do not tighten the waist or reshape the body. Do not add ties, belts, fasteners or cutouts. Change only cloth shading and physically plausible folds.'
    ].filter(Boolean).join(' '),
    turbo:false,aspect_ratio:'match_input_image',disable_safety_checker:false
  }};
}

// A valid base preview must survive any optional refinement/provider failure.
export async function refineWithFallback({base,refine,verify,onFallback=()=>{}}) {
  let candidate;
  try {
    candidate=await refine(base);
    const verdict=await verify(candidate);
    const providerCostUsd=(Number(base.providerCostUsd)||0)+(Number(candidate.providerCostUsd)||0);
    if (verdict?.passed === true) {
      return {...base,...candidate,model:`${base.model} + ${candidate.model}`,quality:'prepared garment / natural fabric',providerCostUsd};
    }
    onFallback('quality_rejected');
    return {...base,providerCostUsd};
  } catch {
    onFallback('refinement_unavailable');
    return {...base,providerCostUsd:(Number(base.providerCostUsd)||0)+(Number(candidate?.providerCostUsd)||0)};
  }
}
