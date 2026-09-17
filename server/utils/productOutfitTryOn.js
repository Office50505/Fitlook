import { prepareCustomTryOnReferences } from './customTryOnPreparation.js';
import { generateVerifiedTryOn, verifyTryOn } from './tryOnQuality.js';

export function productOutfitEditRequest({ personUrl, garmentUrl, garmentDescription, feedback }) {
  if (!personUrl || !garmentUrl) throw new Error('Person and outfit references are required');
  return { model: 'p-image-edit', input: {
    images: [garmentUrl, personUrl],
    prompt: [
      'Edit image 2, the last image. Keep the exact person, face, hair, body, pose, background and full head-to-toe framing of image 2.',
      'Completely remove the existing upper and lower clothing from that person and dress them in the entire outfit from image 1.',
      `Clothing to transfer: ${String(garmentDescription || 'all visible outfit pieces').slice(0, 1400)}`,
      'Image 1 supplies clothing only, never the person or background. Copy the actual garment lengths, neckline, sleeves, patterns, colors and materials. Include the separate trousers and matching draped dupatta or scarf when visible. Drape it naturally over the unchanged pose. Do not convert a kurta into a blazer, retain old jeans, or omit any visible set piece.',
      'Return one photograph of the person from image 2 wearing the full reference outfit. No collage or text.',
      feedback?.differences?.length ? `Correct these observed mismatches: ${JSON.stringify(feedback.differences).slice(0, 1800)}` : ''
    ].filter(Boolean).join(' '),
    turbo: false, aspect_ratio: 'match_input_image', disable_safety_checker: false
  }};
}

// Catalog outfits need the same fidelity gate as uploaded garments. Keep the
// complete reference: cropping a set can remove its trousers or draped dupatta.
export async function generateVerifiedProductOutfit({ product, garment, person, generate,
  prepare = prepareCustomTryOnReferences, verify = verifyTryOn, onRejected }) {
  const reference = await prepare({ garment });
  const garmentDescription = [
    reference.garmentDescription,
    `Selected catalog item: ${String(product.name || '').slice(0, 300)}.`,
    'Transfer every visible piece of this coordinated outfit, including its lower garment and any matching dupatta. Replace the original clothing in those regions.'
  ].join(' ');
  return generateVerifiedTryOn({
    generate: ({ feedback }) => generate({ garment, garmentDescription, promptKey: 'full_outfit', feedback }),
    verify: (result) => verify({ garment, person, result: result.bytes, outfitScope: 'full_outfit' }),
    onRejected
  });
}
