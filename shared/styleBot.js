export const styleBotWearablePatterns = [
  /\b(cloth(?:e|es|ing)?|apparel|garments?|outfits?|fashion|wearable|style|look)\b/i,
  /\b(sarees?|saris?|lehenga(?:s)?|dupatta(?:s)?|kurta(?:s)?|kurtis?|salwar(?:s)?|churidar(?:s)?|anarkali|palazzo(?:s)?|sharara(?:s)?)\b/i,
  /\b(sun\s*glasses|sunglasses|eye\s*glasses|eyeglasses|spectacles?|optical\s*frames?|goggles?|aviator|wayfarer)\b/i,
  /\b(underwear|briefs?|boxers?|trunks?|vests?|innerwear|lingerie|bras?|bralettes?|sports?\s+bras?|pant(?:y|ies)|camisoles?|shapewear|bikinis?|swimsuits?|swimwear|monokinis?)\b/i,
  /\b(night(?:y|ie|wear|gown|suit|dress)|sleepwear|pajamas?|pyjamas?|loungewear|robe)\b/i,
  /\b(dress(?:es)?|gowns?|suits?|skirts?|skorts?|jeans?|pants?|trousers?|joggers?|leggings?|chinos?|shorts?|bermudas?)\b/i,
  /\b(hoodies?|sweatshirts?|sweaters?|pullovers?|jumpers?|jackets?|overshirts?|blazers?|coats?|windcheaters?|parkas?|shrugs?)\b/i,
  /\b(t\s*-?\s*shirts?|tshirts?|tees?|polo\s*(?:shirts?)?|shirts?|button\s*(?:down|up)|tops?|blouses?|tunics?|crop\s*tops?|tank\s*tops?)\b/i,
  /\b(shoes?|sneakers?|boots?|loafers?|sandals?|slippers?|heels?|pumps?|flats?|footwear|trainers?)\b/i,
  /\b(watch(?:es)?|smart\s*watch(?:es)?|smartwatch(?:es)?|chronograph)\b/i,
  /\b(wallets?|purses?|backpacks?|handbags?|totes?|sling\s*bags?|crossbody|duffels?|clutches?)\b/i,
  /\b(belts?|baseball\s*caps?|hats?|scarves?|ties?|jewellery|jewelry|necklaces?|bracelets?|earrings?|accessor(?:y|ies))\b/i
];

const styleBotBlockedPatterns = [
  ['an oral care product', /\b(tooth\s*paste|toothpaste|toote\s*paste|tooth\s*brush|toothbrush|mouth\s*wash|mouthwash|dental|oral\s+care|colgate|sensodyne|pepsodent)\b/i],
  ['a beauty or hygiene product', /\b(shampoo|conditioner|soap|body\s*wash|face\s*wash|cleanser|lotion|cream|moisturi[sz]er|deodorant|perfume|makeup|cosmetics?|serum|sunscreen)\b/i],
  ['a food or grocery product', /\b(food|grocery|snacks?|chocolate|candy|tea|coffee|rice|flour|oil|spices?|sauce|drink|beverage|juice|protein\s*powder)\b/i],
  ['an electronics product', /\b(phone|mobile|laptop|tablet|camera|charger|cable|adapter|headphones?|earbuds?|speaker|keyboard|mouse|monitor|television|tv)\b/i],
  ['a home product', /\b(furniture|chair|table|mattress|bedsheet|curtain|lamp|bottle|mug|plate|cookware|utensils?|detergent|cleaner|toilet|kitchen|bathroom)\b/i],
  ['a book or stationery product', /\b(books?|notebooks?|pens?|pencils?|markers?|stationery|diary|paper)\b/i],
  ['medicine or a supplement', /\b(medicine|tablet|capsules?|syrup|vitamins?|supplements?|pain\s*relief|antiseptic)\b/i]
];

function styleBotCompatibility(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const blocked = styleBotBlockedPatterns.find(([, pattern]) => pattern.test(text));
  if (blocked) {
    return {
      compatible: false,
      reason: `This is not a compatible product type for AI try-on. Style Bot only supports wearable fashion items, and this looks like ${blocked[0]}.`
    };
  }
  if (styleBotWearablePatterns.some((pattern) => pattern.test(text))) return { compatible: true };
  return {
    compatible: false,
    reason: 'This is not a compatible product type for AI try-on. Try clothes, shoes, watches, bags, eyewear, or accessories.'
  };
}

export function styleBotProductCompatibility(product = {}) {
  return styleBotCompatibility([product.name, product.category, product.description,
    ...(Array.isArray(product.tags) ? product.tags : [product.tags])].filter(Boolean).join(' '));
}

// Only clear shopping intent is rejected here; conversation never uses try-on validation.
export function styleBotChatIntent(value = '') {
  const text = String(value).trim();
  const shoppingQuestion = /\b(show|find|search|buy|shop)\b/i.test(text);
  if (/^(what|which|why|when|how|should|can|could|would|is|are|do|does)\b/i.test(text) && !shoppingQuestion) return { productSearch: false, error: '' };
  const advice = /\b(what\s+(?:should|can|would)|how\s+(?:should|can|do|to)|should\s+i|help\s+me\s+(?:style|dress)|styling\s+(?:tips|advice))\b/i.test(text);
  if (advice) return { productSearch: false, error: '' };
  const wearable = styleBotWearablePatterns.some((pattern) => pattern.test(text));
  const shopping = /^(?:(?:hey|hi|hello|hii)[,!]?\s+)?(?:please\s+)?(?:show|find|search|buy|shop|recommend|suggest|looking\s+for|i\s+(?:want|need))\b/i.test(text);
  const blocked = styleBotBlockedPatterns.find(([, pattern]) => pattern.test(text));
  const bareItem = blocked && text.split(/\s+/).length <= 3 && !/[?]/.test(text);
  return {
    productSearch: shopping || wearable || Boolean(bareItem),
    error: blocked && !wearable && (shopping || bareItem)
      ? 'I can help you find fashion items. This product is outside the fashion catalog; try clothes, shoes, bags, or accessories.' : ''
  };
}

export function styleBotChatResponse(data = {}) {
  const products = [data.products, data.recommendations, data.items, data.suggestions, data.suggestions?.products]
    .find(Array.isArray) || [];
  const reply = [data.reply, data.message, data.text].find((value) => typeof value === 'string' && value.trim());
  return {
    products: products.filter((product) => product && typeof product === 'object'),
    reply: reply || (products.length ? `I found ${products.length} suggestions for you.`
      : 'Tell me more about your occasion, preferred style, or budget so I can help.'),
    conversationId: data.conversationId || '',
    ...(data.replySource === 'basic' ? { replySource: 'basic' } : {})
  };
}

export function productTryOnBlockMessage(product = {}, user, cost = 1) {
  if (product.aiTryOnAvailable === false || product.tryOnAvailable === false) return 'AI try-on is unavailable for this product.';
  if (!user || (!user.bodyPhotoUrl && !user.bodyPhotoOriginalUrl)) return 'Upload a profile photo before starting an AI try-on.';
  if (user.bodyPhotoStatus && !['ready', 'uploaded'].includes(user.bodyPhotoStatus)) return 'Your try-on profile is not ready. Check your profile photo.';
  if (!(Number(user.tokens) >= cost)) return 'You need more credits to generate this try-on.';
  return '';
}
