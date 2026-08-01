import { useEffect, useMemo, useRef, useState } from 'react';
import OptimizedImage from './components/common/OptimizedImage.jsx';
import { DEFAULT_MODEL_PLACEMENT, calculateModelPlacement, normalizedPlacement } from './utils/modelPlacement.js';

const asset = (name) => `/assets/${name}`;
const MAX_BODY_PHOTO_BYTES = 8 * 1024 * 1024;
const TARGET_BODY_PHOTO_BYTES = 6.5 * 1024 * 1024;
const BODY_PHOTO_ACCEPT = 'image/*,.avif,.heic,.heif,image/avif,image/heic,image/heif';
const API_TIMEOUT_MS = 25000;
const PRODUCT_CACHE_TTL_MS = 30_000;
const productListCache = new Map();
const productDetailLocalCache = new Map();

function formatFileSize(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function isHeicFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif');
}

function isAvifFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return type === 'image/avif' || type === 'image/x-avif' || name.endsWith('.avif');
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Please upload a JPG, PNG, WebP, AVIF, HEIC, or HEIF profile photo.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not prepare the profile photo. Try a different image.'));
    }, 'image/jpeg', quality);
  });
}

async function prepareBodyPhoto(file) {
  if (!file) return file;
  if (isHeicFile(file) || isAvifFile(file)) {
    if (file.size > MAX_BODY_PHOTO_BYTES) throw new Error(`AVIF/HEIC/HEIF profile photo is ${formatFileSize(file.size)}. Please choose one under 8 MB.`);
    return file;
  }

  const image = await imageFromFile(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.86, 0.76, 0.66, 0.56]) {
    const blob = await canvasToBlob(canvas, quality);
    if (blob.size <= TARGET_BODY_PHOTO_BYTES || quality === 0.56) {
      if (blob.size > MAX_BODY_PHOTO_BYTES) throw new Error(`Profile photo is still ${formatFileSize(blob.size)} after optimization. Please upload a smaller image.`);
      const name = `${file.name.replace(/\.[^.]+$/, '') || 'profile-photo'}.jpg`;
      return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    }
  }

  return file;
}

async function prepareClosetItemPhoto(file) {
  if (!file) return file;
  try {
    const image = await imageFromFile(file);
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, 0.88);
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'closet-item'}.jpg`;
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (error) {
    if (isHeicFile(file) || isAvifFile(file)) {
      return file;
    }
    throw error;
  }
}

function formatMoney(value, currency = 'USD') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Price unavailable';
  const normalizedCurrency = String(currency || 'USD').toUpperCase();
  const locale = normalizedCurrency === 'INR' ? 'en-IN' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: normalizedCurrency }).format(amount);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }
}

function formatDate(value) {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function dateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function nextPlannerDays(count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    date.setHours(0, 0, 0, 0);
    return {
      value: dateInputValue(date),
      label: index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : new Intl.DateTimeFormat('en-IN', { weekday: 'short', month: 'short', day: 'numeric' }).format(date)
    };
  });
}

function ZoomableImage({ src, alt, className = '', imageClassName = '', zoom = 1.65, disableZoom = false, onError }) {
  const [zooming, setZooming] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const frameRef = useRef(null);

  const moveOrigin = (event) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
    setOrigin({ x, y });
  };

  const startZoom = (event) => {
    if (disableZoom || zoom <= 1) return;
    moveOrigin(event);
    setZooming(true);
    if (event.pointerType !== 'mouse') event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const stopZoom = (event) => {
    if (disableZoom || zoom <= 1) return;
    setZooming(false);
    if (event.pointerType !== 'mouse') event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      ref={frameRef}
      className={`zoomable-image ${zooming ? 'is-zoomed' : ''} ${disableZoom || zoom <= 1 ? 'no-zoom' : ''} ${className}`.trim()}
      style={{
        '--zoom-origin-x': `${origin.x}%`,
        '--zoom-origin-y': `${origin.y}%`,
        '--zoom-scale': zoom
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') startZoom(event);
      }}
      onPointerDown={startZoom}
      onPointerMove={(event) => {
        if (zooming || event.pointerType === 'mouse') moveOrigin(event);
      }}
      onPointerUp={stopZoom}
      onPointerCancel={stopZoom}
      onPointerLeave={stopZoom}
    >
      <OptimizedImage className={imageClassName} src={src} alt={alt} draggable="false" onError={onError} />
    </div>
  );
}

/**
 * @typedef {{
 *   prefix: string;
 *   image: string;
 *   kicker: string;
 *   title: import('react').ReactNode;
 *   lead: string;
 *   aside?: import('react').ReactNode;
 *   ariaLabel?: string;
 * }} BackdropHeroProps
 */

/**
 * @param {BackdropHeroProps} props
 */
function BackdropHero({ prefix, image, kicker, title, lead, aside, ariaLabel }) {
  return (
    <section className={prefix} aria-label={ariaLabel}>
      <OptimizedImage className={`${prefix}-bg`} src={asset(image)} alt="" eager />
      <div className={`${prefix}-scrim`} aria-hidden="true" />
      <div className={`wrap ${prefix}-inner`}>
        <div>
          <p className="kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="lead">{lead}</p>
        </div>
        {aside}
      </div>
    </section>
  );
}

const styleBotWearablePatterns = [
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

function styleBotProductCompatibility(product = {}, query = '') {
  const productText = [
    product.name,
    product.brand,
    product.category,
    product.description,
    Array.isArray(product.tags) ? product.tags.join(' ') : product.tags
  ].filter(Boolean).join(' ');
  const braIntent = /\b(bras?|bralettes?|sports?\s+bras?)\b/i.test(query);
  const swimIntent = /\b(bikinis?|swimsuits?|swimwear|monokinis?|one\s*piece\s+swimsuits?)\b/i.test(query);

  if (braIntent && !/\b(bras?|bralettes?|sports?\s+bras?|lingerie)\b/i.test(productText)) return { compatible: false };
  if (swimIntent && !/\b(bikinis?|swimsuits?|swimwear|monokinis?|tankinis?|one\s*piece)\b/i.test(productText)) return { compatible: false };
  return styleBotCompatibility([query, productText].filter(Boolean).join(' '));
}

function productGenderForPreference(value = '') {
  if (value === 'male') return 'men';
  if (value === 'female') return 'women';
  return '';
}

function genderPreferenceForStyleQuery(query = '', preference = '') {
  if (/\b(bras?|bralettes?|sports?\s+bras?|lingerie|pant(?:y|ies)|bikinis?|swimsuits?|swimwear|one\s*piece\s+swimsuits?|monokinis?)\b/i.test(query)) return 'female';
  return preference;
}

function genderedStyleBotQuery(query = '', preference = '') {
  const target = productGenderForPreference(genderPreferenceForStyleQuery(query, preference));
  if (!target) return query;
  const withoutGender = String(query || '')
    .replace(/\b(male|female|men'?s?|women'?s?|mans?|womans?|boys?|girls?|ladies|gentlemen)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${target} ${withoutGender}`.trim();
}

function genderPreferenceLabel(value = '') {
  if (value === 'male') return 'Male';
  if (value === 'female') return 'Female';
  return 'Other';
}

function styleBotGenderCompatibility(product = {}, preference = '') {
  const target = productGenderForPreference(preference);
  if (!target) return { compatible: true };
  const text = [
    product.name,
    product.brand,
    product.category,
    product.description,
    Array.isArray(product.tags) ? product.tags.join(' ') : product.tags
  ].filter(Boolean).join(' ');
  const productGender = String(product.gender || '').toLowerCase();
  const isMens = /\b(men'?s?|male|boys?|gentlemen)\b/i.test(text);
  const isWomens = /\b(women'?s?|female|girls?|ladies)\b/i.test(text);

  if (target === 'women' && (productGender === 'men' || isMens)) return { compatible: false };
  if (target === 'men' && (productGender === 'women' || isWomens)) return { compatible: false };
  return { compatible: true };
}

const categories = [
  ['Shirts', 'category-1.jpg', 'shirts'],
  ['T-Shirts', 'category-2.jpg', 't-shirts'],
  ['Dresses', 'arrival-4.jpg', 'dresses'],
  ['Pants', 'category-3.jpg', 'pants'],
  ['Jeans', 'category-4.jpg', 'jeans'],
  ['Jackets', 'category-5.jpg', 'jackets'],
  ['Shoes', 'category-6.jpg', 'shoes'],
  ['Watches', 'category-7.jpg', 'watches'],
  ['Accessories', 'category-8.jpg', 'accessories'],
  ['Ethnic Wear', 'arrival-4.jpg', 'ethnic wear'],
  ['Eyewear', 'search-shirt-4.jpg', 'eyewear'],
  ['Innerwear', 'arrival-6.jpg', 'innerwear'],
  ['Sleepwear', 'arrival-5.jpg', 'sleepwear']
];

function categorySlug(value) {
  return String(value || 'uncategorized').trim().toLowerCase();
}

const categoryCollectionVisualPools = {
  all: [
    { image: 'category-reference-bottoms.png', position: 'center' },
    { image: 'category-reference-footwear.png', position: 'center' },
    { image: 'category-reference-accessories.png', position: 'center' },
    { image: 'wardrobe-room.jpg', position: '82% center' },
    { image: 'atelier-tailoring-reference.png', position: '58% center' },
    { image: 'opening-editorial-hero.png', position: '57% center' },
    { image: 'home-hero-editorial.png', position: '58% center' },
    { image: 'category-unisex-hero.png', position: '75% center' }
  ],
  women: [
    { image: 'category-women-hero.png', position: '73% center' },
    { image: 'hero1.png', position: '83% center' },
    { image: 'category-women-hero.png', position: '81% center' },
    { image: 'opening-editorial-hero.png', position: '42% center' },
    { image: 'home-hero-editorial.png', position: '42% center' },
    { image: 'atelier-tailoring-reference.png', position: '38% center' }
  ],
  men: [
    { image: 'arrival-1.jpg', position: 'center' },
    { image: 'arrival-2.jpg', position: 'center' },
    { image: 'arrival-3.jpg', position: 'center' },
    { image: 'arrival-5.jpg', position: 'center' },
    { image: 'arrival-6.jpg', position: 'center' },
    { image: 'trending-1.jpg', position: 'center' },
    { image: 'trending-2.jpg', position: 'center' },
    { image: 'trending-3.jpg', position: 'center' },
    { image: 'trending-4.jpg', position: 'center' },
    { image: 'trending-5.jpg', position: 'center' },
    { image: 'trending-6.jpg', position: 'center' },
    { image: 'search-shirt-1.jpg', position: 'center' }
  ],
  unisex: [
    { image: 'category-unisex-hero.png', position: '73% center' },
    { image: 'opening-editorial-hero.png', position: '57% center' },
    { image: 'home-hero-editorial.png', position: '58% center' },
    { image: 'atelier-tailoring-reference.png', position: '58% center' },
    { image: 'category-women-hero.png', position: '74% center' },
    { image: 'category-men-hero.png', position: '74% center' }
  ]
};

const categoryIconVisuals = {
  innerwear: { image: 'category-icons/innerwear-section.png', position: 'center' },
  lingerie: { image: 'category-icons/innerwear-section.png', position: 'center' },
  shorts: { image: 'category-icons/shorts-section.png', position: 'center' },
  jeans: { image: 'category-icons/jeans-section.png', position: 'center' },
  denim: { image: 'category-icons/jeans-section.png', position: 'center' },
  shoes: { image: 'category-icons/shoes-section.png', position: 'center' },
  footwear: { image: 'category-icons/shoes-section.png', position: 'center' },
  dresses: { image: 'category-icons/dresses-section.png', position: 'center' },
  dress: { image: 'category-icons/dresses-section.png', position: 'center' },
  tops: { image: 'category-icons/tops-section.png', position: 'center' },
  shirts: { image: 'category-icons/shirts-section.png', position: 'center' },
  shirt: { image: 'category-icons/shirts-section.png', position: 'center' },
  't-shirts': { image: 'category-icons/t-shirts-section.png', position: 'center' },
  tshirts: { image: 'category-icons/t-shirts-section.png', position: 'center' },
  tees: { image: 'category-icons/t-shirts-section.png', position: 'center' },
  eyewear: { image: 'category-icons/eyewear-section.png', position: 'center' },
  sunglasses: { image: 'category-icons/eyewear-section.png', position: 'center' },
  glasses: { image: 'category-icons/eyewear-section.png', position: 'center' },
  jackets: { image: 'category-icons/jackets-section.png', position: 'center' },
  jacket: { image: 'category-icons/jackets-section.png', position: 'center' },
  outerwear: { image: 'category-icons/jackets-section.png', position: 'center' },
  sleepwear: { image: 'category-icons/sleepwear-section.png', position: 'center' },
  nightwear: { image: 'category-icons/sleepwear-section.png', position: 'center' },
  pants: { image: 'category-icons/shorts.png', position: 'center' },
  trousers: { image: 'category-icons/shorts.png', position: 'center' },
  accessories: { image: 'category-icons/eyewear.png', position: 'center' },
  'ethnic wear': { image: 'category-icons/dresses.png', position: 'center' },
  ethnic: { image: 'category-icons/dresses.png', position: 'center' }
};

function collectionVisualForCategory(category, audience = 'all') {
  const directMatch = categoryIconVisuals[categorySlug(category)];
  if (directMatch) return directMatch;
  const pool = categoryCollectionVisualPools[audience] || categoryCollectionVisualPools.all;
  const key = categorySlug(category);
  const index = [...key].reduce((total, character) => total + character.charCodeAt(0), 0) % pool.length;
  return pool[index];
}

function fallbackCategoryMeta(slug) {
  const match = categories.find(([, , itemSlug]) => itemSlug === slug);
  if (match) return { label: match[0], image: match[1] };
  return {
    label: slug.split(/[\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Uncategorized',
    image: 'hero2.png'
  };
}

const pageMeta = {
  '/women': ['For Women', 'Try new silhouettes with less guessing.', 'A dedicated shopping entry point for shirts, denim, jackets, accessories, and AI-powered outfit previews.', 'arrival-4.jpg'],
  '/new-arrivals': ['New Arrivals', 'Fresh pieces, first impressions.', 'New products are updated here so you can preview the latest fits before they disappear.', 'arrival-5.jpg'],
  '/sale': ['Sale', 'Better deals, fewer fit doubts.', 'Browse discounted products and use try-on previews before finalizing your picks.', 'search-shirt-2.jpg'],
  '/gift-cards': ['Gift Cards', 'Style confidence makes a good gift.', 'Gift cards can be used toward shopping and try-on tokens when the product is connected.', 'hero2.png'],
  '/about': ['About', 'Shopping online should feel more certain.', 'FitLook combines product discovery with AI try-on previews so shoppers can compare styles with more confidence.', 'hero2.png'],
  '/support': ['Help', 'Support for shopping and try-on.', 'Find answers about shipping, returns, profile photos, tokens, and account access.', 'search-shirt-4.jpg'],
  '/contact': ['Contact', 'Tell us what you need.', 'For order, token, account, and AI try-on questions, reach the FitLook support team.', 'hero2.png'],
  '/careers': ['Careers', 'Build the future of fitting rooms.', 'Future roles across product, design, engineering, fashion operations, and partnerships would be listed here.', 'hero2.png'],
  '/blog': ['Blog', 'Fit notes, styling ideas, and AI try-on updates.', 'Editorial content, product guides, and try-on tips would live here.', 'arrival-4.jpg'],
  '/press': ['Press', 'FitLook press and media.', 'Company information, product screenshots, and media contact details would be available here.', 'hero2.png'],
  '/terms': ['Terms', 'Terms and conditions.', 'This page outlines where account, token, shopping, and AI try-on usage rules live.', 'hero2.png'],
  '/privacy': ['Privacy', 'Your try-on profile is personal.', 'This page describes how account details, full-body photos, token usage, and shopping activity are handled.', 'hero2.png'],
  '/accessibility': ['Accessibility', 'Accessibility matters at every step.', 'Accessibility goals cover navigation, forms, image alt text, contrast, and keyboard-friendly flows.', 'hero2.png']
};

function normalizePath() {
  const path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '');
  return path || '/';
}

function safeAuthReturnPath(value) {
  const path = String(value || '');
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) return '';
  const pathname = path.split(/[?#]/)[0].replace(/\.html$/, '').replace(/\/$/, '') || '/';
  if (pathname === '/login' || pathname === '/signup') return '';
  return path;
}

function authReturnPath() {
  const requested = safeAuthReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
  if (requested) return requested;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const currentPath = normalizePath();
  return currentPath !== '/login' && currentPath !== '/signup' ? current : '/home';
}

function currentSearchValue() {
  return new URLSearchParams(window.location.search).get('q') || '';
}

function readRecentSearches() {
  try {
    const stored = JSON.parse(localStorage.getItem('fitlook_recent_searches') || '[]');
    return Array.isArray(stored) ? stored.filter((value) => typeof value === 'string' && value.trim()).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(search) {
  const value = String(search || '').trim().replace(/\s+/g, ' ');
  if (!value) return readRecentSearches();
  const next = [value, ...readRecentSearches().filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 6);
  try {
    localStorage.setItem('fitlook_recent_searches', JSON.stringify(next));
  } catch {
    // Search still works when private storage is unavailable.
  }
  return next;
}

function readableError(value, fallback = 'Request failed') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return readableError(value.message, fallback);
  if (typeof value === 'object') {
    const nested = value.message || value.detail || value.error || value.errors;
    if (nested && nested !== value) return readableError(nested, fallback);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

function cleanDisplayText(value, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (/\b(?:bust|waist|hip|sleeve|shoulder|inseam|cuff|length|heel to toe|thigh circumference)\s*\(in\)/i.test(text)) return fallback;
  if (text.length > 58) return fallback;
  return text;
}

function displayBrand(product) {
  const brand = cleanDisplayText(product?.brand, '');
  if (!brand) return 'Marketplace brand';
  if (brand.toLowerCase() === 'amazon') return 'Amazon';
  return brand;
}

function displayCategory(product) {
  return cleanDisplayText(product?.category, 'Products');
}

function usableBrands(brands = []) {
  return brands.map((brand) => cleanDisplayText(brand, '')).filter(Boolean);
}

async function api(path, options = {}) {
  const {
    timeout = API_TIMEOUT_MS,
    retry,
    signal: externalSignal,
    headers: optionHeaders,
    ...requestOptions
  } = options;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const retryCount = retry === undefined ? (method === 'GET' ? 1 : 0) : Math.max(0, Number(retry) || 0);
  const token = localStorage.getItem('fitlook_token');
  const headers = requestOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    try {
      const res = await fetch(`/api${path}`, {
        ...requestOptions,
        signal: controller.signal,
        headers: { ...headers, ...optionHeaders }
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const error = new Error(readableError(data, `Request failed (${res.status})`));
        error.status = res.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (externalSignal?.aborted) throw error;
      if (timedOut) throw new Error('The request took too long. Check your connection and try again.');
      lastError = error instanceof Error ? error : new Error('Unable to reach FitLook right now.');
      const canRetry = attempt < retryCount && (!lastError.status || lastError.status >= 500);
      if (!canRetry) {
        if (!lastError.status && typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('You appear to be offline. Reconnect and try again.');
        throw lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
  throw lastError || new Error('Unable to reach FitLook right now.');
}

function recordEvent(type, payload = {}) {
  if (!localStorage.getItem('fitlook_token')) return;
  api('/recommendations/events', {
    method: 'POST',
    body: JSON.stringify({ type, ...payload })
  }).catch(() => {});
}

function announce(message, tone = 'success') {
  if (typeof window === 'undefined' || !message) return;
  window.dispatchEvent(new CustomEvent('fitlook:toast', { detail: { message, tone } }));
}

function useProducts(params) {
  const paramKey = JSON.stringify(params || {});
  const query = useMemo(() => {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    return search.toString();
  }, [paramKey]);
  const [state, setState] = useState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: true, error: '' });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const cached = requestVersion === 0 ? productListCache.get(query) : null;
    if (cached && Date.now() - cached.createdAt < PRODUCT_CACHE_TTL_MS) {
      setState(cached.state);
      return () => {
        alive = false;
      };
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(`/products${query ? `?${query}` : ''}`, { signal: controller.signal })
      .then((data) => {
        if (!alive) return;
        const nextState = { products: data.products || [], total: data.total || 0, facets: data.facets || { brands: [], categories: [], categoryCounts: [] }, loading: false, error: '' };
        productListCache.set(query, { createdAt: Date.now(), state: nextState });
        setState(nextState);
      })
      .catch((err) => {
        if (alive && err.name !== 'AbortError') setState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: false, error: err.message });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [query, requestVersion]);

  return { ...state, retry: () => setRequestVersion((current) => current + 1) };
}

function useRecommendedProducts(user, limit = 6) {
  const [state, setState] = useState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: Boolean(user), error: '' });

  useEffect(() => {
    if (!user) {
      setState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: false, error: '' });
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(`/recommendations/for-you?limit=${limit}`, { signal: controller.signal })
      .then((data) => {
        if (alive) setState({ products: data.products || [], total: data.products?.length || 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive && err.name !== 'AbortError') setState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: false, error: err.message });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [user, limit]);

  return state;
}

function useSimilarProducts(id, limit = 4) {
  const [state, setState] = useState({ products: [], loading: true, error: '' });

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const controller = new AbortController();
    setState({ products: [], loading: true, error: '' });
    api(`/recommendations/similar/${encodeURIComponent(id)}?limit=${limit}`, { signal: controller.signal })
      .then((data) => {
        if (alive) setState({ products: data.products || [], loading: false, error: '' });
      })
      .catch((err) => {
        if (alive && err.name !== 'AbortError') setState({ products: [], loading: false, error: err.message });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [id, limit]);

  return state;
}

function useProduct(id) {
  const [state, setState] = useState({ product: null, loading: true, error: '' });

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setState({ product: null, loading: true, error: '' });
    api(`/products/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((data) => {
        if (alive) setState({ product: data.product || null, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive && err.name !== 'AbortError') setState({ product: null, loading: false, error: err.message });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [id]);

  return state;
}

function useWishlistProducts(ids = [], accountId = '') {
  const idKey = useMemo(() => [...new Set((ids || []).map(String).filter(Boolean))].join(','), [ids]);
  const [state, setState] = useState({ products: [], loading: Boolean(idKey), error: '' });
  const [requestVersion, setRequestVersion] = useState(0);
  const syncedAccountRef = useRef('');

  useEffect(() => {
    if (!accountId) syncedAccountRef.current = '';
    const wishlistIds = idKey ? idKey.split(',').filter(Boolean) : [];
    const shouldSyncAccount = Boolean(accountId) && syncedAccountRef.current !== accountId;
    if (wishlistIds.length === 0 && !shouldSyncAccount) {
      setState({ products: [], loading: false, error: '' });
      return undefined;
    }

    let alive = true;
    const controller = new AbortController();
    const savedSnapshots = readWishlistProductSnapshots();
    const cachedProducts = wishlistIds.map((id) => productDetailLocalCache.get(id) || savedSnapshots[id]).filter(Boolean);
    if (!shouldSyncAccount && cachedProducts.length === wishlistIds.length && requestVersion === 0) {
      setState({ products: cachedProducts, loading: false, error: '' });
      return () => {
        alive = false;
      };
    }

    setState((current) => ({ ...current, loading: true, error: '' }));
    const loadLocalProducts = async () => {
      const results = await Promise.allSettled(wishlistIds.map(async (id) => {
        if (requestVersion === 0 && productDetailLocalCache.has(id)) return productDetailLocalCache.get(id);
        const data = await api(`/products/${encodeURIComponent(id)}`, { signal: controller.signal });
        const product = data.product || null;
        if (product) productDetailLocalCache.set(id, product);
        return product;
      }));
      const productsById = new Map();
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) productsById.set(wishlistProductId(result.value), result.value);
      });
      return {
        products: wishlistIds.map((id) => productsById.get(id) || savedSnapshots[id]).filter(Boolean),
        failed: results.filter((result) => result.status === 'rejected').length
      };
    };

    const request = shouldSyncAccount
      ? api('/auth/wishlist/sync', {
        method: 'POST',
        body: JSON.stringify({ productIds: wishlistIds }),
        signal: controller.signal
      }).then((data) => {
        const accountIds = (data.productIds || []).map(String).filter(Boolean);
        const products = data.products || [];
        products.forEach((product) => {
          const productId = wishlistProductId(product);
          if (!productId) return;
          productDetailLocalCache.set(productId, product);
          writeWishlistProductSnapshot(product);
        });
        writeWishlistProductIds(accountIds);
        window.dispatchEvent(new CustomEvent('fitlook:wishlist-change', { detail: { ids: accountIds } }));
        syncedAccountRef.current = accountId;
        return { products, failed: 0, accountSynced: true };
      }).catch(async (accountError) => {
        if (accountError.name === 'AbortError') throw accountError;
        const localResult = await loadLocalProducts();
        return { ...localResult, accountError };
      })
      : loadLocalProducts();

    request
      .then((result) => {
        if (!alive) return;
        const products = result.products || [];
        setState({
          products,
          loading: false,
          error: products.length === 0 && (result.failed || result.accountError)
            ? 'Saved products could not be loaded. Please try again.'
            : ''
        });
      })
      .catch((error) => {
        if (alive && error.name !== 'AbortError') setState({ products: [], loading: false, error: error.message });
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [accountId, idKey, requestVersion]);

  return { ...state, retry: () => setRequestVersion((current) => current + 1) };
}

function useTryOnCache(user, products) {
  const [tryOns, setTryOns] = useState({});
  const productIds = useMemo(
    () => [...new Set((products || []).map((product) => product?.id).filter(Boolean))].slice(0, 96).join(','),
    [products]
  );

  useEffect(() => {
    if (!user || !productIds) {
      setTryOns({});
      return;
    }
    let alive = true;
    const controller = new AbortController();
    api(`/tryons?productIds=${encodeURIComponent(productIds)}`, { signal: controller.signal })
      .then((data) => {
        if (!alive) return;
        const saved = Object.fromEntries((data.tryOns || []).map((tryOn) => [tryOn.productId, tryOn]));
        setTryOns((current) => ({ ...current, ...saved }));
      })
      .catch(() => {});
    return () => {
      alive = false;
      controller.abort();
    };
  }, [user, productIds]);

  return [tryOns, setTryOns];
}

function Header({ user, setUser }) {
  const tokenLabel = user ? `${user.tokens} Tokens` : 'Tokens';
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef(null);
  const desktopSearchRef = useRef(null);
  const mobileSearchRef = useRef(null);
  const [recentSearches, setRecentSearches] = useState(readRecentSearches);
  const currentPath = normalizePath();
  const currentParams = new URLSearchParams(window.location.search);
  const logout = () => {
    localStorage.removeItem('fitlook_token');
    setUser(null);
    setMenuOpen(false);
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const navLinks = [
    ['Home', '/home'],
    ['Category', '/categories'],
    ['Wardrobe', '/closet'],
    ['Custom Try On', '/custom-try-on'],
    ['Wishlist', '/wishlist']
  ];
  const exactQueryActiveHref = navLinks.find(([, href]) => {
    if (!href.includes('?')) return false;
    const [hrefPath, hrefQuery] = href.split('?');
    if (currentPath !== hrefPath) return false;
    const hrefParams = new URLSearchParams(hrefQuery);
    return [...hrefParams.entries()].every(([key, value]) => currentParams.get(key) === value);
  })?.[1];
  const isActiveLink = (href, index) => {
    if (exactQueryActiveHref) return href === exactQueryActiveHref;
    const hrefPath = href.split('?')[0] || '/';
    return currentPath === hrefPath || (currentPath === '/' && index === 0);
  };

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const closeOnOutsidePress = (event) => {
      if (!headerRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePress);
    };
  }, [menuOpen]);

  useEffect(() => {
    const focusSearch = () => {
      if (window.matchMedia('(max-width: 820px)').matches) {
        setMenuOpen(true);
        window.setTimeout(() => mobileSearchRef.current?.focus(), 0);
      } else {
        desktopSearchRef.current?.focus();
      }
    };
    const onKeyDown = (event) => {
      const element = event.target;
      const typing = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusSearch();
      }
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        focusSearch();
      }
      if (event.key === 'Escape' && (element === desktopSearchRef.current || element === mobileSearchRef.current)) {
        element.blur();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const rememberSearch = (event) => {
    const query = new FormData(event.currentTarget).get('q');
    setRecentSearches(saveRecentSearch(query));
    setMenuOpen(false);
  };
  const clearSearch = (target) => {
    if (target === 'mobile') {
      if (mobileSearchRef.current) mobileSearchRef.current.value = '';
      mobileSearchRef.current?.focus();
      return;
    }
    if (desktopSearchRef.current) desktopSearchRef.current.value = '';
    desktopSearchRef.current?.focus();
  };

  return (
    <>
      {currentPath !== '/wishlist' && currentPath !== '/tokens' && currentPath !== '/profile' && <div className="announcement">
        <span>✨</span>
        <span>{user ? <>You have {user.tokens} tokens ready for AI try-on</> : <>Get free tokens on sign up to try AI try-on</>}</span>
        <span>✨</span>
      </div>}
      <header className="site-header" ref={headerRef}>
        <div className="wrap header-inner">
          <div className="header-left">
            <a className="brand" href="/home">FitLook</a>
            <nav className="nav" aria-label="Primary navigation">
              {navLinks.map(([label, href], index) => {
                const active = isActiveLink(href, index);
                return <a className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} href={href} key={label}>{label}</a>;
              })}
            </nav>
          </div>
          <div className="header-search" role="search">
            <form className="search-form" action="/search" onSubmit={rememberSearch}>
              <button className="search-submit" type="submit" aria-label="Search"><SearchIcon /></button>
              <input ref={desktopSearchRef} name="q" type="search" list="fitlook-recent-searches" placeholder="Search curated collections..." defaultValue={currentSearchValue()} aria-label="Search products" aria-keyshortcuts="Control+K Meta+K" title="Search (Ctrl+K)" />
              <button className="search-clear" type="button" aria-label="Clear search" onClick={() => clearSearch('desktop')}><CloseIcon /></button>
            </form>
          </div>
          <div className="header-actions">
            <a className="header-credit-button" href="/tokens" aria-label={user ? `Buy credits. ${tokenLabel} available` : 'Buy credits'}><SparkleLineIcon /><span>Credits</span>{user && <strong>{user.tokens}</strong>}</a>
            {user ? <a className="icon-button" href="/profile" aria-label="Profile"><UserIcon /></a> : <a className="icon-button" href="/login" aria-label="Account"><UserIcon /></a>}
            {user && <button className="text-button" onClick={logout}>Log out</button>}
            <button className="icon-button menu-toggle" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-controls="mobile-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
        <button className={`mobile-menu-overlay ${menuOpen ? 'open' : ''}`} type="button" aria-label="Close menu" tabIndex={menuOpen ? 0 : -1} onClick={() => setMenuOpen(false)} />
        <div className={`mobile-menu ${menuOpen ? 'open' : ''}`} id="mobile-navigation" role="dialog" aria-modal={menuOpen ? 'true' : undefined} aria-label="Mobile navigation">
          <div className="wrap mobile-menu-inner">
            <form className="mobile-search-form" action="/search" role="search" onSubmit={rememberSearch}>
              <button className="search-submit" type="submit" aria-label="Search"><SearchIcon /></button>
              <input ref={mobileSearchRef} name="q" type="search" list="fitlook-recent-searches" placeholder="Search curated collections..." defaultValue={currentSearchValue()} aria-label="Search products" />
              <button className="search-clear" type="button" aria-label="Clear search" onClick={() => clearSearch('mobile')}><CloseIcon /></button>
            </form>
            {navLinks.map(([label, href], index) => {
              const active = isActiveLink(href, index);
              return <a className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} href={href} key={label} onClick={() => setMenuOpen(false)}>{label}</a>;
            })}
            <a href="/tokens" onClick={() => setMenuOpen(false)}>Credits{user ? ` (${user.tokens})` : ''}</a>
            <a href={user ? '/profile' : '/login'} onClick={() => setMenuOpen(false)}>{user ? 'Profile' : 'Account'}</a>
            {user && <button type="button" onClick={logout}>Log out</button>}
          </div>
        </div>
      </header>
      <datalist id="fitlook-recent-searches">
        {recentSearches.map((search) => <option value={search} key={search} />)}
      </datalist>
    </>
  );
}

function Footer({ compact = false }) {
  if (compact) {
    return (
      <footer className="wishlist-compact-footer">
        <div className="wrap wishlist-compact-footer-inner">
          <div className="wishlist-compact-footer-grid">
            <div className="wishlist-compact-brand"><a href="/">FitLook</a><p>Discover personal style through curated fashion and AI-powered try-on.</p><div><a href="https://instagram.com/" target="_blank" rel="noreferrer">IG</a><a href="https://tiktok.com/" target="_blank" rel="noreferrer">TK</a><a href="https://x.com/" target="_blank" rel="noreferrer">X</a></div></div>
            <div><h2>Shop</h2><a href="/search?newArrival=true">New in</a><a href="/search?gender=women">Women</a><a href="/search?gender=men">Men</a><a href="/sale">Sale</a></div>
            <div><h2>Help</h2><a href="/support">Track order</a><a href="/support">Returns</a><a href="/support">Contact us</a><a href="/support">Shipping</a></div>
            <div><h2>Download our App</h2><p>Get the FitLook app for your daily fashion edit.</p><a className="wishlist-app-link" href="/support">App Store</a><a className="wishlist-app-link" href="/support">Google Play</a></div>
          </div>
          <div className="wishlist-compact-footer-bottom"><span>© 2026 FitLook. Curated by intelligence.</span><div><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div></div>
        </div>
      </footer>
    );
  }

  const socialLinks = [
    ['Instagram', 'https://instagram.com/'],
    ['TikTok', 'https://www.tiktok.com/'],
    ['X', 'https://x.com/']
  ];

  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand-block">
            <a className="footer-logo" href="/">FitLook</a>
            <p className="footer-about">Defining the intersection of personal styling and digital try-on. Curated for the modern wardrobe.</p>
            <div className="footer-social" aria-label="Social links">
              {socialLinks.map(([label, href]) => <a href={href} key={label} target="_blank" rel="noreferrer" aria-label={label}>{label.slice(0, 2)}</a>)}
            </div>
          </div>
          <FooterCol title="Collections" links={[['New Arrivals', '/search?newArrival=true'], ["Men's Edit", '/search?gender=men'], ["Women's Edit", '/search?gender=women'], ['Accessories', '/search?category=accessories'], ['Seasonal Sale', '/sale']]} />
          <FooterCol title="Company" links={[['Journal', '/blog'], ['Sustainability', '/about'], ['Virtual Atelier', '/custom-try-on'], ['Contact', '/contact'], ['Shipping', '/support']]} />
          <FooterCol title="Assurance" links={[['100% Secure Payment', '/support'], ['24/7 Dedicated Support', '/support'], ['30-Day Effortless Returns', '/support']]} />
          <div className="newsletter"><h3>Newsletter</h3><p>Early access to seasonal drops, private invitations, and high-fashion insights.</p><form className="newsletter-form" onSubmit={(event) => event.preventDefault()}><input type="email" placeholder="Your email address" aria-label="Email address" /><button type="submit">Subscribe</button></form></div>
        </div>
        <div className="footer-bottom"><div>© 2026 FitLook. All rights reserved.</div><div className="legal"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/accessibility">Accessibility</a></div></div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`footer-col ${open ? 'open' : ''}`}>
      <button className="footer-col-toggle" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <h3>{title}</h3>
        <span aria-hidden="true">+</span>
      </button>
      <ul>{links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}</ul>
    </div>
  );
}

function FloatingStylistLauncher({ user }) {
  const openStylist = () => {
    const href = user ? '/style-bot' : '/signup?returnTo=/style-bot';
    window.history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openStylist();
    }
  };

  return (
    <button
      className="ai-stylist-launcher"
      type="button"
      aria-label="Open AI Stylist"
      title="Open AI Stylist"
      onClick={openStylist}
      onKeyDown={handleKeyDown}
    >
      <span><SparkleLineIcon /></span>
      <strong>AI Stylist</strong>
      <small>Ask looks</small>
    </button>
  );
}

function Hero({ compact = false }) {
  const slide = {
    kicker: 'New Collection',
    title: <>Summer<br /><em>Essentials</em></>,
    copy: 'Drop now live',
    cta: 'Shop Now',
    href: '/search?newArrival=true',
    image: compact ? 'hero2.png' : 'hero1.png'
  };

  return (
    <section className="hero">
      <div className="wrap">
        <div className={compact ? 'hero-panel compact' : 'hero-panel'}>
          <OptimizedImage className="hero-bg" src={asset(slide.image)} alt="" eager />
          <div className="hero-card">
            <span className="hero-kicker">{slide.kicker}</span>
            <h1 className="hero-title">{slide.title}</h1>
            <p className="hero-copy">{slide.copy}</p>
            <a className="hero-cta" href={slide.href}>{slide.cta} <span>→</span></a>
          </div>
          {!compact && (
            <div className="hero-offer-badge" aria-label="Up to 50% off">
              <span>Up to</span>
              <strong>50%</strong>
              <small>Off</small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AtelierIcon({ name }) {
  const paths = {
    clock: <><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></>,
    sparkle: <><path d="M12 3l2.286 6.857L21 12l-6.714 2.143L12 21l-2.286-6.857L3 12l6.714-2.143L12 3Z" /><path d="M5 3v4M3 5h4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2 2.4 3 5.4 3 9s-1 6.6-3 9c-2-2.4-3-5.4-3-9s1-6.6 3-9Z" /></>,
    arrowLeft: <path d="m15 19-7-7 7-7" />,
    arrowRight: <path d="m9 5 7 7-7 7" />,
    twitter: <path d="M4 5.5c3 2 5.2 3.2 7.1 3.7C11 6.5 12.1 5 13.8 5c1.2 0 2.1.5 2.7 1.4.8-.2 1.5-.5 2.2-.9-.3.9-.9 1.6-1.7 2 .8-.1 1.5-.3 2.2-.6-.5.8-1.1 1.5-1.8 2.1.1 4.8-3.3 10.2-9.7 10.2-1.9 0-3.7-.6-5.2-1.5 1.8.2 3.5-.3 4.8-1.3-1.5 0-2.7-1-3.1-2.4.5.1 1 .1 1.5-.1-1.6-.3-2.7-1.7-2.7-3.3.4.2.9.4 1.4.4C2.9 8.9 2.6 7 3.5 5.5Z" />,
    instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r=".7" fill="currentColor" stroke="none" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m3 7 9 6 9-6" /></>,
    shield: <path d="M12 3 4.5 6v5.5c0 4.7 3 8.2 7.5 9.5 4.5-1.3 7.5-4.8 7.5-9.5V6L12 3Z" />,
    support: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>
  };
  return <svg className="atelier-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const atelierHeroSlides = [
  {
    id: 'ai-try-on',
    image: 'home-hero-editorial.png',
    position: '57% 18%',
    kicker: 'AI Fashion Try-On',
    title: <>See Yourself<br />In Every Look</>,
    copy: 'Experience the future of fashion with AI-powered virtual try-on. Upload, try, and find your perfect style.',
    primaryLabel: 'Start AI Try-On',
    primaryHref: '/custom-try-on',
    secondaryLabel: 'Explore Collections',
    secondaryHref: '/categories'
  },
  {
    id: 'women-edit',
    image: 'category-women-hero.png',
    position: '64% center',
    kicker: 'Women’s Edit',
    title: <>Light Layers<br />Sharp Intent</>,
    copy: 'Discover clean tailoring, elevated essentials, and pieces selected for everyday confidence.',
    primaryLabel: 'Shop Women',
    primaryHref: '/categories?gender=women',
    secondaryLabel: 'Try A Look',
    secondaryHref: '/custom-try-on'
  },
  {
    id: 'men-edit',
    image: 'category-men-hero.png',
    position: '65% center',
    kicker: 'Men’s Edit',
    title: <>Modern Ease<br />Daily Style</>,
    copy: 'Build refined outfits from shirts, shoes, sunglasses, caps, and essentials already in the live catalog.',
    primaryLabel: 'Shop Men',
    primaryHref: '/categories?gender=men',
    secondaryLabel: 'Open Wardrobe',
    secondaryHref: '/closet'
  }
];

function AtelierHome() {
  const state = useProducts({ limit: 96, sort: 'newest' });
  const arrivalsRailRef = useRef(null);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const catalogProducts = useMemo(
    () => (state.products || []).filter((product) => product?.id && product?.imageUrl),
    [state.products]
  );
  const newArrivalProducts = catalogProducts.filter((product) => product.isNewArrival);
  const arrivalProducts = [...newArrivalProducts, ...catalogProducts.filter((product) => !product.isNewArrival)].slice(0, 12);
  const promoProducts = catalogProducts.slice(4, 6);
  const lookProducts = useMemo(() => {
    const outfitCategories = ['tops', 'dresses', 'jeans', 'shirts', 't-shirts', 'jackets', 'shorts', 'pants', 'sleepwear'];
    const excludedCategories = new Set(['eyewear', 'accessories', 'shoes', 'innerwear']);
    const usedIds = new Set();
    const usedCategories = new Set();
    const selected = [];
    const genderRank = (product) => {
      const gender = String(product.gender || '').toLowerCase();
      if (gender === 'women') return 0;
      if (gender === 'unisex') return 1;
      if (gender === 'men') return 2;
      return 3;
    };
    const outfitPool = catalogProducts
      .filter((product) => !excludedCategories.has(categorySlug(product.category)))
      .sort((a, b) => genderRank(a) - genderRank(b));

    outfitCategories.forEach((slug) => {
      if (selected.length >= 3) return;
      const product = outfitPool.find((item) => (
        categorySlug(item.category) === slug
        && !usedIds.has(item.id)
        && !usedCategories.has(slug)
      ));
      if (!product) return;
      selected.push(product);
      usedIds.add(product.id);
      usedCategories.add(slug);
    });

    outfitPool.forEach((product) => {
      if (selected.length >= 3 || usedIds.has(product.id)) return;
      selected.push(product);
      usedIds.add(product.id);
    });

    return selected;
  }, [catalogProducts]);
  const categoryCards = useMemo(() => {
    const counts = state.facets?.categoryCounts || [];
    return counts
      .map(({ category, count }) => {
        const slug = categorySlug(category);
        const product = catalogProducts.find((item) => categorySlug(item.category) === slug);
        return product ? { category, count, product, slug, collectionVisual: collectionVisualForCategory(category) } : null;
      })
      .filter(Boolean)
      .slice(0, 7);
  }, [catalogProducts, state.facets]);
  const heroSlide = atelierHeroSlides[heroSlideIndex] || atelierHeroSlides[0];

  useEffect(() => {
    if (atelierHeroSlides.length < 2) return undefined;
    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReducedMotion) return undefined;
    const timer = window.setInterval(() => {
      setHeroSlideIndex((current) => (current + 1) % atelierHeroSlides.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, []);

  const scrollArrivals = (direction) => {
    const rail = arrivalsRailRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(rail.clientWidth * .82, 300), behavior: 'smooth' });
  };

  const handleArrivalRailKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    scrollArrivals(event.key === 'ArrowRight' ? 1 : -1);
  };

  return (
    <div className="atelier-home">
      <main>
        <section className="atelier-hero atelier-hero-editorial" aria-label="FitLook AI fashion try-on">
          <div className="atelier-hero-editorial-slides" aria-hidden="true">
            {atelierHeroSlides.map((slide, index) => (
              <OptimizedImage
                className={`atelier-hero-editorial-image ${index === heroSlideIndex ? 'active' : ''}`}
                src={asset(slide.image)}
                alt=""
                eager={index === 0}
                key={slide.id}
                style={{ objectPosition: slide.position }}
              />
            ))}
          </div>
          <div className="atelier-hero-editorial-scrim" aria-hidden="true" />
          <div className="atelier-hero-editorial-orbits" aria-label="FitLook tools">
            <a className="atelier-hero-orbit atelier-hero-orbit-custom" href="/custom-try-on"><UploadCloudIcon /><strong>Custom<br />Try-On</strong></a>
            <a className="atelier-hero-orbit atelier-hero-orbit-wardrobe" href="/closet"><ClosetIcon /><strong>Wardrobe</strong><small>Style every day</small></a>
          </div>
          <div className="atelier-hero-editorial-content">
            <div className="atelier-hero-editorial-copy" key={heroSlide.id}>
              <span>{heroSlide.kicker}</span>
              <h1>{heroSlide.title}</h1>
              <p>{heroSlide.copy}</p>
              <div>
                <a className="atelier-hero-editorial-primary" href={heroSlide.primaryHref}><SparkleLineIcon /> {heroSlide.primaryLabel}</a>
                <a className="atelier-hero-editorial-secondary" href={heroSlide.secondaryHref}>{heroSlide.secondaryLabel}</a>
              </div>
            </div>
          </div>
          <div className="atelier-hero-editorial-dots" aria-label="Hero slides">
            {atelierHeroSlides.map((slide, index) => (
              <button
                className={index === heroSlideIndex ? 'active' : ''}
                type="button"
                aria-label={`Show ${slide.kicker} slide`}
                aria-pressed={index === heroSlideIndex}
                key={slide.id}
                onClick={() => setHeroSlideIndex(index)}
              />
            ))}
          </div>
        </section>

        <section className="atelier-quick-links" aria-label="FitLook benefits">
          <div className="atelier-wide atelier-quick-grid">
            {[
              ['clock', 'New Arrivals', 'Updated Daily'],
              ['sparkle', 'AI Stylist', 'Personalized Fits'],
              ['globe', 'World Delivery', 'Express Shipping']
            ].map(([icon, title, copy]) => <div className="atelier-quick-item" key={title}><span className="atelier-quick-icon"><AtelierIcon name={icon} /></span><span><strong>{title}</strong><small>{copy}</small></span></div>)}
          </div>
        </section>

        <section className="atelier-category-section">
          <div className="atelier-wide">
            <div className="atelier-section-heading"><h2>Shop by Category</h2><a className="atelier-text-link" href="/categories">View All Departments <span>→</span></a></div>
            <div className="atelier-category-grid">
              {categoryCards.map(({ category, count, slug, collectionVisual }) => <a className={`atelier-category category-icon-${slug}`} href={categoryPageHref(category)} key={slug}><div className="atelier-category-image"><OptimizedImage src={asset(collectionVisual.image)} alt={`${displayCategory({ category })} category`} style={{ objectPosition: collectionVisual.position }} /></div><span>{displayCategory({ category })} <small>{count}</small></span></a>)}
            </div>
          </div>
        </section>

        {promoProducts.length > 0 && <section className="atelier-promos atelier-wide" aria-label="Featured products">
          {promoProducts.map((product) => <article className="atelier-promo atelier-promo-sale" key={product.id}><a className="atelier-promo-link" href={`/product/${encodeURIComponent(product.id)}`}><div><span className="atelier-eyebrow">{displayCategory(product)}</span><h3>{product.name}</h3><p>{displayBrand(product)} · {formatMoney(product.price || 0, product.currency)}</p><span className="atelier-text-link">View Product →</span></div><OptimizedImage src={product.imageUrl} alt={product.name} /></a><WishlistHeartButton product={product} className="card-wishlist-heart" /></article>)}
        </section>}

        <section className="atelier-arrivals">
          <div className="atelier-wide">
            <div className="atelier-section-heading"><h2>Curated New Arrivals</h2><div className="atelier-product-arrows"><button type="button" aria-label="Previous arrivals" aria-controls="new-arrivals-rail" onClick={() => scrollArrivals(-1)}><AtelierIcon name="arrowLeft" /></button><button type="button" aria-label="Next arrivals" aria-controls="new-arrivals-rail" onClick={() => scrollArrivals(1)}><AtelierIcon name="arrowRight" /></button></div></div>
            <div className="atelier-product-grid atelier-arrivals-rail" id="new-arrivals-rail" ref={arrivalsRailRef} tabIndex="0" aria-label="Curated new arrivals" onKeyDown={handleArrivalRailKeyDown}>
              {arrivalProducts.map((product) => <article className="atelier-product" key={product.id}><a className="atelier-product-image" href={`/product/${encodeURIComponent(product.id)}`}>{product.badge && <span className="atelier-best-seller">{product.badge}</span>}<OptimizedImage src={product.imageUrl} alt={product.name} /><span className="atelier-product-quick-link">View Product</span></a><WishlistHeartButton product={product} className="card-wishlist-heart" /><span className="atelier-product-category">{displayCategory(product)}</span><h3>{product.name}</h3><div className="atelier-price"><strong>{formatMoney(product.price || 0, product.currency)}</strong>{product.compareAtPrice && product.compareAtPrice > product.price && <del>{formatMoney(product.compareAtPrice, product.currency)}</del>}</div></article>)}
              {arrivalProducts.length > 0 && <a className="atelier-arrivals-more" href="/search?newArrival=true"><span>New arrivals</span><strong>View more</strong><small>Explore the full edit <b>→</b></small></a>}
            </div>
          </div>
        </section>

        {lookProducts.length > 0 && <section className="atelier-lookbook atelier-wide">
          <div className="atelier-lookbook-heading"><span className="atelier-eyebrow">Editorial</span><h2>Shop the Look</h2></div>
          <div className="atelier-lookbook-grid">
            {lookProducts[0] && <article className="atelier-look atelier-look-large"><a className="atelier-look-link" href={`/product/${encodeURIComponent(lookProducts[0].id)}`}><OptimizedImage src={lookProducts[0].imageUrl} alt={lookProducts[0].name} /><div><h3>{lookProducts[0].name}</h3><p>{displayCategory(lookProducts[0])} · {displayBrand(lookProducts[0])}</p><span>View Product</span></div></a><WishlistHeartButton product={lookProducts[0]} className="card-wishlist-heart" /></article>}
            {lookProducts.length > 1 && <div className="atelier-lookbook-side">{lookProducts.slice(1, 3).map((product) => <article className="atelier-look" key={product.id}><a className="atelier-look-link" href={`/product/${encodeURIComponent(product.id)}`}><OptimizedImage src={product.imageUrl} alt={product.name} /><div><h3>{product.name}</h3><p>{displayCategory(product)} · {displayBrand(product)}</p><span>View Product</span></div></a><WishlistHeartButton product={product} className="card-wishlist-heart" /></article>)}</div>}
          </div>
        </section>}

        <section className="atelier-newsletter">
          <div className="atelier-newsletter-inner">
            <h2>Join the Atelier</h2>
            <p>Subscribe for private access to new edits, styling notes, and seasonal arrivals.</p>
            <form onSubmit={(event) => event.preventDefault()}>
              <input type="email" placeholder="Your Email Address" aria-label="Your Email Address" />
              <button type="submit">Subscribe</button>
            </form>
            <small>By signing up you agree to our privacy policy</small>
          </div>
        </section>
      </main>
    </div>
  );
}

function Home() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.history.pushState({}, '', '/home');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="opening-page" aria-labelledby="opening-title">
      <OptimizedImage className="opening-page-image" src={asset('opening-editorial-hero.png')} alt="A woman and man in tailored outerwear" eager />
      <div className="opening-page-overlay" aria-hidden="true" />
      <section className="opening-page-content">
        <a className="opening-page-brand" href="/" id="opening-title">FitLook</a>
        <p>Personal style, considered.</p>
        <nav className="opening-page-actions" aria-label="Start exploring FitLook">
          <a href="/search?gender=women">Women's edit</a>
          <a className="opening-page-shop" href="/search">Shop FitLook</a>
          <a href="/search?gender=men">Men's edit</a>
        </nav>
        <a className="opening-page-enter" href="/custom-try-on">AI Try-On</a>
      </section>
    </main>
  );
}

function ProductSection({ title, href, state, user, eyebrow = '', copy = '', limit = 6, className = '' }) {
  const { products, loading, error, retry } = state;
  const displayProducts = products.slice(0, limit);
  const [tryOns] = useTryOnCache(user, displayProducts);
  return (
    <section className={`section product-section ${className}`.trim()}>
      <div className="wrap">
        <div className="section-head"><div>{eyebrow && <p className="kicker">{eyebrow}</p>}<h2>{title}</h2>{copy && <p className="section-copy">{copy}</p>}</div><a className="view-all" href={href}>View all ›</a></div>
        {loading && <ProductGridSkeleton count={limit} />}
        {error && <StatusPanel text={error} onRetry={retry} />}
        {!loading && !error && products.length === 0 && <EmptyProducts />}
        {!loading && !error && products.length > 0 && <div className="product-grid">{displayProducts.map((product) => <ProductCard key={product.id} product={product} user={user} tryOn={tryOns[product.id]} />)}</div>}
      </div>
    </section>
  );
}

function HomePromoBand() {
  return (
    <section className="home-promo-band" aria-label="FitLook offers">
      <div className="wrap home-promo-grid">
        <a className="home-promo-card dark" href="/sale">
          <span className="home-promo-icon" aria-hidden="true"><TagIcon /></span>
          <span>
            <small>Limited Time Offer</small>
            <strong>Up To 50% Off</strong>
          </span>
        </a>
        <a className="home-promo-card light" href="/support">
          <span className="home-promo-icon" aria-hidden="true"><GlobeIcon /></span>
          <span>
            <strong>Free Shipping</strong>
            <small>On eligible brand orders</small>
          </span>
        </a>
      </div>
    </section>
  );
}

const homeLookTargets = [
  { label: 'Innerwear', slug: 'innerwear', match: /\b(inner\s?wear|underwear|briefs?|boxers?|vests?|camisoles?)\b/i },
  { label: 'Shirts', slug: 'shirts', match: /\b(shirts?|button[-\s]?down|formal shirt|casual shirt)\b/i },
  { label: 'Lingerie', slug: 'lingerie', match: /\b(lingerie|lingeries|bra|bralette|panty|panties)\b/i }
];

function productLookText(product = {}) {
  return [
    product.name,
    product.category,
    product.brand,
    product.description,
    Array.isArray(product.tags) ? product.tags.join(' ') : product.tags
  ].filter(Boolean).join(' ');
}

function productLookCategorySlug(product = {}) {
  return categorySlug(product.category || displayCategory(product));
}

function buildHomeLooks(products = []) {
  const usableProducts = products.filter((product) => product?.imageUrl);
  const usedProductIds = new Set();
  const usedCategories = new Set();
  const looks = [];

  homeLookTargets.forEach((target) => {
    const product = usableProducts.find((item) => !usedProductIds.has(item.id) && target.match.test(productLookText(item)));
    if (!product) return;
    usedProductIds.add(product.id);
    usedCategories.add(productLookCategorySlug(product));
    looks.push({
      label: target.label,
      image: product.imageUrl,
      href: `/search?category=${encodeURIComponent(productLookCategorySlug(product) || target.slug)}`,
      productName: product.name
    });
  });

  usableProducts.forEach((product) => {
    if (looks.length >= 3) return;
    const slug = productLookCategorySlug(product);
    if (usedProductIds.has(product.id) || usedCategories.has(slug)) return;
    usedProductIds.add(product.id);
    usedCategories.add(slug);
    looks.push({
      label: displayCategory(product),
      image: product.imageUrl,
      href: `/search?category=${encodeURIComponent(slug)}`,
      productName: product.name
    });
  });

  usableProducts.forEach((product) => {
    if (looks.length >= 3 || usedProductIds.has(product.id)) return;
    usedProductIds.add(product.id);
    looks.push({
      label: displayCategory(product),
      image: product.imageUrl,
      href: `/search?category=${encodeURIComponent(productLookCategorySlug(product))}`,
      productName: product.name
    });
  });

  return looks.slice(0, 3);
}

function HomeLookbook({ products = [], loading = false }) {
  const looks = useMemo(() => buildHomeLooks(products), [products]);
  if (!loading && looks.length === 0) return null;

  return (
    <section className="home-lookbook section" aria-label="Shop the look">
      <div className="wrap">
        <div className="section-head"><div><p className="kicker">Collections</p><h2>Shop the Look</h2></div><a className="view-all" href="/search?newArrival=true">View More ↗</a></div>
        <div className="home-lookbook-grid">
          {loading && looks.length === 0 && Array.from({ length: 3 }).map((_, index) => <div className="home-look-card home-look-skeleton" key={index} />)}
          {looks.map((look) => (
            <a className="home-look-card" href={look.href} key={`${look.label}-${look.image}`}>
              <OptimizedImage src={look.image} alt={look.productName || look.label} />
              <span><strong>{look.label}</strong><small>{look.productName}</small></span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function NewsletterSection() {
  return (
    <section className="home-newsletter" aria-labelledby="home-newsletter-title">
      <div className="wrap home-newsletter-inner">
        <SparkleLineIcon />
        <h2 id="home-newsletter-title">Join the Atelier</h2>
        <p>Subscribe to receive early access to seasonal drops, private invitations to the Virtual Atelier, and high-fashion insights.</p>
        <form className="home-newsletter-form" onSubmit={(event) => event.preventDefault()}>
          <input type="email" placeholder="Your email address" aria-label="Email address" />
          <button type="submit">Subscribe</button>
        </form>
      </div>
    </section>
  );
}

const categoryHeroSlides = [
  {
    kicker: 'Summer Collection',
    title: 'The Art Of Summer',
    copy: 'Lightweight layers, refined textures, and warm-weather staples from the live catalog.',
    image: 'hero2.png',
    href: '/search?newArrival=true',
    cta: 'Shop Now'
  },
  {
    kicker: 'Wardrobe Refresh',
    title: 'Modern Essentials',
    copy: 'Build polished everyday looks from categories already connected to your store.',
    image: 'hero1.png',
    href: '/search?featured=true',
    cta: 'Explore Edit'
  },
  {
    kicker: 'Evening Edit',
    title: 'Curated Occasionwear',
    copy: 'Discover sharper silhouettes, premium separates, and AI-ready outfit ideas.',
    image: 'arrival-4.jpg',
    href: '/search?category=dresses',
    cta: 'View Styles'
  },
  {
    kicker: 'Street Style',
    title: 'Layered Looks',
    copy: 'Casual staples and new arrivals arranged for quick category discovery.',
    image: 'trending-3.jpg',
    href: '/search?newArrival=true',
    cta: 'Browse Now'
  }
];

function CategoryHeroSlider({ products = [] }) {
  const [activeSlide, setActiveSlide] = useState(0);
  const slide = categoryHeroSlides[activeSlide];
  const heroProduct = products.filter((product) => product?.imageUrl)[activeSlide % Math.max(products.filter((product) => product?.imageUrl).length, 1)];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % categoryHeroSlides.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, []);

  const goToSlide = (index) => setActiveSlide((index + categoryHeroSlides.length) % categoryHeroSlides.length);

  return (
    <section className="category-hero" aria-label="Featured category collections">
      {categoryHeroSlides.map((item, index) => (
        <div className={`category-hero-slide ${index === activeSlide ? 'active' : ''}`} key={item.title} aria-hidden={index !== activeSlide}>
          <OptimizedImage className="category-hero-bg" src={asset(item.image)} alt="" eager={index === 0} />
        </div>
      ))}
      <div className="category-hero-scrim" aria-hidden="true" />
      <div className="wrap category-page-head">
        <div className="category-hero-copy">
          <p className="category-kicker">{slide.kicker}</p>
          <h1>{slide.title}</h1>
          <p className="lead">{slide.copy}</p>
          <a className="category-hero-cta" href={slide.href}>{slide.cta} <span>→</span></a>
        </div>
        <div className="category-hero-card" aria-label="Featured product preview">
          {heroProduct ? (
            <a href={`/product/${encodeURIComponent(heroProduct.id)}`}>
              <OptimizedImage src={heroProduct.imageUrl} alt={heroProduct.name} />
              <span>
                <small>{displayCategory(heroProduct)}</small>
                <strong>{heroProduct.name}</strong>
                <em>{formatMoney(heroProduct.price || 0, heroProduct.currency)}</em>
              </span>
            </a>
          ) : (
            <a href={slide.href}>
              <span>
                <small>Featured Edit</small>
                <strong>{slide.title}</strong>
                <em>Explore now</em>
              </span>
            </a>
          )}
        </div>
      </div>
      <div className="category-hero-controls" aria-label="Category banner controls">
        <button type="button" onClick={() => goToSlide(activeSlide - 1)} aria-label="Previous banner">‹</button>
        <div className="category-hero-dots" aria-label="Select banner">
          {categoryHeroSlides.map((item, index) => (
            <button className={index === activeSlide ? 'active' : ''} type="button" onClick={() => goToSlide(index)} aria-label={`Show ${item.title}`} key={item.title} />
          ))}
        </div>
        <button type="button" onClick={() => goToSlide(activeSlide + 1)} aria-label="Next banner">›</button>
      </div>
    </section>
  );
}

function CategoryPromoTiles() {
  return (
    <section className="category-promo-section" aria-label="Category offers">
      <div className="wrap category-promo-grid">
        <a className="category-promo-card sale" href="/sale">
          <OptimizedImage src={asset('category-6.jpg')} alt="" />
          <span>
            <small>Big Summer</small>
            <strong>Big Sale</strong>
            <em>Up to 70% off selected drops</em>
          </span>
        </a>
        <a className="category-promo-card shipping" href="/support">
          <span className="category-promo-icon" aria-hidden="true"><GlobeIcon /></span>
          <span>
            <strong>Free Shipping</strong>
            <small>On eligible brand orders</small>
            <em>Shop Now →</em>
          </span>
        </a>
      </div>
    </section>
  );
}

function CategoryCollections({ categories: categoryGroups = [], user }) {
  const collections = categoryGroups.filter((category) => category.products.length > 0);
  if (!collections.length) return null;

  return (
    <section className="category-collections-section" aria-labelledby="category-collections-title">
      <div className="wrap">
        <div className="category-reference-head">
          <div>
            <p className="category-kicker dark">All Collections</p>
            <h2 id="category-collections-title">Shop category wise</h2>
          </div>
          <a className="category-view-all" href="/search">View full catalog →</a>
        </div>

        <div className="category-collection-list">
          {collections.map((category) => {
            const categoryImage = category.products.find((product) => product.imageUrl)?.imageUrl || asset(category.fallbackImage);
            return (
              <article className="category-collection-panel" key={category.slug}>
                <div className="category-collection-head">
                  <div className="category-collection-title">
                    <OptimizedImage src={categoryImage} alt="" />
                    <div>
                      <p>{category.products.length} pieces</p>
                      <h3>{category.label}</h3>
                    </div>
                  </div>
                  <a href={`/search?category=${encodeURIComponent(category.slug)}`}>View Collection →</a>
                </div>
                <div className="category-collection-row" aria-label={`${category.label} products`}>
                  {category.products.map((product) => (
                    <ProductCard key={`${category.slug}-${product.id}`} product={product} user={user} />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const categoryAudienceOptions = [
  { label: 'Women', value: 'women', aliases: ['women', 'woman', 'female', 'ladies'], image: 'category-icons/women-section.png' },
  { label: 'Men', value: 'men', aliases: ['men', 'man', 'male', 'gentlemen'], image: 'category-icons/men-section.png' },
  { label: 'Girls', value: 'girls', aliases: ['girls', 'girl'] },
  { label: 'Boys', value: 'boys', aliases: ['boys', 'boy'] },
  { label: 'Teens', value: 'teens', aliases: ['teens', 'teen'] },
  { label: 'Kids', value: 'kids', aliases: ['kids', 'kid', 'children', 'child'] },
  { label: 'Unisex', value: 'unisex', aliases: ['unisex'], image: 'category-icons/unisex-section.png' }
];

function categoryAudienceForProduct(product) {
  const gender = categorySlug(product?.gender);
  return categoryAudienceOptions.find((audience) => audience.aliases.includes(gender)) || null;
}

function isFashionCatalogProduct(product) {
  const catalogText = [
    product?.name,
    product?.brand,
    product?.category,
    product?.description,
    Array.isArray(product?.tags) ? product.tags.join(' ') : product?.tags
  ].filter(Boolean).join(' ');

  return styleBotCompatibility(catalogText).compatible || /\b(ethnic|apparel|fashion|clothing)\b/i.test(catalogText);
}

function categoryLabel(value) {
  return String(value || 'Uncategorized')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Uncategorized';
}

function categoryPageHref(category, gender = '') {
  const query = new URLSearchParams();
  if (gender) query.set('gender', gender);
  const suffix = query.toString() ? `?${query}` : '';
  return `/categories/${encodeURIComponent(categorySlug(category))}${suffix}`;
}

function AtelierCategoriesPage() {
  const [activeAudience, setActiveAudience] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [sortFilter, setSortFilter] = useState('newest');
  const state = useProducts({ limit: 96, sort: 'newest' });

  const catalog = useMemo(() => {
    const fashionProducts = (state.products || []).filter((product) => (
      product?.id && product?.imageUrl && isFashionCatalogProduct(product)
    ));
    const audienceCards = categoryAudienceOptions.map((audience) => {
      const products = fashionProducts.filter((product) => categoryAudienceForProduct(product)?.value === audience.value);
      if (!products.length) return null;
      return {
        ...audience,
        count: products.length,
        product: products[0],
        genderFilter: categorySlug(products[0].gender)
      };
    }).filter(Boolean);
    const selectedProducts = activeAudience === 'all'
      ? fashionProducts
      : fashionProducts.filter((product) => categoryAudienceForProduct(product)?.value === activeAudience);
    const filterCategories = [...selectedProducts.reduce((map, product) => {
      const category = String(product.category || '').trim();
      if (!category) return map;
      const key = categorySlug(category);
      const existing = map.get(key) || { value: key, label: categoryLabel(category), count: 0 };
      existing.count += 1;
      map.set(key, existing);
      return map;
    }, new Map()).values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const filterBrands = usableBrands([...selectedProducts.reduce((map, product) => {
      const brand = displayBrand(product);
      if (!brand || brand === 'Marketplace brand') return map;
      const key = brand.toLowerCase();
      const existing = map.get(key) || { value: brand, label: brand, count: 0 };
      existing.count += 1;
      map.set(key, existing);
      return map;
    }, new Map()).values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).map((brand) => brand.label))
      .map((brand) => {
        const match = selectedProducts.filter((product) => displayBrand(product) === brand).length;
        return { value: brand, label: brand, count: match };
      });
    const filteredProducts = selectedProducts
      .filter((product) => categoryFilter === 'all' || categorySlug(product.category) === categoryFilter)
      .filter((product) => brandFilter === 'all' || displayBrand(product) === brandFilter)
      .sort((a, b) => {
        if (sortFilter === 'price-low') return Number(a.price || 0) - Number(b.price || 0);
        if (sortFilter === 'price-high') return Number(b.price || 0) - Number(a.price || 0);
        if (sortFilter === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
        return new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0);
      });
    const makeCategorySections = (products) => {
      const groups = products.reduce((categoryGroups, product) => {
        const category = String(product.category || '').trim();
        if (!category) return categoryGroups;
        const key = categorySlug(category);
        if (!categoryGroups.has(key)) categoryGroups.set(key, { category, products: [] });
        categoryGroups.get(key).products.push(product);
        return categoryGroups;
      }, new Map());

      return [...groups.values()]
        .map(({ category, products: categoryProducts }) => ({
          category,
          label: categoryLabel(category),
          count: categoryProducts.length,
          representative: categoryProducts[0],
          collectionVisual: collectionVisualForCategory(category, activeAudience),
          products: categoryProducts.slice(0, 6)
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    };
    const categorySections = makeCategorySections(filteredProducts);

    return {
      audienceCards,
      fashionProductCount: fashionProducts.length,
      featuredProduct: selectedProducts[0] || null,
      quickCategories: makeCategorySections(selectedProducts).slice(0, 20),
      filterCategories,
      filterBrands,
      filteredProductCount: filteredProducts.length,
      categorySections,
      selectedAudience: audienceCards.find((audience) => audience.value === activeAudience) || null
    };
  }, [activeAudience, brandFilter, categoryFilter, sortFilter, state.products]);

  useEffect(() => {
    setCategoryFilter('all');
    setBrandFilter('all');
    setSortFilter('newest');
  }, [activeAudience]);

  const resetCategoryFilters = () => {
    setCategoryFilter('all');
    setBrandFilter('all');
    setSortFilter('newest');
  };
  const filtersActive = categoryFilter !== 'all' || brandFilter !== 'all' || sortFilter !== 'newest';

  const categoryHref = (category) => {
    return categoryPageHref(category, catalog.selectedAudience?.genderFilter || '');
  };
  const categoryHero = activeAudience === 'all'
    ? {
      imageUrl: asset('category-all-hero.png'),
      alt: 'A woman and a man in modern everyday looks',
      href: '/search',
      category: 'All fashion',
      title: 'Style for Every Day',
      cta: 'Explore All Fashion',
      campaign: 'all'
    }
    : activeAudience === 'women'
      ? {
      imageUrl: asset('category-women-hero.png'),
      alt: 'Two women in tailored neutral looks',
      href: '/search?gender=women',
      category: "Women's edit",
      title: 'Tailored for Every Day',
      cta: "Shop Women's Fashion",
      campaign: 'women'
    }
    : activeAudience === 'men'
      ? {
        imageUrl: asset('category-men-hero.png'),
        alt: 'Two men in modern tailored looks',
        href: '/search?gender=men',
        category: "Men's edit",
        title: 'Modern Essentials',
        cta: "Shop Men's Fashion",
        campaign: 'men'
      }
      : activeAudience === 'unisex'
        ? {
          imageUrl: asset('category-unisex-hero.png'),
          alt: 'A woman and a man in coordinated modern looks',
          href: '/search?gender=unisex',
          category: 'Unisex edit',
          title: 'Style Without Limits',
          cta: 'Shop Unisex Fashion',
          campaign: 'unisex'
        }
        : catalog.featuredProduct && {
          imageUrl: catalog.featuredProduct.imageUrl,
          alt: catalog.featuredProduct.name,
          href: `/product/${encodeURIComponent(catalog.featuredProduct.id)}`,
          category: displayCategory(catalog.featuredProduct),
          title: catalog.featuredProduct.name,
          cta: `View Product · ${formatMoney(catalog.featuredProduct.price || 0, catalog.featuredProduct.currency)}`,
          campaign: ''
        };

  return (
    <div className="atelier-category-page">
      <main className="atelier-category-main">
        <section className="atelier-category-title-section">
          <div className="atelier-category-wide atelier-category-title-row">
            <h1>The Categories</h1>
          </div>
        </section>

        {categoryHero && <section className="atelier-category-wide atelier-category-hero-section">
          <a className={`atelier-category-hero${categoryHero.campaign ? ` atelier-category-hero-${categoryHero.campaign}` : ''}`} href={categoryHero.href}>
            <OptimizedImage src={categoryHero.imageUrl} alt={categoryHero.alt} eager />
            <span className="atelier-category-hero-scrim" aria-hidden="true" />
            <span className="atelier-category-hero-copy"><small>{categoryHero.category}</small><strong>{categoryHero.title}</strong><em>{categoryHero.cta}</em></span>
          </a>
        </section>}

        {catalog.quickCategories.length > 0 && <section className="atelier-category-wide atelier-category-quick-section" aria-labelledby="category-quick-title">
          <div className="atelier-category-quick-heading"><p id="category-quick-title">Explore fashion</p><span>Live catalog</span></div>
          <nav className="atelier-category-quick-rail" aria-label="Fashion categories">
            {catalog.quickCategories.map((category) => <a className={`category-icon-${categorySlug(category.category)}`} href={categoryHref(category.category)} key={category.category}>
              <span className="atelier-category-quick-image"><OptimizedImage src={asset(category.collectionVisual.image)} alt="" style={{ objectPosition: category.collectionVisual.position }} /></span><strong>{category.label}</strong><small>{category.count} items</small>
            </a>)}
          </nav>
        </section>}

        {catalog.audienceCards.length > 0 && <section className="atelier-category-wide atelier-category-audience-section" aria-labelledby="category-audience-title">
          <div className="atelier-category-audience-heading"><p id="category-audience-title">Shop by audience</p><span>Fashion from the live catalog</span></div>
          <div className="atelier-category-audience-rail" role="tablist" aria-label="Shop fashion by audience">
            <button className={activeAudience === 'all' ? 'active' : ''} type="button" role="tab" aria-selected={activeAudience === 'all'} onClick={() => setActiveAudience('all')}>
              <span className="atelier-category-audience-all" aria-hidden="true">All</span><strong>All fashion</strong><small>{catalog.fashionProductCount} items</small>
            </button>
            {catalog.audienceCards.map((audience) => (
              <button className={activeAudience === audience.value ? 'active' : ''} type="button" role="tab" aria-selected={activeAudience === audience.value} key={audience.value} onClick={() => setActiveAudience(audience.value)}>
                <span className="atelier-category-audience-image"><OptimizedImage src={audience.image ? asset(audience.image) : audience.product.imageUrl} alt="" /></span><strong>{audience.label}</strong><small>{audience.count} items</small>
              </button>
            ))}
          </div>
        </section>}

        <section className="atelier-category-wide atelier-category-filter-section" aria-label="Catalog filters">
          <div className="atelier-category-filter-head">
            <div><p>Filters</p><span>{catalog.filteredProductCount} styles showing</span></div>
            <button type="button" onClick={resetCategoryFilters} disabled={!filtersActive}>Reset</button>
          </div>
          <div className="atelier-category-filter-controls">
            <label>
              <span>Category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">All categories</option>
                {catalog.filterCategories.map((category) => <option value={category.value} key={category.value}>{category.label} ({category.count})</option>)}
              </select>
            </label>
            <label>
              <span>Brand</span>
              <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
                <option value="all">All brands</option>
                {catalog.filterBrands.map((brand) => <option value={brand.value} key={brand.value}>{brand.label} ({brand.count})</option>)}
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select value={sortFilter} onChange={(event) => setSortFilter(event.target.value)}>
                <option value="newest">Newest first</option>
                <option value="price-low">Price low to high</option>
                <option value="price-high">Price high to low</option>
                <option value="name">Name A-Z</option>
              </select>
            </label>
          </div>
        </section>

        {state.error && <div className="atelier-category-wide"><StatusPanel text={state.error} onRetry={state.retry} /></div>}
        {!state.loading && !state.error && catalog.categorySections.length === 0 && <div className="atelier-category-wide atelier-category-empty"><h2>No fashion products available</h2><p>{filtersActive ? 'No products match the selected filters. Reset filters to view the full edit.' : 'There are no wearable fashion products in this audience yet.'}</p></div>}

        {catalog.categorySections.map((category) => (
          <section className="atelier-category-wide atelier-category-products-section" aria-labelledby={`category-section-${categorySlug(category.category)}`} key={`section-${category.category}`}>
            <div className="atelier-category-products-head">
              <div><p>{category.count} Products</p><h2 id={`category-section-${categorySlug(category.category)}`}>{category.label}</h2></div>
              <a href={categoryHref(category.category)}>View All</a>
            </div>
            <div className="atelier-category-product-grid">
              {category.products.map((product) => <article className="atelier-category-product" key={product.id}>
                <a href={`/product/${encodeURIComponent(product.id)}`}><div className="atelier-category-product-image"><OptimizedImage src={product.imageUrl} alt={product.name} /></div><span className="atelier-category-product-brand">{displayBrand(product)}</span><h3>{product.name}</h3><strong>{formatMoney(product.price || 0, product.currency)}</strong></a>
                <WishlistHeartButton product={product} className="card-wishlist-heart" />
              </article>)}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

function CategoriesPage() {
  return <AtelierCategoriesPage />;
}

function departmentTitle(category) {
  return categorySlug(category) === 'eyewear' ? 'Sunglasses & Eyewear' : categoryLabel(category);
}

const departmentPriceFilters = [
  { value: 'all', label: 'All prices', test: () => true },
  { value: 'under-500', label: 'Under 500', test: (price) => price > 0 && price < 500 },
  { value: '500-1000', label: '500 to 1,000', test: (price) => price >= 500 && price < 1000 },
  { value: '1000-2500', label: '1,000 to 2,500', test: (price) => price >= 1000 && price < 2500 },
  { value: '2500-plus', label: '2,500+', test: (price) => price >= 2500 }
];

function CategoryDepartmentPage({ category, user }) {
  const initialGender = new URLSearchParams(window.location.search).get('gender') || '';
  const [gender, setGender] = useState(initialGender);
  const [brandFilter, setBrandFilter] = useState('all');
  const [priceFilter, setPriceFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const state = useProducts({ category, gender, sort, limit: 96 });
  const heroProduct = state.products.find((product) => product?.imageUrl) || null;
  const title = departmentTitle(category);
  const categoryPath = categoryPageHref(category, gender);
  const departmentProducts = state.products || [];
  const departmentBrands = useMemo(() => {
    const brandCounts = departmentProducts.reduce((map, product) => {
      const brand = displayBrand(product);
      if (!brand || brand === 'Marketplace brand') return map;
      const key = brand.toLowerCase();
      const existing = map.get(key) || { value: brand, label: brand, count: 0 };
      existing.count += 1;
      map.set(key, existing);
      return map;
    }, new Map());

    return [...brandCounts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [departmentProducts]);
  const departmentPriceOptions = useMemo(() => departmentPriceFilters.map((option) => ({
    ...option,
    count: option.value === 'all'
      ? departmentProducts.length
      : departmentProducts.filter((product) => option.test(Number(product.price || 0))).length
  })), [departmentProducts]);
  const visibleProducts = useMemo(() => {
    const priceOption = departmentPriceFilters.find((option) => option.value === priceFilter) || departmentPriceFilters[0];
    return departmentProducts
      .filter((product) => brandFilter === 'all' || displayBrand(product) === brandFilter)
      .filter((product) => priceOption.test(Number(product.price || 0)));
  }, [brandFilter, departmentProducts, priceFilter]);
  const filtersActive = Boolean(gender) || brandFilter !== 'all' || priceFilter !== 'all' || sort !== 'newest';

  useEffect(() => {
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (currentPath !== categoryPath) window.history.replaceState({}, '', categoryPath);
  }, [categoryPath]);

  useEffect(() => {
    setBrandFilter('all');
    setPriceFilter('all');
  }, [category, gender]);

  useEffect(() => {
    if (brandFilter !== 'all' && !departmentBrands.some((brand) => brand.value === brandFilter)) setBrandFilter('all');
  }, [brandFilter, departmentBrands]);

  const resetDepartmentFilters = () => {
    setGender('');
    setBrandFilter('all');
    setPriceFilter('all');
    setSort('newest');
    window.history.replaceState({}, '', categoryPageHref(category));
  };

  return (
    <main className="department-page">
      <section className="department-hero">
        <div className="wrap department-hero-inner">
          <div className="department-hero-copy">
            <a className="department-back-link" href="/categories">All Departments</a>
            <p>FitLook Category</p>
            <h1>{title}</h1>
            <span>{state.loading ? 'Loading products' : `${state.total} products selected for this department`}</span>
          </div>
          {heroProduct && <a className="department-hero-image" href={`/product/${encodeURIComponent(heroProduct.id)}`}><OptimizedImage src={heroProduct.imageUrl} alt={heroProduct.name} eager /></a>}
        </div>
      </section>

      <section className="department-catalog wrap" aria-label={`${title} catalog`}>
        <div className="department-controls">
          <div className="department-gender-filter" role="tablist" aria-label="Filter by gender">
            {[['All', ''], ['Women', 'women'], ['Men', 'men'], ['Unisex', 'unisex']].map(([label, value]) => <button className={gender === value ? 'active' : ''} type="button" role="tab" aria-selected={gender === value} onClick={() => setGender(value)} key={label}>{label}</button>)}
          </div>
          <div className="department-filter-selects">
            <label className="department-sort"><span>Brand</span><select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)} aria-label="Filter products by brand" disabled={!departmentBrands.length}><option value="all">All brands</option>{departmentBrands.map((brand) => <option value={brand.value} key={brand.value}>{brand.label} ({brand.count})</option>)}</select></label>
            <label className="department-sort"><span>Price</span><select value={priceFilter} onChange={(event) => setPriceFilter(event.target.value)} aria-label="Filter products by price">{departmentPriceOptions.map((option) => <option value={option.value} key={option.value}>{option.label}{option.value !== 'all' ? ` (${option.count})` : ''}</option>)}</select></label>
            <label className="department-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort products"><option value="newest">Newest</option><option value="price_asc">Price: Low to High</option><option value="price_desc">Price: High to Low</option><option value="rating">Top Rated</option></select></label>
          </div>
        </div>

        <div className="department-results-head"><div><p>{state.loading ? 'Loading' : `${visibleProducts.length} Products`}</p><h2>{title}</h2></div><button className="department-reset-link" type="button" disabled={!filtersActive} onClick={resetDepartmentFilters}>Reset department</button></div>
        {state.loading && <ProductGridSkeleton count={8} />}
        {state.error && <StatusPanel text={state.error} onRetry={state.retry} />}
        {!state.loading && !state.error && visibleProducts.length === 0 && <EmptyProducts search={title} />}
        {!state.loading && !state.error && visibleProducts.length > 0 && <div className="product-grid department-product-grid">{visibleProducts.map((product) => <ProductCard key={product.id} product={product} user={user} />)}</div>}
      </section>
    </main>
  );
}

function ProductCard({ product, user, locked = false, tryOn, canTryOn = false, tryOnLoading = false, tryOnVideoLoading = false, tryOnError = '', tryOnVideoError = '', onTryOn, onTryOnVideo }) {
  const [tryOnImageFailed, setTryOnImageFailed] = useState(false);
  const [isWishlisted, setIsWishlisted] = useState(() => readWishlistProductIds().includes(String(product.id)));
  const hasDiscount = product.compareAtPrice && product.compareAtPrice > product.price;
  const discount = hasDiscount ? `${Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)}% OFF` : '';
  const productImage = product.imageUrl || asset('hero2.png');
  const hasUsableTryOn = Boolean(tryOn?.imageUrl) && !tryOnImageFailed;
  const hasTryOnVideo = Boolean(tryOn?.videoUrl) && hasUsableTryOn;
  const image = hasUsableTryOn ? tryOn.imageUrl : productImage;
  const detailHref = `/product/${encodeURIComponent(product.id)}`;
  const brand = displayBrand(product);

  useEffect(() => {
    setTryOnImageFailed(false);
  }, [tryOn?.imageUrl]);

  useEffect(() => {
    const productId = String(product.id);
    const sync = (event) => {
      const ids = event.detail?.ids;
      if (Array.isArray(ids)) setIsWishlisted(ids.map(String).includes(productId));
      else if (String(event.detail?.id || '') === productId) setIsWishlisted(Boolean(event.detail?.saved));
    };
    const syncFromStorage = () => setIsWishlisted(readWishlistProductIds().includes(productId));
    syncFromStorage();
    window.addEventListener('fitlook:wishlist-change', sync);
    window.addEventListener('storage', syncFromStorage);
    return () => {
      window.removeEventListener('fitlook:wishlist-change', sync);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, [product.id]);

  const toggleWishlist = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const saved = toggleWishlistProductId(product);
    setIsWishlisted(saved);
    announce(saved ? `${product.name} saved to your wishlist.` : `${product.name} removed from your wishlist.`);
  };

  const content = (
    <>
      <div className="product-media">
        {hasTryOnVideo ? (
          <video src={tryOn.videoUrl} poster={tryOn.imageUrl} autoPlay muted loop playsInline />
        ) : (
          <OptimizedImage
            src={image}
            alt={product.name}
            onError={(event) => {
              if (hasUsableTryOn) setTryOnImageFailed(true);
              else if (event.currentTarget.src !== window.location.origin + asset('hero2.png')) event.currentTarget.src = asset('hero2.png');
            }}
          />
        )}
        {product.badge && <span className="badge">{product.badge}</span>}
        {hasUsableTryOn && <span className="badge tryon-badge">{hasTryOnVideo ? 'Video Try-On' : 'AI Try-On'}</span>}
        {(tryOnLoading || tryOnVideoLoading) && <TryOnGenerating text={tryOnVideoLoading ? 'Generating video' : 'Generating try-on'} />}
      </div>
      <div className="product-info">
        <h3 className="product-title">{product.name}</h3>
        <p className="product-brand">{brand}</p>
        <p className="product-category-chip">{displayCategory(product)}</p>
        <p className="rating"><span>★</span> {Number(product.rating || 0).toFixed(1)} {product.ratingCount ? `(${product.ratingCount})` : ''}</p>
        <div className="price-row">
          <span className="price">{formatMoney(product.price || 0, product.currency)}</span>
          {hasDiscount && <span className="was">{formatMoney(product.compareAtPrice, product.currency)}</span>}
          {discount && <span className="off">{discount}</span>}
        </div>
      </div>
    </>
  );

  return (
    <article className={`product-card ${locked ? 'locked-product' : ''}`}>
      {locked ? <div>{content}</div> : <><a className="product-card-link" href={detailHref} onClick={() => recordEvent('product_click', { productId: product.id })}>{content}</a><button className={`heart ${isWishlisted ? 'saved' : ''}`} type="button" aria-label={isWishlisted ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`} aria-pressed={isWishlisted} title={isWishlisted ? 'Remove from wishlist' : 'Save to wishlist'} onClick={toggleWishlist}><HeartIcon /></button></>}
      {!locked && (
        <div className="product-card-actions">
          {canTryOn && onTryOn ? (
            <button type="button" onClick={() => onTryOn(product, { force: Boolean(tryOn?.imageUrl) })} disabled={tryOnLoading}>
              {tryOnLoading ? 'Generating...' : hasUsableTryOn ? 'Generate Again' : tryOnImageFailed ? 'Try Again' : 'Try On'}
            </button>
          ) : (
            <a href={user ? detailHref : '/signup'}>{hasUsableTryOn ? 'Generate Again' : 'Try On'}</a>
          )}
          {hasUsableTryOn && onTryOnVideo && (
            <button className="video-action" type="button" onClick={() => onTryOnVideo(product, { force: Boolean(tryOn?.videoUrl) })} disabled={tryOnVideoLoading || tryOnLoading}>
              {tryOnVideoLoading ? 'Video...' : tryOn?.videoUrl ? 'New Video' : 'Video Try-On'}
            </button>
          )}
          {product.affiliateLink && <a className="shop-action" href={product.affiliateLink} target="_blank" rel="noreferrer" onClick={() => recordEvent('shop_click', { productId: product.id })}>Shop</a>}
          {tryOnError && <p>{tryOnError}</p>}
          {tryOnVideoError && <p>{tryOnVideoError}</p>}
        </div>
      )}
    </article>
  );
}

const closetCategories = [
  ['All', 'all'],
  ['Tops', 'tops'],
  ['Bottoms', 'bottoms'],
  ['Dresses', 'dresses'],
  ['Suits', 'suits'],
  ['Outerwear', 'outerwear'],
  ['Shoes', 'shoes'],
  ['Accessories', 'accessories'],
  ['Activewear', 'activewear'],
  ['Ethnic', 'ethnic'],
  ['Other', 'other']
];

const closetOccasions = ['today casual', 'office meeting', 'date night', 'party', 'wedding function', 'college day', 'travel', 'rainy weather'];
const closetComboSlots = [
  { key: 'topwear', label: 'Topwear', helper: 'Choose shirt/top', categories: ['tops', 'ethnic'] },
  { key: 'bottomwear', label: 'Bottomwear', helper: 'Choose pant/bottom', categories: ['bottoms'] },
  { key: 'outerwear', label: 'Layer', helper: 'Jacket or suit', categories: ['outerwear', 'suits'] },
  { key: 'footwear', label: 'Footwear', helper: 'Choose shoes', categories: ['shoes'] },
  { key: 'accessory', label: 'Accessory', helper: 'Cap, goggles, watch', categories: ['accessories'] }
];

function placementStorageKey(modelSrc = '') {
  return `fitlook:model-placement:${String(modelSrc || '').slice(0, 180)}`;
}

function readSavedPlacement(modelSrc) {
  if (typeof window === 'undefined' || !modelSrc) return DEFAULT_MODEL_PLACEMENT;
  try {
    return normalizedPlacement(JSON.parse(localStorage.getItem(placementStorageKey(modelSrc)) || 'null') || DEFAULT_MODEL_PLACEMENT);
  } catch {
    return DEFAULT_MODEL_PLACEMENT;
  }
}

function savePlacement(modelSrc, placement) {
  if (typeof window === 'undefined' || !modelSrc) return;
  localStorage.setItem(placementStorageKey(modelSrc), JSON.stringify(normalizedPlacement(placement)));
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    let frame = 0;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        return current.width === width && current.height === height ? current : { width, height };
      });
    };
    update();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(element);
    window.addEventListener('orientationchange', update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('orientationchange', update);
    };
  }, [ref]);

  return size;
}

function useImageNaturalSize(src) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!src) {
      setSize({ width: 0, height: 0 });
      return undefined;
    }
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setSize({ width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 });
    };
    image.onerror = () => {
      if (active) setSize({ width: 0, height: 0 });
    };
    image.src = src;
    return () => {
      active = false;
    };
  }, [src]);

  return size;
}

function inspectPreviewImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('Transparent image URL is missing'));
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      if (!width || !height) {
        reject(new Error('Transparent image loaded without dimensions'));
        return;
      }
      let alphaDetected = null;
      try {
        const canvas = document.createElement('canvas');
        const sampleWidth = Math.min(220, width);
        const sampleHeight = Math.max(1, Math.round((height / width) * sampleWidth));
        canvas.width = sampleWidth;
        canvas.height = sampleHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
        alphaDetected = false;
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] < 255) {
            alphaDetected = true;
            break;
          }
        }
      } catch {
        alphaDetected = null;
      }
      resolve({ width, height, alphaDetected });
    };
    image.onerror = () => reject(new Error('Transparent image could not be loaded by the browser'));
    image.src = src;
  });
}

function useSubjectIsolation(modelSource, user) {
  const sourceUrl = modelSource?.imageUrl || '';
  const providedTransparent = modelSource?.transparentImageUrl || '';
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState({
    status: providedTransparent ? 'completed' : sourceUrl ? 'idle' : 'idle',
    transparentUrl: providedTransparent,
    error: '',
    errorCode: '',
    processing: modelSource?.imageProcessing || null,
    outputLoaded: false,
    alphaDetected: null,
    cacheHit: Boolean(modelSource?.imageProcessing?.cached)
  });

  useEffect(() => {
    if (!sourceUrl) {
      setState({ status: 'idle', transparentUrl: '', error: '', errorCode: '', processing: null, outputLoaded: false, alphaDetected: null, cacheHit: false });
      return undefined;
    }
    let active = true;
    const completeWithPreview = async (transparentUrl, processing = null) => {
      try {
        const loaded = await inspectPreviewImage(transparentUrl);
        if (!active) return;
        setState({
          status: loaded.alphaDetected === false ? 'failed' : 'completed',
          transparentUrl: loaded.alphaDetected === false ? '' : transparentUrl,
          error: loaded.alphaDetected === false ? 'Transparent image loaded, but no alpha pixels were detected.' : '',
          errorCode: loaded.alphaDetected === false ? 'NO_ALPHA_DETECTED' : '',
          processing,
          outputLoaded: true,
          alphaDetected: loaded.alphaDetected,
          cacheHit: Boolean(processing?.cached)
        });
      } catch (error) {
        if (!active) return;
        setState({
          status: 'failed',
          transparentUrl: '',
          error: error.message,
          errorCode: 'TRANSPARENT_IMAGE_LOAD_FAILED',
          processing,
          outputLoaded: false,
          alphaDetected: false,
          cacheHit: Boolean(processing?.cached)
        });
      }
    };

    if (providedTransparent) {
      setState((current) => ({ ...current, status: 'requesting', transparentUrl: '', error: '', errorCode: '', processing: modelSource?.imageProcessing || null }));
      completeWithPreview(providedTransparent, modelSource?.imageProcessing || null);
      return () => {
        active = false;
      };
    }
    if (!user || !sourceUrl.startsWith('/uploads/')) {
      setState({ status: 'failed', transparentUrl: '', error: 'No saved source image is available for cutout processing.', errorCode: 'SOURCE_UNAVAILABLE', processing: modelSource?.imageProcessing || null, outputLoaded: false, alphaDetected: null, cacheHit: false });
      return () => {
        active = false;
      };
    }

    const controller = new AbortController();
    setState((current) => ({ ...current, status: 'requesting', transparentUrl: current.transparentUrl || '', error: '', errorCode: '' }));
    api('/images/subject-isolation', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: sourceUrl }),
      timeout: 120000,
      signal: controller.signal
    })
      .then((data) => {
        if (!active) return;
        const status = data.status || data.processing?.processingStatus || 'failed';
        const transparentUrl = data.transparentImageUrl || data.processing?.transparentImageUrl || '';
        if (status === 'completed' && transparentUrl) {
          completeWithPreview(transparentUrl, data.processing || null);
          return;
        }
        setState({
          status: status === 'processing' || status === 'queued' ? 'processing' : 'failed',
          transparentUrl: '',
          error: data.message || data.processing?.processingError || 'Could not prepare transparent preview.',
          errorCode: data.errorCode || 'BACKGROUND_REMOVAL_FAILED',
          processing: data.processing || null,
          outputLoaded: false,
          alphaDetected: null,
          cacheHit: Boolean(data.processing?.cached)
        });
      })
      .catch((error) => {
        if (active && error.name !== 'AbortError') {
          setState({ status: 'failed', transparentUrl: '', error: error.message, errorCode: 'BACKGROUND_REMOVAL_REQUEST_FAILED', processing: null, outputLoaded: false, alphaDetected: null, cacheHit: false });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [sourceUrl, providedTransparent, user?.id, retryKey]);

  return { ...state, retry: () => setRetryKey((current) => current + 1), sourceUrl };
}

function FloorContactShadow({ placement }) {
  if (!placement.modelWidth || !placement.modelHeight) return null;
  return (
    <span
      className="floor-contact-shadow"
      aria-hidden="true"
      style={{
        left: `${placement.leftPercent}%`,
        bottom: `${placement.bottom}px`,
        width: `${placement.shadowWidth}px`,
        height: `${placement.shadowHeight}px`
      }}
    />
  );
}

function ModelAdjustmentControls({ placement, onChange, onReset, onSave }) {
  const current = normalizedPlacement(placement);
  const setScale = (event) => onChange({ ...current, scale: Number(event.target.value) });
  const move = (dx, dy) => onChange({ ...current, x: current.x + dx, floorY: current.floorY + dy });
  return (
    <div className="model-adjustment-controls" role="group" aria-label="Adjust model placement">
      <div className="model-adjustment-nudge" aria-label="Move model">
        <button type="button" onClick={() => move(0, -0.012)} aria-label="Move model up">↑</button>
        <button type="button" onClick={() => move(-0.012, 0)} aria-label="Move model left">←</button>
        <button type="button" onClick={() => move(0.012, 0)} aria-label="Move model right">→</button>
        <button type="button" onClick={() => move(0, 0.012)} aria-label="Move model down">↓</button>
      </div>
      <label>
        <span>Scale</span>
        <input type="range" min="0.72" max="1.25" step="0.01" value={current.scale} onChange={setScale} aria-label="Model scale" />
      </label>
      <button type="button" onClick={onReset}>Reset</button>
      <button type="button" onClick={onSave}>Save</button>
    </div>
  );
}

function TransparentModel({ src, fallback, alt, placement, adjusting, onOpen, onPlacementChange }) {
  const dragRef = useRef(null);
  const activeSrc = src || fallback;
  const isFallback = !src && Boolean(fallback);
  if (!activeSrc) return null;

  const pointerDown = (event) => {
    if (!adjusting) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      placement
    };
  };
  const pointerMove = (event) => {
    const drag = dragRef.current;
    if (!adjusting || !drag || drag.id !== event.pointerId) return;
    const stage = event.currentTarget.closest('.wardrobe-model-frame');
    const rect = stage?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    onPlacementChange({
      ...drag.placement,
      x: drag.placement.x + (event.clientX - drag.startX) / rect.width,
      floorY: drag.placement.floorY + (event.clientY - drag.startY) / rect.height
    });
  };
  const pointerUp = (event) => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null;
  };

  return (
    <button
      className={`transparent-model ${isFallback ? 'fallback-model' : ''} ${adjusting ? 'is-adjusting' : ''}`}
      type="button"
      onClick={adjusting ? undefined : onOpen}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      aria-label={adjusting ? 'Drag model to adjust placement' : 'Open model preview full screen'}
      style={{
        left: `${placement.leftPercent}%`,
        bottom: `${placement.bottom}px`,
        height: `${placement.modelHeight}px`
      }}
    >
      <OptimizedImage src={activeSrc} alt={alt} />
    </button>
  );
}

function CutoutFallbackNotice({ isolation, originalSrc, onRetry }) {
  return (
    <div className="cutout-fallback-notice" role="status" aria-live="polite">
      <div>
        <strong>Room cutout needs retry</strong>
        <span>{isolation.error || 'The transparent model preview could not be prepared.'}</span>
      </div>
      {originalSrc && <img src={originalSrc} alt="" />}
      <button type="button" onClick={onRetry}>Retry cutout</button>
    </div>
  );
}

function RoomScene({ modelSource, alt, generating, user, onOpen, onEmpty }) {
  const frameRef = useRef(null);
  const stageSize = useElementSize(frameRef);
  const isolation = useSubjectIsolation(modelSource, user);
  const modelSrc = isolation.transparentUrl || '';
  const fallbackSrc = modelSource?.imageUrl || '';
  const visibleSrc = modelSrc;
  const naturalSize = useImageNaturalSize(visibleSrc);
  const [adjusting, setAdjusting] = useState(false);
  const [placement, setPlacement] = useState(() => readSavedPlacement(visibleSrc));

  useEffect(() => {
    setPlacement(readSavedPlacement(visibleSrc));
  }, [visibleSrc]);

  const safePlacement = normalizedPlacement(placement);
  const calculated = calculateModelPlacement({
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
    imageWidth: naturalSize.width,
    imageHeight: naturalSize.height,
    placement: safePlacement,
    controlsInset: adjusting ? 42 : 0
  });
  const statusText = isolation.status === 'requesting' || isolation.status === 'processing'
      ? 'Preparing your room preview...'
      : isolation.status === 'failed' && fallbackSrc
        ? 'Transparent preview unavailable.'
        : '';

  const updatePlacement = (next) => setPlacement(normalizedPlacement(next));
  const resetPlacement = () => setPlacement(DEFAULT_MODEL_PLACEMENT);
  const saveCurrentPlacement = () => {
    savePlacement(visibleSrc, placement);
    announce('Model placement saved.');
  };

  return (
    <div className={`room-scene ${adjusting ? 'adjusting' : ''}`} ref={frameRef}>
      {visibleSrc ? (
        <>
          <FloorContactShadow placement={calculated} />
          <TransparentModel
            src={modelSrc}
            fallback={fallbackSrc}
            alt={alt}
            placement={calculated}
            adjusting={adjusting}
            onOpen={onOpen}
            onPlacementChange={updatePlacement}
          />
          <button className="model-adjust-toggle" type="button" onClick={() => setAdjusting((current) => !current)} aria-pressed={adjusting}>
            Adjust Model
          </button>
          {adjusting && <ModelAdjustmentControls placement={safePlacement} onChange={updatePlacement} onReset={resetPlacement} onSave={saveCurrentPlacement} />}
        </>
      ) : isolation.status === 'failed' && fallbackSrc ? (
        <CutoutFallbackNotice isolation={isolation} originalSrc={fallbackSrc} onRetry={isolation.retry} />
      ) : fallbackSrc ? (
        <div className="cutout-preparing" aria-hidden="true" />
      ) : (
        <button className="wardrobe-model-empty" type="button" onClick={onEmpty}>
          <UserIcon />
          <strong>Upload model photo</strong>
          <span>Use your profile image for wardrobe try-ons.</span>
        </button>
      )}
      {statusText && <p className={`room-scene-status ${isolation.status === 'failed' ? 'warning' : ''}`} aria-live="polite">{statusText}</p>}
    </div>
  );
}

function ClosetPage({ user, setUser }) {
  const [state, setState] = useState({ items: [], outfits: [], stats: {}, suggestions: [], loading: true, error: '' });
  const [selectedIds, setSelectedIds] = useState([]);
  const [comboSlots, setComboSlots] = useState({});
  const [activeWardrobeKey, setActiveWardrobeKey] = useState('topwear');
  const [filter, setFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [occasion, setOccasion] = useState('today casual');
  const [weather, setWeather] = useState('');
  const [mood, setMood] = useState('');
  const [plannedFor, setPlannedFor] = useState(dateInputValue());
  const [backdrop, setBackdrop] = useState('bright modern apartment');
  const [pose, setPose] = useState('front facing');
  const [lighting, setLighting] = useState('natural light');
  const [autoApply, setAutoApply] = useState(true);
  const [stagePreviewMode, setStagePreviewMode] = useState(() => (
    new URLSearchParams(window.location.search).get('preview') === 'latest' ? 'outfit' : 'model'
  ));
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chat, setChat] = useState([
    { role: 'assistant', text: 'Ask what to wear today, for an occasion, or which pants fit a shirt from your closet.' }
  ]);
  const [fullscreenImage, setFullscreenImage] = useState(null);

  const loadCloset = () => {
    if (!user) return;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api('/closet')
      .then((data) => {
        setState({ items: data.items || [], outfits: data.outfits || [], stats: data.stats || {}, suggestions: data.suggestions || [], loading: false, error: '' });
      })
      .catch((err) => setState({ items: [], outfits: [], stats: {}, suggestions: [], loading: false, error: err.message }));
  };

  useEffect(() => {
    loadCloset();
  }, [user?.id]);

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const selectedItems = selectedIds.map((id) => state.items.find((item) => item.id === id)).filter(Boolean);
  const filteredItems = state.items.filter((item) => filter === 'all' || item.category === filter);
  const plannerDays = nextPlannerDays(7);
  const plannedByDay = new Map((state.outfits || []).filter((outfit) => outfit.plannedFor).map((outfit) => [dateInputValue(outfit.plannedFor), outfit]));
  const latestOutfit = state.outfits?.[0] || null;
  const mainPreview = latestOutfit?.imageUrl || user.bodyPhotoUrl || asset('hero2.png');
  const wardrobeSlots = [
    { key: 'topwear', label: 'Topwear', helper: 'Shirts, tops, kurtas', short: 'To', categories: ['tops', 'outerwear', 'ethnic'] },
    { key: 'bottomwear', label: 'Bottomwear', helper: 'Pants, denim, skirts', short: 'Bo', categories: ['bottoms'] },
    { key: 'goggles', label: 'Goggles', helper: 'Glasses and shades', short: 'Go', categories: ['accessories'], keywords: ['goggle', 'goggles', 'glass', 'glasses', 'sunglass', 'eyewear'] },
    { key: 'cap', label: 'Cap', helper: 'Caps and hats', short: 'Ca', categories: ['accessories'], keywords: ['cap', 'hat'] },
    { key: 'footwear', label: 'Footwear', helper: 'Shoes, boots, sandals', short: 'Fo', categories: ['shoes'] }
  ];
  const wardrobeSlotMatches = (slot, item, strict = false) => {
    if (!slot.categories.includes(item.category)) return false;
    if (!slot.keywords?.length) return true;
    const text = [item.name, item.category, item.color, item.formality, ...(item.tags || []), ...(item.occasions || [])].filter(Boolean).join(' ').toLowerCase();
    const keywordMatch = slot.keywords.some((keyword) => text.includes(keyword));
    return strict ? keywordMatch : keywordMatch || slot.categories.includes(item.category);
  };
  const wardrobeOptionsForSlot = (slot) => {
    const exactOptions = state.items.filter((item) => wardrobeSlotMatches(slot, item, true));
    return exactOptions.length ? exactOptions : state.items.filter((item) => wardrobeSlotMatches(slot, item));
  };
  const wardrobeRail = wardrobeSlots.map((slot) => {
    const options = wardrobeOptionsForSlot(slot);
    const selected = state.items.find((item) => item.id === comboSlots[slot.key]) || null;
    return {
      ...slot,
      item: selected || options[0] || null,
      selected,
      options
    };
  });
  const activeWardrobeSlot = wardrobeRail.find((slot) => slot.key === activeWardrobeKey) || wardrobeRail[0];
  const lookbookCards = state.outfits.length
    ? state.outfits.slice(0, 5).map((outfit) => ({ id: outfit.id, title: outfit.title, imageUrl: outfit.imageUrl, items: outfit.items || [] }))
    : state.suggestions.slice(0, 5).map((suggestion, index) => ({ id: suggestion.key || `${suggestion.title}-${index}`, title: suggestion.title, items: suggestion.items || [] }));
  const comboOptions = state.suggestions.slice(0, 6);
  const selectedKey = selectedIds.slice().sort().join(':');
  const comboPreviewItems = (selectedItems.length ? selectedItems : state.items.filter((item) => ['tops', 'bottoms', 'suits', 'outerwear', 'shoes'].includes(item.category))).slice(0, 4);
  const wardrobeSections = [
    { label: 'Tops', icon: <TryOnIcon />, categories: ['tops', 'ethnic', 'activewear'] },
    { label: 'Bottoms', icon: <ClosetIcon />, categories: ['bottoms'] },
    { label: 'Outerwear', icon: <BagIcon />, categories: ['outerwear', 'suits'] },
    { label: 'Shoes', icon: <TagIcon />, categories: ['shoes'] }
  ].map((section) => ({
    ...section,
    items: state.items.filter((item) => section.categories.includes(item.category))
  }));
  const closetSelectionCards = [
    {
      href: '/closet/add',
      step: '01',
      title: 'Add Clothes',
      copy: 'Upload wardrobe photos and save category, color, fabric, season and occasion tags.',
      meta: `${state.stats.total || state.items.length} saved`,
      action: 'Open Add Page',
      tone: 'add',
      items: state.items.slice(0, 3)
    },
    {
      href: '/closet/combo',
      step: '02',
      title: 'Build Combo',
      copy: 'Select which pant fits which shirt, add shoes or accessories, then generate it on you.',
      meta: selectedItems.length ? `${selectedItems.length} selected` : 'Shirt + pant picker',
      action: 'Choose Items',
      tone: 'combo',
      items: comboPreviewItems
    },
    {
      href: '/closet/items',
      step: '03',
      title: 'Your Closet',
      copy: 'Browse all saved clothes with category filters and send selected pieces to the combo page.',
      meta: `${closetCategories.length - 1} filters`,
      action: 'View Wardrobe',
      tone: 'items',
      items: state.items.slice(0, 4)
    }
  ];

  const slotItems = closetComboSlots.map((slot) => ({
    ...slot,
    selected: state.items.find((item) => item.id === comboSlots[slot.key]) || null,
    options: state.items.filter((item) => slot.categories.includes(item.category))
  }));

  const selectedIdsFromSlots = (slots) => [...new Set(Object.values(slots).filter(Boolean))];

  const slotsFromItems = (items) => {
    const next = {};
    closetComboSlots.forEach((slot) => {
      const item = items.find((entry) => slot.categories.includes(entry.category));
      if (item) next[slot.key] = item.id;
    });
    return next;
  };

  const updateItem = async (item, updates) => {
    const data = await api(`/closet/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    setState((current) => ({ ...current, items: current.items.map((entry) => (entry.id === item.id ? data.item : entry)) }));
  };

  const deleteItem = async (item) => {
    await api(`/closet/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    setSelectedIds((current) => current.filter((id) => id !== item.id));
    setState((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }));
  };

  const toggleSelected = (item) => {
    setSelectedIds((current) => {
      if (current.includes(item.id)) return current.filter((id) => id !== item.id);
      return [...current, item.id].slice(-5);
    });
  };

  const chooseSlotItem = (slotKey, item) => {
    setComboSlots((current) => {
      const next = { ...current };
      if (!item) delete next[slotKey];
      else next[slotKey] = item.id;
      setSelectedIds(selectedIdsFromSlots(next));
      return next;
    });
  };

  const applyComboItems = (items = []) => {
    const nextSlots = slotsFromItems(items);
    setComboSlots(nextSlots);
    setSelectedIds(items.map((item) => item.id).filter(Boolean));
  };

  const swapSelected = (item) => {
    const replacement = state.items
      .filter((candidate) => candidate.id !== item.id && candidate.category === item.category && !selectedIds.includes(candidate.id))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    if (!replacement) {
      setMessage(`No other ${item.category} item is available to swap.`);
      return;
    }
    setSelectedIds((current) => current.map((id) => (id === item.id ? replacement.id : id)));
    setComboSlots((current) => {
      const matchedSlot = closetComboSlots.find((slot) => slot.categories.includes(item.category));
      if (!matchedSlot || current[matchedSlot.key] !== item.id) return current;
      return { ...current, [matchedSlot.key]: replacement.id };
    });
    setMessage(`Swapped ${item.name} with ${replacement.name}.`);
  };

  const scheduleOutfit = async (outfit, date) => {
    try {
      const data = await api(`/closet/outfits/${encodeURIComponent(outfit.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ plannedFor: date })
      });
      setState((current) => ({ ...current, outfits: current.outfits.map((entry) => (entry.id === outfit.id ? data.outfit : entry)) }));
      setMessage(`Planned ${outfit.title} for ${formatDate(date)}.`);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const askForSuggestions = async (nextOccasion = occasion) => {
    setOccasion(nextOccasion);
    setMessage('Finding the best combos from your closet...');
    try {
      const data = await api('/closet/suggest', {
        method: 'POST',
        body: JSON.stringify({ occasion: nextOccasion, weather, mood })
      });
      setState((current) => ({ ...current, suggestions: data.suggestions || [] }));
      setMessage('Suggestions ready.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const generateOutfit = async (ids = selectedIds, details = {}) => {
    if (!ids.length) {
      setMessage('Select closet items or choose a suggested combo first.');
      return;
    }
    setGenerating(true);
    setMessage('');
    try {
      const data = await api('/closet/outfits/generate', {
        method: 'POST',
        body: JSON.stringify({
          itemIds: ids,
          occasion: details.occasion || occasion,
          weather,
          mood,
          plannedFor,
          backdrop: details.backdrop || backdrop,
          pose,
          lighting,
          notes: [details.backdrop || backdrop, 'Keep the same wardrobe room scene; only the model and selected outfit should change.', pose, lighting].filter(Boolean).join(' · '),
          title: details.title || `Closet look for ${details.occasion || occasion || 'today'}`
        })
      });
      setState((current) => ({ ...current, outfits: [data.outfit, ...current.outfits] }));
      setSelectedIds(ids);
      if (data.user) setUser(data.user);
      setStagePreviewMode('outfit');
      setMessage('Closet look is ready.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const submitChat = async (event) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput('');
    setChat((current) => [...current, { role: 'user', text }]);
    setChatBusy(true);
    try {
      const data = await api('/closet/chat', { method: 'POST', body: JSON.stringify({ message: text }) });
      setChat((current) => [...current, { role: 'assistant', text: data.reply || 'I found a few closet options for you.' }]);
      if (data.suggestions) setState((current) => ({ ...current, suggestions: data.suggestions }));
    } catch (err) {
      setChat((current) => [...current, { role: 'assistant', text: err.message }]);
    } finally {
      setChatBusy(false);
    }
  };

  const openRoute = (href) => {
    window.history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const matchedComboSlot = (item) => closetComboSlots.find((slot) => slot.categories.includes(item.category));

  const handleWardrobeItemClick = (item) => {
    const matchedSlot = matchedComboSlot(item);
    if (!matchedSlot) {
      toggleSelected(item);
      return;
    }
    const shouldClear = comboSlots[matchedSlot.key] === item.id;
    chooseSlotItem(matchedSlot.key, shouldClear ? null : item);
    if (autoApply) setMessage(shouldClear ? `Removed ${item.name} from the look.` : `${item.name} added to the look.`);
  };

  const applyAccessorySlot = (slotKey, label) => {
    const slot = wardrobeRail.find((entry) => entry.key === slotKey);
    setActiveWardrobeKey(slotKey);
    if (!slot?.item) {
      setFilter('accessories');
      setMessage(`Add a ${label.toLowerCase()} to use it in your look.`);
      return;
    }
    chooseSlotItem('accessory', slot.item);
    setMessage(`${slot.item.name} added to the look.`);
  };

  const clearWardrobeSelection = () => {
    setComboSlots({});
    setSelectedIds([]);
    setMessage('Selection cleared.');
  };

  const undoWardrobeSelection = () => {
    if (latestOutfit?.items?.length) {
      applyComboItems(latestOutfit.items);
      setMessage('Restored the last generated look.');
      return;
    }
    clearWardrobeSelection();
  };

  const sortedClosetItems = [...state.items]
    .filter((item) => item?.id && item?.imageUrl)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const closetItemsForCategories = (categories, offset = 0) => {
    const options = sortedClosetItems.filter((item) => categories.includes(item.category));
    return options.length ? options[offset % options.length] : null;
  };
  const dressItems = sortedClosetItems.filter((item) => ['dresses', 'ethnic', 'suits'].includes(item.category));
  const generatedWardrobeCombos = [
    ...dressItems.slice(0, 6).map((dress, index) => ({
      id: `dress-look-${dress.id}-${index}`,
      title: `${categoryLabel(dress.category)} pairing`,
      items: [
        dress,
        closetItemsForCategories(['shoes'], index),
        closetItemsForCategories(['outerwear', 'suits'], index),
        closetItemsForCategories(['accessories'], index)
      ].filter((item, itemIndex, items) => item && items.findIndex((entry) => entry.id === item.id) === itemIndex)
    })),
    ...Array.from({ length: 6 }).map((_, index) => ({
      id: `wardrobe-look-${index}`,
      title: closetOccasions[index] || `Wardrobe look ${index + 1}`,
      items: [
        closetItemsForCategories(['tops', 'ethnic'], index),
        closetItemsForCategories(['bottoms'], index),
        closetItemsForCategories(['outerwear', 'suits'], index),
        closetItemsForCategories(['shoes'], index),
        closetItemsForCategories(['accessories'], index)
      ].filter((item, itemIndex, items) => item && items.findIndex((entry) => entry.id === item.id) === itemIndex)
    }))
  ].filter((card) => card.items.length > 0);
  const recommendationCombos = state.suggestions.length
    ? state.suggestions
      .slice(0, 6)
      .map((suggestion, index) => ({ id: suggestion.key || suggestion.title || `suggestion-${index}`, title: suggestion.title || closetOccasions[index] || 'Recommended look', items: (suggestion.items || []).filter((item) => item?.imageUrl) }))
      .filter((card) => card.items.length > 0)
    : generatedWardrobeCombos;
  const wardrobeRecommendationCards = recommendationCombos.slice(0, 10);
  const score = Math.min(98, 72 + selectedItems.length * 5 + recommendationCombos.length * 2);

  const tryRecommendedLook = (card) => {
    if (!card.items?.length) {
      askForSuggestions();
      return;
    }
    applyComboItems(card.items);
    generateOutfit(card.items.map((item) => item.id).filter(Boolean), { title: card.title, occasion: card.title });
  };

  const showingGeneratedOutfit = stagePreviewMode === 'outfit' && Boolean(latestOutfit?.imageUrl);
  const modelPreview = showingGeneratedOutfit ? latestOutfit.imageUrl : user.bodyPhotoUrl || latestOutfit?.imageUrl || '';
  const previewTitle = showingGeneratedOutfit ? latestOutfit?.title || 'Generated wardrobe look' : 'Model';
  const previewAlt = showingGeneratedOutfit ? latestOutfit?.title || 'Generated wardrobe look' : 'Current wardrobe model';
  const modelSource = {
    imageUrl: modelPreview,
    transparentImageUrl: showingGeneratedOutfit ? latestOutfit?.transparentImageUrl || '' : '',
    imageProcessing: showingGeneratedOutfit ? latestOutfit?.imageProcessing || null : null
  };
  return (
    <main className="closet-page wardrobe-studio-page">
      <div className="wardrobe-studio-shell">
        <aside className="wardrobe-sidebar" aria-label="My wardrobe">
          <div className="wardrobe-sidebar-head">
            <h1>My Wardrobe</h1>
            <button type="button" aria-label="Search wardrobe" onClick={() => openRoute('/closet/items')}><SearchIcon /></button>
          </div>

          <div className="wardrobe-category-stack">
            {wardrobeSections.map((section) => (
              <section className="wardrobe-category-panel" key={section.label}>
                <button className="wardrobe-category-toggle" type="button" onClick={() => setFilter(section.categories[0])} aria-label={`Filter ${section.label}`}>
                  <span>{section.icon}</span>
                  <strong>{section.label}</strong>
                  <small>⌄</small>
                </button>
                <div className="wardrobe-thumb-grid">
                  {section.items.length ? section.items.slice(0, 3).map((item) => (
                    <button className={selectedIds.includes(item.id) ? 'active' : ''} type="button" key={item.id} onClick={() => handleWardrobeItemClick(item)} title={item.name}>
                      <img src={item.imageUrl} alt={item.name} />
                    </button>
                  )) : (
                    <a className="wardrobe-empty-thumb" href="/closet/add">Add</a>
                  )}
                </div>
              </section>
            ))}
          </div>

          <a className="wardrobe-add-button" href="/closet/add">+ Add New Item</a>
        </aside>

        <section className="wardrobe-model-stage" aria-label="Wardrobe model preview">
          <div className="wardrobe-model-tools left">
            <button type="button" onClick={() => user.bodyPhotoUrl ? setStagePreviewMode('model') : openRoute('/profile')}>
              <span>{user.bodyPhotoUrl ? <img src={user.bodyPhotoUrl} alt="" /> : <UserIcon />}</span>
              <small>Model</small>
            </button>
            <button type="button" onClick={() => applyAccessorySlot('cap', 'Cap')}>
              <span><BagIcon /></span>
              <small>Cap</small>
            </button>
            <button type="button" onClick={() => applyAccessorySlot('goggles', 'Sunglasses')}>
              <span><EyeIcon /></span>
              <small>Sunglasses</small>
            </button>
          </div>

          <div className="wardrobe-model-tools right">
            <button type="button" onClick={undoWardrobeSelection} aria-label="Undo selection"><span>↶</span><small>Undo</small></button>
            <button type="button" onClick={clearWardrobeSelection} aria-label="Clear selection"><span>⌫</span><small>Clear</small></button>
          </div>

          <div className="wardrobe-model-backdrop" aria-hidden="true" />
          <div className="wardrobe-model-frame">
            <RoomScene
              key={`${stagePreviewMode}:${modelPreview}`}
              modelSource={modelSource}
              alt={previewAlt}
              generating={generating}
              user={user}
              onOpen={() => setFullscreenImage({ src: modelPreview, alt: previewAlt, title: previewTitle })}
              onEmpty={() => openRoute('/profile')}
            />
          </div>

          {!generating && message && <p className={`wardrobe-stage-message ${/error|missing|not enough|failed|could not/i.test(message) ? 'error-message' : ''}`}>{message}</p>}

          <div className="wardrobe-stage-actions">
            <label className="wardrobe-auto-apply-toggle">
              <input type="checkbox" checked={autoApply} onChange={(event) => setAutoApply(event.target.checked)} />
              <span>Auto-apply</span>
            </label>
            <button className="wardrobe-generate-button" type="button" onClick={() => generateOutfit(selectedIds, { title: 'My wardrobe look' })} disabled={generating || selectedIds.length === 0}>
              <SparkleLineIcon />
              <span>{generating ? 'Generating...' : 'Generate Look'}</span>
            </button>
            <button className="wardrobe-heart-button" type="button" onClick={() => latestOutfit?.imageUrl ? setFullscreenImage({ src: latestOutfit.imageUrl, alt: latestOutfit.title, title: latestOutfit.title }) : setMessage('Generate a look first to preview it.') } aria-label="Open latest look"><HeartIcon /></button>
          </div>
        </section>

        <aside className="wardrobe-recommendations" aria-label="AI recommendations">
          <div className="wardrobe-recommendations-head">
            <h2><SparkleLineIcon /> Recommendations</h2>
            <button className="wardrobe-refresh-button" type="button" onClick={() => askForSuggestions('today casual')}>Refresh</button>
          </div>
          <div className="wardrobe-recommendation-tabs">
            {closetOccasions.slice(0, 4).map((idea, index) => (
              <button className={index === 0 ? 'active' : ''} type="button" key={idea} onClick={() => askForSuggestions(idea)}>{idea}</button>
            ))}
          </div>

          <div className="wardrobe-recommendation-list">
            {wardrobeRecommendationCards.length ? wardrobeRecommendationCards.map((card) => (
              <article className="wardrobe-recommendation-card combo" key={card.id}>
                <button className="wardrobe-recommendation-combo" type="button" onClick={() => tryRecommendedLook(card)}>
                  <span className="wardrobe-combo-hero"><img src={card.items[0].imageUrl} alt={card.items[0].name} /></span>
                  {card.items.length > 1 && <span className="wardrobe-combo-strip">
                    {card.items.slice(1, 4).map((item) => <img key={`${card.id}-${item.id}`} src={item.imageUrl} alt={item.name} />)}
                  </span>}
                  <small>{card.items.length} wardrobe {card.items.length === 1 ? 'piece' : 'pieces'}</small>
                  <strong>{card.title}</strong>
                  <em>Try this look</em>
                </button>
              </article>
            )) : (
              <article className="wardrobe-recommendation-card empty">
                <p>Add a few wardrobe items to unlock outfit recommendations.</p>
                <a href="/closet/add">Add New Item</a>
              </article>
            )}
          </div>

          <div className="wardrobe-score-card">
            <p>Style Score</p>
            <div>
              <strong>{score}</strong>
              <span><b>{selectedItems.length ? 'Great Choice!' : 'Ready to Style'}</b><small>{selectedItems.length ? 'This look suits your wardrobe.' : 'Select clothes to build a look.'}</small></span>
            </div>
          </div>
        </aside>
      </div>
      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
    </main>
  );
}

function ClosetComboPage({ user, setUser }) {
  const [state, setState] = useState({ items: [], suggestions: [], loading: true, error: '' });
  const [selectedIds, setSelectedIds] = useState([]);
  const [comboSlots, setComboSlots] = useState({});
  const [occasion, setOccasion] = useState('today casual');
  const [weather, setWeather] = useState('');
  const [mood, setMood] = useState('');
  const [plannedFor, setPlannedFor] = useState(dateInputValue());
  const [backdrop, setBackdrop] = useState('neutral studio');
  const [pose, setPose] = useState('front facing');
  const [lighting, setLighting] = useState('natural light');
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api('/closet')
      .then((data) => {
        if (!alive) return;
        const items = data.items || [];
        setState({ items, suggestions: data.suggestions || [], loading: false, error: '' });
        const seededIds = JSON.parse(localStorage.getItem('fitlook_combo_seed') || '[]').filter((id) => items.some((item) => item.id === id));
        if (seededIds.length) {
          const seededItems = seededIds.map((id) => items.find((item) => item.id === id)).filter(Boolean);
          setSelectedIds(seededIds);
          setComboSlots(slotsFromItems(seededItems));
          localStorage.removeItem('fitlook_combo_seed');
        }
      })
      .catch((err) => {
        if (alive) setState({ items: [], suggestions: [], loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const selectedItems = selectedIds.map((id) => state.items.find((item) => item.id === id)).filter(Boolean);
  const selectedKey = selectedIds.slice().sort().join(':');
  const comboOptions = state.suggestions.slice(0, 6);
  const slotItems = closetComboSlots.map((slot) => ({
    ...slot,
    selected: state.items.find((item) => item.id === comboSlots[slot.key]) || null,
    options: state.items.filter((item) => slot.categories.includes(item.category))
  }));

  const selectedIdsFromSlots = (slots) => [...new Set(Object.values(slots).filter(Boolean))];
  const slotsFromItems = (items) => {
    const next = {};
    closetComboSlots.forEach((slot) => {
      const item = items.find((entry) => slot.categories.includes(entry.category));
      if (item) next[slot.key] = item.id;
    });
    return next;
  };

  const chooseSlotItem = (slotKey, item) => {
    setComboSlots((current) => {
      const next = { ...current };
      if (!item) delete next[slotKey];
      else next[slotKey] = item.id;
      setSelectedIds(selectedIdsFromSlots(next));
      return next;
    });
  };

  const applyComboItems = (items = []) => {
    setComboSlots(slotsFromItems(items));
    setSelectedIds(items.map((item) => item.id).filter(Boolean));
  };

  const toggleSelected = (item) => {
    setSelectedIds((current) => current.filter((id) => id !== item.id));
    setComboSlots((current) => {
      const next = { ...current };
      Object.entries(next).forEach(([key, id]) => {
        if (id === item.id) delete next[key];
      });
      return next;
    });
  };

  const swapSelected = (item) => {
    const replacement = state.items
      .filter((candidate) => candidate.id !== item.id && candidate.category === item.category && !selectedIds.includes(candidate.id))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    if (!replacement) {
      setMessage(`No other ${item.category} item is available to swap.`);
      return;
    }
    setSelectedIds((current) => current.map((id) => (id === item.id ? replacement.id : id)));
    setComboSlots((current) => {
      const matchedSlot = closetComboSlots.find((slot) => slot.categories.includes(item.category));
      if (!matchedSlot || current[matchedSlot.key] !== item.id) return current;
      return { ...current, [matchedSlot.key]: replacement.id };
    });
    setMessage(`Swapped ${item.name} with ${replacement.name}.`);
  };

  const askForSuggestions = async (nextOccasion = occasion) => {
    setOccasion(nextOccasion);
    setMessage('Finding combo ideas...');
    try {
      const data = await api('/closet/suggest', {
        method: 'POST',
        body: JSON.stringify({ occasion: nextOccasion, weather, mood })
      });
      setState((current) => ({ ...current, suggestions: data.suggestions || [] }));
      setMessage('Combo ideas ready.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const generateOutfit = async (ids = selectedIds, details = {}) => {
    if (!ids.length) {
      setMessage('Choose at least one shirt, pant, shoe, or accessory.');
      return;
    }
    setGenerating(true);
    setMessage('Generating your selected combo with FitRoom...');
    try {
      const data = await api('/closet/outfits/generate', {
        method: 'POST',
        body: JSON.stringify({
          itemIds: ids,
          occasion: details.occasion || occasion,
          weather,
          mood,
          plannedFor,
          backdrop,
          pose,
          lighting,
          notes: [backdrop, pose, lighting].filter(Boolean).join(' · '),
          title: details.title || `Closet combo for ${details.occasion || occasion || 'today'}`
        })
      });
      if (data.user) setUser(data.user);
      setMessage('Combo preview is ready in wardrobe.');
      window.history.pushState({}, '', '/closet?preview=latest');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <main className="closet-combo-page">
      <section className="wrap closet-add-hero">
        <div>
          <p className="kicker">Outfit Builder</p>
          <h1>Build a combo.</h1>
          <p className="lead">Choose which shirt goes with which pant, then add shoes or accessories and generate the outfit on you.</p>
        </div>
        <a className="secondary-button" href="/closet">Back To Closet</a>
      </section>

      <section className="wrap closet-combo-layout">
        <div className="closet-builder">
          <div className="closet-builder-controls">
            <input value={occasion} onChange={(event) => setOccasion(event.target.value)} placeholder="Occasion" />
            <input value={weather} onChange={(event) => setWeather(event.target.value)} placeholder="Weather" />
            <input value={mood} onChange={(event) => setMood(event.target.value)} placeholder="Mood" />
            <button type="button" onClick={() => askForSuggestions()} disabled={state.items.length === 0}>Suggest</button>
          </div>
          <div className="closet-scene-controls">
            <label><span>Plan date</span><input type="date" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} /></label>
            <label><span>Backdrop</span><select value={backdrop} onChange={(event) => setBackdrop(event.target.value)}><option>neutral studio</option><option>office lobby</option><option>cafe</option><option>outdoor street</option><option>wedding venue</option></select></label>
            <label><span>Pose</span><select value={pose} onChange={(event) => setPose(event.target.value)}><option>front facing</option><option>relaxed standing</option><option>walking pose</option><option>three-quarter angle</option></select></label>
            <label><span>Lighting</span><select value={lighting} onChange={(event) => setLighting(event.target.value)}><option>natural light</option><option>studio softbox</option><option>evening warm</option><option>bright daylight</option></select></label>
          </div>
          <div className="selected-strip">
            {selectedItems.length ? selectedItems.map((item) => (
              <div className="selected-chip" key={item.id}>
                <img src={item.imageUrl} alt="" />
                <span>{item.name}</span>
                <button type="button" onClick={() => swapSelected(item)}>Swap</button>
                <button type="button" onClick={() => toggleSelected(item)}>Remove</button>
              </div>
            )) : <span>Select a shirt and pant below, or use an AI suggestion.</span>}
          </div>
          <button className="submit" type="button" disabled={generating || selectedIds.length === 0} onClick={() => generateOutfit()}>{generating ? 'Generating...' : 'Generate Combo On Me'}</button>
          {message && <p className={`form-message ${/error|missing|not enough|failed|could not/i.test(message) ? 'error-message' : ''}`}>{message}</p>}
          {state.loading && <StatusPanel text="Loading closet items..." />}
          {state.error && <StatusPanel text={state.error} />}
        </div>

        <section className="combo-selection-panel closet-combo-selection-page" aria-label="Combo selection">
          <div className="combo-selection-head">
            <strong>Combo Selection</strong>
            <span>{selectedItems.length ? `${selectedItems.length} pieces selected` : 'Choose shirt, pant and more'}</span>
          </div>
          <div className="slot-combo-builder" aria-label="Build a custom clothing combo">
            {slotItems.map((slot) => (
              <article className="slot-picker" key={slot.key}>
                <div className="slot-picker-head">
                  <div><strong>{slot.label}</strong><span>{slot.helper}</span></div>
                  {slot.selected && <button type="button" onClick={() => chooseSlotItem(slot.key, null)}>Clear</button>}
                </div>
                <div className="slot-selected-preview">
                  {slot.selected ? <><img src={slot.selected.imageUrl} alt="" /><span>{slot.selected.name}</span></> : <span>No {slot.label.toLowerCase()} selected</span>}
                </div>
                <div className="slot-options">
                  {slot.options.length ? slot.options.slice(0, 10).map((item) => (
                    <button className={slot.selected?.id === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => chooseSlotItem(slot.key, item)} title={item.name}>
                      <img src={item.imageUrl} alt="" />
                    </button>
                  )) : <small>Add {slot.label.toLowerCase()} items to your closet.</small>}
                </div>
              </article>
            ))}
          </div>
          <div className="combo-options">
            {comboOptions.length ? comboOptions.map((combo, index) => {
              const comboIds = combo.itemIds || [];
              const comboKey = comboIds.slice().sort().join(':');
              const active = comboKey && comboKey === selectedKey;
              return (
                <button className={active ? 'active' : ''} type="button" key={combo.key || combo.title || index} onClick={() => applyComboItems(combo.items || [])}>
                  <span className="combo-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="combo-thumbs">{(combo.items || []).slice(0, 4).map((item) => <img src={item.imageUrl} alt="" key={item.id} />)}</span>
                  <span className="combo-copy"><strong>{combo.title || `Combo ${index + 1}`}</strong><small>{combo.reason || 'AI-picked from your closet'}</small></span>
                </button>
              );
            }) : (
              <button className="empty-combo-option" type="button" onClick={() => askForSuggestions()}>
                <span className="combo-number">AI</span>
                <span className="combo-copy"><strong>Create combos</strong><small>Get recommendations from your uploaded closet.</small></span>
              </button>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function ClosetItemsPage({ user, setUser }) {
  const [state, setState] = useState({ items: [], loading: true, error: '' });
  const [filter, setFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api('/closet')
      .then((data) => {
        if (alive) setState({ items: data.items || [], loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ items: [], loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const filteredItems = state.items.filter((item) => filter === 'all' || item.category === filter);

  const updateItem = async (item, updates) => {
    try {
      const data = await api(`/closet/items/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      setState((current) => ({ ...current, items: current.items.map((entry) => (entry.id === item.id ? data.item : entry)) }));
    } catch (err) {
      setMessage(err.message);
    }
  };

  const deleteItem = async (item) => {
    try {
      await api(`/closet/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      setSelectedIds((current) => current.filter((id) => id !== item.id));
      setState((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }));
    } catch (err) {
      setMessage(err.message);
    }
  };

  const toggleSelected = (item) => {
    setSelectedIds((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id].slice(-5)));
  };

  const openComboBuilder = () => {
    localStorage.setItem('fitlook_combo_seed', JSON.stringify(selectedIds));
    window.location.href = '/closet/combo';
  };

  return (
    <main className="closet-items-page">
      <section className="wrap closet-items-hero">
        <div>
          <p className="kicker">Wardrobe</p>
          <h1>Your closet</h1>
          <p className="lead">Browse clothes by type, save favorites, remove old items, or send selected pieces to the combo builder.</p>
        </div>
        <div className="closet-items-actions">
          <a className="secondary-button" href="/closet">Back To Closet</a>
          <a className="button" href="/closet/add">Add Clothes</a>
        </div>
      </section>

      <section className="wrap closet-items-section standalone">
        <div className="section-head">
          <h2>Your closet</h2>
          <div className="closet-tabs">{closetCategories.map(([label, value]) => <button className={filter === value ? 'active' : ''} type="button" key={value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        </div>
        {message && <p className={`form-message ${/error|missing|failed|could not|cannot|upload/i.test(message) ? 'error-message' : ''}`}>{message}</p>}
        {selectedIds.length > 0 && (
          <div className="closet-selection-bar">
            <span>{selectedIds.length} selected for combo</span>
            <button type="button" onClick={openComboBuilder}>Build Combo</button>
          </div>
        )}
        {state.loading && <StatusPanel text="Loading closet items..." />}
        {state.error && <StatusPanel text={state.error} />}
        {!state.loading && !state.error && filteredItems.length === 0 && <EmptyProducts search={filter === 'all' ? '' : filter} />}
        <div className="closet-grid">
          {filteredItems.map((item) => (
            <article className={`closet-item-card ${selectedIds.includes(item.id) ? 'selected' : ''}`} key={item.id}>
              <button className="closet-item-media" type="button" onClick={() => toggleSelected(item)}>
                <img src={item.imageUrl} alt={item.name} />
                <span>{selectedIds.includes(item.id) ? 'Selected' : 'Add to combo'}</span>
              </button>
              <div className="closet-item-info">
                <h3>{item.name}</h3>
                <p>{[item.color, item.fabric, item.category, item.formality].filter(Boolean).join(' · ')}</p>
                <div>
                  <button type="button" onClick={() => updateItem(item, { favorite: !item.favorite })}>{item.favorite ? 'Saved' : 'Save'}</button>
                  <button type="button" onClick={() => deleteItem(item)}>Remove</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function ClosetAddPage({ user, setUser }) {
  const formRef = useRef(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const analysisRunRef = useRef(0);
  const [uploadPreview, setUploadPreview] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [detectedProfile, setDetectedProfile] = useState(null);
  const [savedItems, setSavedItems] = useState([]);
  const [season, setSeason] = useState('summer');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
  }, [uploadPreview]);

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const applyDetectedDetails = (details = {}) => {
    const form = formRef.current;
    if (!form) return;
    const setField = (name, value, defaults = ['', 'any', 'all-season']) => {
      const field = form.elements[name];
      const next = Array.isArray(value) ? value.join(', ') : String(value || '');
      if (!field || !next) return;
      if (!field.value || defaults.includes(field.value)) field.value = next;
    };
    setField('name', details.name);
    setField('category', details.category);
    setField('color', details.color);
    setField('fabric', details.fabric);
    setField('pattern', details.pattern);
    setField('formality', details.formality);
    setField('occasions', details.occasions);
    const detectedSeason = Array.isArray(details.season) ? details.season[0] : details.season;
    if (['summer', 'winter', 'monsoon', 'spring', 'autumn', 'all-season'].includes(String(detectedSeason || '').toLowerCase())) setSeason(String(detectedSeason).toLowerCase());
    const detectedTags = Array.isArray(details.tags) ? details.tags : String(details.tags || '').split(',');
    if (detectedTags.filter(Boolean).length) setTags([...new Set(detectedTags.map((tag) => String(tag).replace(/^#/, '').trim()).filter(Boolean))].slice(0, 12));
  };

  const analyzeUpload = async (file, runId) => {
    setAnalyzing(true);
    setDetectedProfile(null);
    setMessage('Analyzing clothing photo...');
    try {
      const prepared = await prepareClosetItemPhoto(file);
      const form = new FormData();
      form.set('item', prepared);
      const data = await api('/closet/items/analyze', { method: 'POST', body: form });
      if (analysisRunRef.current !== runId) return;
      setDetectedProfile(data.visualProfile || null);
      applyDetectedDetails(data.details || {});
      setMessage('AI details detected. Review and save the item.');
    } catch (err) {
      if (analysisRunRef.current !== runId) return;
      setMessage(`Could not auto-detect details. ${err.message}`);
    } finally {
      if (analysisRunRef.current === runId) setAnalyzing(false);
    }
  };

  const selectUpload = (event) => {
    const file = event.currentTarget.files?.[0];
    setUploadPreview(file ? URL.createObjectURL(file) : '');
    setDetectedProfile(null);
    const runId = analysisRunRef.current + 1;
    analysisRunRef.current = runId;
    if (file) analyzeUpload(file, runId);
    else {
      setAnalyzing(false);
      setMessage('');
    }
  };

  const submitUpload = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const chosenFile = form.get('item');
    const file = chosenFile?.name ? chosenFile : cameraRef.current?.files?.[0] || fileRef.current?.files?.[0];
    if (!file || !file.name) {
      setMessage('Upload a clothing photo first.');
      return;
    }
    if (!form.get('name')) form.set('name', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    if (detectedProfile) form.set('visualProfile', JSON.stringify(detectedProfile));
    setUploading(true);
    setMessage('Analyzing clothing photo and saving closet item...');
    try {
      form.set('item', await prepareClosetItemPhoto(file));
      const data = await api('/closet/items', { method: 'POST', body: form });
      setSavedItems((current) => [data.item, ...current].slice(0, 6));
      event.currentTarget.reset();
      if (cameraRef.current) cameraRef.current.value = '';
      setUploadPreview('');
      setDetectedProfile(null);
      setSeason('summer');
      setTags([]);
      setTagInput('');
      setMessage('Added to your closet with AI-detected details.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setUploading(false);
    }
  };

  const discardDraft = () => {
    analysisRunRef.current += 1;
    formRef.current?.reset();
    if (fileRef.current) fileRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
    setUploadPreview('');
    setDetectedProfile(null);
    setAnalyzing(false);
    setMessage('');
    setSeason('summer');
    setTags([]);
    setTagInput('');
  };

  const addTag = () => {
    const nextTags = tagInput.split(',').map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean);
    if (!nextTags.length) return;
    setTags((current) => [...new Set([...current, ...nextTags])].slice(0, 12));
    setTagInput('');
  };

  return (
    <main className="closet-add-page atelier-closet-add-page">
      <section className="wrap closet-add-hero atelier-closet-add-hero">
        <div>
          <h1>Curate Your Studio</h1>
          <p className="lead">Add a new piece to your digital archive. High-quality imagery ensures the most accurate AI-generated outfit recommendations and virtual try-ons.</p>
        </div>
      </section>

      <section className="wrap closet-add-layout atelier-closet-add-layout">
        <form ref={formRef} className="atelier-closet-add-form" onSubmit={submitUpload}>
          <div className="atelier-closet-upload-column">
            <label className={`atelier-closet-upload-zone ${uploadPreview ? 'has-preview' : ''}`}>
              <input ref={fileRef} name="item" type="file" accept="image/*" onChange={selectUpload} />
              {uploadPreview ? <img src={uploadPreview} alt="Closet item preview" /> : <span className="atelier-closet-upload-copy"><span className="atelier-closet-upload-icon"><SparkleLineIcon /></span><strong>Upload Clothing Photo</strong><small>Drag and drop or click to browse</small><em>Optimal: Neutral background, flat lay or ghost mannequin</em></span>}
            </label>
            <input ref={cameraRef} className="camera-input" type="file" accept="image/*" capture="environment" onChange={selectUpload} />
            <div className="atelier-closet-upload-thumbs" aria-label="Upload options">
              <button type="button" onClick={() => cameraRef.current?.click()} aria-label="Take a photo"><CameraIcon /></button>
              <button className="atelier-closet-upload-preview" type="button" onClick={() => fileRef.current?.click()} aria-label="Browse clothing photos">{uploadPreview ? <img src={uploadPreview} alt="Selected clothing" /> : <SparkleLineIcon />}</button>
              <button type="button" onClick={() => fileRef.current?.click()} aria-label="Add a clothing photo">+</button>
            </div>
            {savedItems.length > 0 && <div className="atelier-closet-recent"><span>Recently added</span>{savedItems.slice(0, 3).map((item) => <a href="/closet/items" key={item.id}><img src={item.imageUrl} alt={item.name} /></a>)}</div>}
          </div>

          <section className="atelier-closet-specifications">
            <header><span>Archive Entry: {categoryLabel(detectedProfile?.category || 'New Item')}</span><h2>Item Specifications</h2></header>
            <div className="atelier-closet-form-grid">
              <label><span>Dress Name</span><input name="name" placeholder="e.g. Moonlight Silk Slip" /></label>
              <label><span>Type</span><select name="category" defaultValue=""><option value="">Select type</option>{closetCategories.slice(1).map(([label, value]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="atelier-closet-color-field"><span>Color</span><div><i aria-hidden="true" /><input name="color" placeholder="Stone / Ivory" /></div></label>
              <label><span>Fabric</span><input name="fabric" placeholder="Silk, linen, cotton" /></label>
              <label><span>Pattern</span><input name="pattern" placeholder="Solid / Floral" /></label>
              <div className="atelier-closet-season"><span>Season</span><input name="season" type="hidden" value={season} readOnly /><div><button className={season === 'summer' || season === 'spring' ? 'active' : ''} type="button" onClick={() => setSeason('summer')}>Spring/Summer</button><button className={season === 'winter' || season === 'autumn' ? 'active' : ''} type="button" onClick={() => setSeason('winter')}>Autumn/Winter</button></div></div>
              <label><span>Vibe</span><select name="formality" defaultValue="any"><option value="any">Select vibe</option><option value="casual">Casual</option><option value="smart-casual">Smart Casual</option><option value="formal">Elegant</option><option value="party">Party</option><option value="active">Active</option></select></label>
              <label><span>Occasion</span><input name="occasions" placeholder="Evening, Work, Wedding" /></label>
            </div>
            <div className="atelier-closet-tags"><span>Metadata Tags</span><div className="atelier-closet-tag-list">{tags.map((tag) => <button type="button" key={tag} onClick={() => setTags((current) => current.filter((item) => item !== tag))}>#{tag} <b aria-hidden="true">x</b></button>)}</div><input type="hidden" name="tags" value={tags.join(', ')} readOnly /><input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} placeholder="Press Enter to add tags..." /></div>
            <footer><button className="atelier-closet-discard" type="button" onClick={discardDraft}>Discard Draft</button><button className="atelier-closet-save" type="submit" disabled={uploading || analyzing}>{uploading ? 'Saving...' : analyzing ? 'Detecting Details...' : 'Save Clothing Item'}</button></footer>
            {message && <p className={`form-message ${/error|missing|failed|could not|cannot|upload/i.test(message) ? 'error-message' : ''}`}>{message}</p>}
          </section>
        </form>
      </section>
    </main>
  );
}

function TryOnGenerating({ text = 'Try-on is being generated' }) {
  const [progress, setProgress] = useState(7);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 94) return current;
        const step = current < 45 ? 7 : current < 76 ? 4 : 2;
        return Math.min(94, current + step);
      });
    }, 850);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="tryon-generating">
      <div className="tryon-progress-copy">
        <strong>{text}</strong>
        <span>{progress}%</span>
      </div>
      <div className="tryon-progress-track" aria-label={`${progress}% generated`}>
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function ProductGridSkeleton({ count = 8 }) {
  return (
    <div className="product-grid skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <article className="product-card product-skeleton" key={index}>
          <div className="skeleton-media" />
          <div className="product-info">
            <span className="skeleton-line wide" />
            <span className="skeleton-line medium" />
            <span className="skeleton-line short" />
          </div>
        </article>
      ))}
    </div>
  );
}

function ProductDetailSkeleton() {
  return (
    <main className="product-page">
      <section className="wrap product-detail">
        <div className="product-detail-grid product-detail-skeleton" aria-hidden="true">
          <div className="skeleton-detail-media" />
          <div className="product-summary">
            <span className="skeleton-line short" />
            <span className="skeleton-line title" />
            <span className="skeleton-line wide" />
            <span className="skeleton-line medium" />
            <div className="product-detail-facts">
              {Array.from({ length: 4 }).map((_, index) => <span className="skeleton-box" key={index} />)}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SearchPage({ user, setUser, tryOnMode = false }) {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') || '';
  const tag = params.get('tag') || '';
  const category = params.get('category') || '';
  const brand = params.get('brand') || '';
  const gender = params.get('gender') || '';
  const sort = params.get('sort') || '';
  const newArrival = params.get('newArrival') || '';
  const state = useProducts({ q, tag, category, brand, gender, sort, newArrival, limit: 60 });
  const [tryOns, setTryOns] = useTryOnCache(user, state.products);
  const [tryOnLoading, setTryOnLoading] = useState({});
  const [tryOnVideoLoading, setTryOnVideoLoading] = useState({});
  const [tryOnErrors, setTryOnErrors] = useState({});
  const [tryOnVideoErrors, setTryOnVideoErrors] = useState({});
  const [continueWithoutTryOn, setContinueWithoutTryOn] = useState(false);
  const autoTryOnStarted = useRef('');
  const searchEventStarted = useRef('');
  const hasSearchIntent = Boolean(q);
  const allowTryOnTrial = Boolean(user) && !continueWithoutTryOn && (tryOnMode || hasSearchIntent);
  const shouldAutoGenerate = Boolean(user) && !continueWithoutTryOn && hasSearchIntent && !tryOnMode;
  const trialProducts = state.products.slice(0, 4);
  const visibleProducts = allowTryOnTrial ? trialProducts : state.products;
  const lockedProducts = allowTryOnTrial ? state.products.slice(4, 12) : [];
  const title = tryOnMode ? 'AI Try-On' : q || tag || category || brand || gender || (newArrival ? 'New Arrivals' : 'All Products');
  const filterValues = { q, tag, category, brand, gender, sort, newArrival };
  const shownCount = visibleProducts.length + lockedProducts.length;
  const resultsLabel = state.loading ? 'Searching...' : `${state.total} Products`;
  const listingMode = tryOnMode ? 'AI Try-On Studio' : hasSearchIntent ? 'Search Results' : category ? 'Category View' : 'Product Listing';

  const generateTryOn = async (product, options = {}) => {
    setTryOnLoading((current) => ({ ...current, [product.id]: true }));
    setTryOnErrors((current) => ({ ...current, [product.id]: '' }));
    try {
      const data = await api(`/tryons/${product.id}`, {
        method: 'POST',
        body: options.force ? JSON.stringify({ force: true }) : undefined
      });
      setTryOns((current) => ({ ...current, [product.id]: data.tryOn }));
      recordEvent('try_on', { productId: product.id, metadata: { regenerated: Boolean(options.force) } });
      if (data.user) {
        setUser((current) => {
          if (!current) return data.user;
          return { ...data.user, tokens: Math.min(current.tokens, data.user.tokens) };
        });
      }
    } catch (err) {
      setTryOnErrors((current) => ({ ...current, [product.id]: err.message }));
    } finally {
      setTryOnLoading((current) => ({ ...current, [product.id]: false }));
    }
  };

  const generateTryOnVideo = async (product, options = {}) => {
    setTryOnVideoLoading((current) => ({ ...current, [product.id]: true }));
    setTryOnVideoErrors((current) => ({ ...current, [product.id]: '' }));
    try {
      const data = await api(`/tryons/${product.id}/video`, {
        method: 'POST',
        body: options.force ? JSON.stringify({ force: true }) : undefined
      });
      setTryOns((current) => ({ ...current, [product.id]: data.tryOn }));
      recordEvent('try_on', { productId: product.id, metadata: { video: true, regenerated: Boolean(options.force) } });
      if (data.user) {
        setUser((current) => {
          if (!current) return data.user;
          return { ...data.user, tokens: Math.min(current.tokens, data.user.tokens) };
        });
      }
    } catch (err) {
      setTryOnVideoErrors((current) => ({ ...current, [product.id]: err.message }));
    } finally {
      setTryOnVideoLoading((current) => ({ ...current, [product.id]: false }));
    }
  };

  useEffect(() => {
    if (!user) return;
    const key = JSON.stringify({ q, tag, category, brand, gender, sort, newArrival });
    if (searchEventStarted.current === key) return;
    searchEventStarted.current = key;
    if (q) recordEvent('search', { query: q, metadata: { tag, category, brand, gender, sort, newArrival } });
    else if (tag || category || brand || gender || newArrival) recordEvent('filter', { metadata: { tag, category, brand, gender, sort, newArrival } });
  }, [user, q, tag, category, brand, gender, sort, newArrival]);

  useEffect(() => {
    if (!shouldAutoGenerate || trialProducts.length === 0) return;
    const runKey = trialProducts.map((product) => product.id).join(',');
    if (autoTryOnStarted.current === runKey) return;
    autoTryOnStarted.current = runKey;

    const missingProducts = trialProducts.filter((product) => !tryOns[product.id]);
    Promise.allSettled(missingProducts.map((product) => generateTryOn(product)));
  }, [shouldAutoGenerate, trialProducts.map((product) => product.id).join(','), Object.keys(tryOns).join(',')]);

  return (
    <main className="product-listing-page">
      <section className="listing-hero">
        <OptimizedImage className="listing-hero-bg" src={asset('hero2.png')} alt="" eager />
        <div className="listing-hero-scrim" aria-hidden="true" />
        <div className="wrap listing-hero-inner">
          <div>
            <p className="listing-kicker">{listingMode}</p>
            <h1>{title}</h1>
            <p className="listing-copy">Discover live catalog pieces, tune filters, and open any product for AI try-on previews.</p>
          </div>
          <div className="listing-hero-panel" aria-label="Product listing summary">
            <span>{resultsLabel}</span>
            <span>{state.loading ? 'Preparing grid' : `Showing ${shownCount || 0}`}</span>
          </div>
        </div>
      </section>

      <section className="wrap listing-toolbar" aria-label="Product listing tools">
        <ListingCategoryChips facets={state.facets} values={filterValues} />
        <form className="listing-sort-form" action="/search">
          {q && <input type="hidden" name="q" value={q} />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          {category && <input type="hidden" name="category" value={category} />}
          {brand && <input type="hidden" name="brand" value={brand} />}
          {gender && <input type="hidden" name="gender" value={gender} />}
          {newArrival && <input type="hidden" name="newArrival" value={newArrival} />}
          <label><span>Sort</span><select name="sort" defaultValue={sort} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
              <option value="">Most relevant</option>
              <option value="newest">Newest</option>
              <option value="price-asc">Price low to high</option>
              <option value="price-desc">Price high to low</option>
            </select></label>
        </form>
      </section>

      <section className="wrap results-shell">
        <div className="results-main">
          <div className="results-head">
            <div><h2>{title}</h2><p className="count" aria-live="polite">{resultsLabel}</p></div>
          </div>
          <ActiveFilterChips values={filterValues} />
          <FilterPanel className="mobile-filters" facets={state.facets} values={filterValues} />
          {state.loading && <ProductGridSkeleton count={8} />}
          {state.error && <StatusPanel text={state.error} onRetry={state.retry} />}
          {!state.loading && !state.error && state.products.length === 0 && <EmptyProducts search={title} />}
          {!state.loading && !state.error && state.products.length > 0 && (
            <div className="product-grid">
              {visibleProducts.map((product, index) => <ProductCard key={product.id} product={product} user={user} tryOn={tryOns[product.id]} canTryOn={allowTryOnTrial && index < 4} tryOnLoading={Boolean(tryOnLoading[product.id])} tryOnVideoLoading={Boolean(tryOnVideoLoading[product.id])} tryOnError={tryOnErrors[product.id]} tryOnVideoError={tryOnVideoErrors[product.id]} onTryOn={generateTryOn} onTryOnVideo={generateTryOnVideo} />)}
              {lockedProducts.length > 0 && (
                <div className="locked-row">
                  {lockedProducts.map((product) => <ProductCard key={`locked-${product.id}`} product={product} locked />)}
                  {user ? (
                    <div className="locked-content"><div><div className="lock-icon">▢</div><p className="locked-title">More AI try-ons are token gated</p><p className="locked-copy">Use the first row for trial previews, buy more tokens, or continue browsing regular product photos.</p><div className="locked-actions"><a className="buy" href="/tokens">Buy More Tokens</a><button className="browse" type="button" onClick={() => setContinueWithoutTryOn(true)}>Continue Without Try-On</button></div></div></div>
                  ) : (
                    <div className="locked-content"><div><div className="lock-icon">▢</div><p className="locked-title">AI try-on previews are locked</p><p className="locked-copy">Create a profile to see more products and generate try-on previews.</p><div className="locked-actions"><a className="buy" href="/signup">Create Profile</a><a className="browse" href="/search">Browse Without Try-On</a></div></div></div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <FilterPanel className="desktop-filters" facets={state.facets} values={filterValues} />
      </section>
    </main>
  );
}

function readWishlistProductIds() {
  const keys = ['fitlook_wishlist', 'fitlook_wishlist_ids', 'fitlook:wishlist', 'wishlist'];
  const ids = [];

  keys.forEach((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const value = JSON.parse(raw);
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (typeof entry === 'string' || typeof entry === 'number') ids.push(String(entry));
          else if (entry?.productId || entry?.id || entry?._id) ids.push(String(entry.productId || entry.id || entry._id));
        });
      } else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([id, saved]) => {
          if (saved) ids.push(String(id));
        });
      }
    } catch {
      raw.split(',').map((id) => id.trim()).filter(Boolean).forEach((id) => ids.push(id));
    }
  });

  try {
    const snapshots = JSON.parse(localStorage.getItem('fitlook_wishlist_products') || '{}');
    if (snapshots && typeof snapshots === 'object' && !Array.isArray(snapshots)) {
      Object.keys(snapshots).filter(Boolean).forEach((id) => ids.push(String(id)));
    }
  } catch {}

  return [...new Set(ids)];
}

function writeWishlistProductIds(ids) {
  const normalizedIds = [...new Set((ids || []).map(String).filter(Boolean))];
  ['fitlook_wishlist', 'fitlook_wishlist_ids', 'fitlook:wishlist', 'wishlist'].forEach((key) => {
    localStorage.setItem(key, JSON.stringify(normalizedIds));
  });
}

function readWishlistProductSnapshots() {
  const snapshots = {};
  try {
    const stored = JSON.parse(localStorage.getItem('fitlook_wishlist_products') || '{}');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) Object.assign(snapshots, stored);
  } catch {}

  for (const key of ['fitlook_wishlist', 'fitlook_wishlist_ids', 'fitlook:wishlist', 'wishlist']) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (!Array.isArray(value)) continue;
      value.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const product = entry.product && typeof entry.product === 'object' ? entry.product : entry;
        const id = wishlistProductId(product) || String(entry.productId || '');
        if (id) snapshots[id] = { ...product, id };
      });
    } catch {}
  }

  return snapshots;
}

function writeWishlistProductSnapshot(product) {
  const id = wishlistProductId(product);
  if (!id || !product) return;
  const snapshots = readWishlistProductSnapshots();
  snapshots[id] = {
    id,
    _id: product._id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    imageUrl: product.imageUrl,
    price: product.price,
    currency: product.currency,
    compareAtPrice: product.compareAtPrice,
    affiliateLink: product.affiliateLink,
    rating: product.rating,
    ratingCount: product.ratingCount,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
  localStorage.setItem('fitlook_wishlist_products', JSON.stringify(snapshots));
}

function removeWishlistProductSnapshot(id) {
  const snapshots = readWishlistProductSnapshots();
  delete snapshots[String(id || '')];
  localStorage.setItem('fitlook_wishlist_products', JSON.stringify(snapshots));
}

function toggleWishlistProductId(productOrId) {
  const product = productOrId && typeof productOrId === 'object' ? productOrId : null;
  const id = product ? wishlistProductId(product) : String(productOrId || '');
  if (!id) return false;
  const current = readWishlistProductIds();
  const isSaved = current.includes(id);
  const saved = !isSaved;
  writeWishlistProductIds(saved ? [...current, id] : current.filter((item) => item !== id));
  if (saved && product) writeWishlistProductSnapshot(product);
  if (!saved) removeWishlistProductSnapshot(id);
  window.dispatchEvent(new CustomEvent('fitlook:wishlist-change', { detail: { id, saved } }));
  if (localStorage.getItem('fitlook_token')) {
    api(`/auth/wishlist/${encodeURIComponent(id)}`, { method: saved ? 'PUT' : 'DELETE' })
      .catch(() => announce('Wishlist saved on this device. Account sync will retry when the connection is available.', 'error'));
  }
  return saved;
}

function wishlistProductId(product) {
  return String(product?.id || product?._id || '');
}

function WishlistHeartButton({ product, className = '' }) {
  const id = wishlistProductId(product);
  const [isSaved, setIsSaved] = useState(() => (id ? readWishlistProductIds().includes(id) : false));

  useEffect(() => {
    if (!id) return undefined;
    const sync = (event) => {
      const ids = event.detail?.ids;
      if (Array.isArray(ids)) setIsSaved(ids.map(String).includes(id));
      else if (String(event.detail?.id || '') === id) setIsSaved(Boolean(event.detail?.saved));
    };
    const syncFromStorage = () => setIsSaved(readWishlistProductIds().includes(id));
    setIsSaved(readWishlistProductIds().includes(id));
    window.addEventListener('fitlook:wishlist-change', sync);
    window.addEventListener('storage', syncFromStorage);
    return () => {
      window.removeEventListener('fitlook:wishlist-change', sync);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, [id]);

  if (!id) return null;

  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const saved = toggleWishlistProductId(product);
    setIsSaved(saved);
    announce(saved ? `${product.name} saved to your wishlist.` : `${product.name} removed from your wishlist.`);
  };

  return (
    <button
      className={`${className} ${isSaved ? 'saved' : ''}`.trim()}
      type="button"
      aria-label={isSaved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
      aria-pressed={isSaved}
      title={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
      onClick={toggle}
    >
      <HeartIcon />
    </button>
  );
}

function readWishlistCollections() {
  try {
    const collections = JSON.parse(localStorage.getItem('fitlook_wishlist_collections') || '[]');
    if (!Array.isArray(collections)) return [];
    return collections
      .map((collection) => ({
        id: String(collection?.id || ''),
        label: cleanDisplayText(collection?.label, ''),
        productIds: [...new Set((collection?.productIds || []).map(String).filter(Boolean))]
      }))
      .filter((collection) => collection.id && collection.label);
  } catch {
    return [];
  }
}

function WishlistPage({ user }) {
  const [wishlistIds, setWishlistIds] = useState(() => readWishlistProductIds());
  const [savedCollections, setSavedCollections] = useState(() => readWishlistCollections());
  const [activeCollection, setActiveCollection] = useState('all');
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState('grid');
  const [shareStatus, setShareStatus] = useState('');
  const [undoRemoval, setUndoRemoval] = useState(null);
  const wishlistState = useWishlistProducts(wishlistIds, user?.id || '');
  const wishlistProducts = wishlistState.products || [];
  const showWishlistTools = wishlistIds.length > 0 || wishlistProducts.length > 0;
  const isLoadingWishlist = wishlistState.loading && Boolean(user || wishlistIds.length > 0);
  const collections = useMemo(() => {
    const byCategory = new Map();
    wishlistProducts.forEach((product) => {
      const category = displayCategory(product);
      const key = `category-${categorySlug(category)}`;
      const existing = byCategory.get(key) || { id: key, label: category, kind: 'category', category, productIds: [] };
      existing.productIds.push(wishlistProductId(product));
      byCategory.set(key, existing);
    });
    return [
      { id: 'all', label: 'All items', kind: 'all', productIds: wishlistProducts.map(wishlistProductId) },
      ...[...byCategory.values()].sort((a, b) => a.label.localeCompare(b.label)),
      ...savedCollections.map((collection) => ({ ...collection, kind: 'saved' }))
    ];
  }, [savedCollections, wishlistProducts]);
  const activeCollectionData = collections.find((collection) => collection.id === activeCollection) || collections[0];
  const visibleWishlistProducts = useMemo(() => {
    const collectionIds = new Set(activeCollectionData?.productIds || []);
    const visible = activeCollectionData?.kind === 'all'
      ? [...wishlistProducts]
      : wishlistProducts.filter((product) => collectionIds.has(wishlistProductId(product)));
    return visible.sort((a, b) => {
      if (sort === 'price-low') return Number(a.price || 0) - Number(b.price || 0);
      if (sort === 'price-high') return Number(b.price || 0) - Number(a.price || 0);
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      return new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0);
    });
  }, [activeCollectionData, sort, wishlistProducts]);

  useEffect(() => {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, []);

  useEffect(() => {
    if (activeCollection !== 'all' && !collections.some((collection) => collection.id === activeCollection)) setActiveCollection('all');
  }, [activeCollection, collections]);

  useEffect(() => {
    if (!undoRemoval) return undefined;
    const timer = window.setTimeout(() => setUndoRemoval(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undoRemoval]);

  useEffect(() => {
    const syncWishlist = () => setWishlistIds(readWishlistProductIds());
    window.addEventListener('fitlook:wishlist-change', syncWishlist);
    window.addEventListener('storage', syncWishlist);
    return () => {
      window.removeEventListener('fitlook:wishlist-change', syncWishlist);
      window.removeEventListener('storage', syncWishlist);
    };
  }, []);

  const removeFromWishlist = (product) => {
    const id = wishlistProductId(product);
    const previousIds = [...wishlistIds];
    const stillSaved = toggleWishlistProductId(product);
    if (stillSaved) return;
    setWishlistIds(previousIds.filter((wishlistId) => wishlistId !== id));
    announce(`${product.name} removed from your wishlist.`);
    setUndoRemoval({ id, name: product.name, product, previousIds });
  };
  const restoreRemoval = () => {
    if (!undoRemoval) return;
    const saved = toggleWishlistProductId(undoRemoval.product);
    if (!saved) return;
    setWishlistIds(undoRemoval.previousIds);
    announce(`${undoRemoval.name} restored to your wishlist.`);
    setUndoRemoval(null);
  };
  const createCollection = () => {
    const label = cleanDisplayText(window.prompt('Name this collection') || '', '');
    if (!label) return;
    const collection = {
      id: `collection-${Date.now()}`,
      label,
      productIds: [...wishlistIds]
    };
    const nextCollections = [...savedCollections, collection];
    localStorage.setItem('fitlook_wishlist_collections', JSON.stringify(nextCollections));
    setSavedCollections(nextCollections);
    setActiveCollection(collection.id);
  };
  const shareWishlist = async () => {
    const shareData = { title: 'My FitLook Wishlist', text: 'See my saved FitLook edit.', url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareData.url);
      setShareStatus(navigator.share ? 'Wishlist shared.' : 'Wishlist link copied.');
    } catch (error) {
      if (error?.name !== 'AbortError') setShareStatus('Could not share this wishlist.');
    }
  };

  return (
    <main className="wishlist-page wishlist-reference-page">
      <section className="wrap wishlist-reference-shell" aria-label="Wishlist">
        {showWishlistTools && (
          <header className="wishlist-reference-head">
            <div>
              <h1>My Wishlist <span>({wishlistProducts.length || wishlistIds.length})</span></h1>
              <p>Your saved edit.</p>
            </div>
            <div className="wishlist-reference-head-actions">
              <button className="wishlist-outline-action" type="button" onClick={createCollection}>+ Create Collection</button>
              <button className="wishlist-outline-action" type="button" onClick={shareWishlist}>↗ Share Wishlist</button>
            </div>
          </header>
        )}
        {shareStatus && <p className="wishlist-share-status" role="status">{shareStatus}</p>}
        {undoRemoval && <div className="wishlist-undo-toast" role="status" aria-live="polite"><span>Removed {undoRemoval.name}.</span><button type="button" onClick={restoreRemoval}>Undo</button></div>}

        {showWishlistTools && (
          <div className="wishlist-reference-toolbar">
            <div className="wishlist-collection-tabs" role="tablist" aria-label="Wishlist collections">
              {collections.map((collection) => (
                <button
                  className={activeCollection === collection.id ? 'active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={activeCollection === collection.id}
                  onClick={() => setActiveCollection(collection.id)}
                  key={collection.id}
                >
                  {collection.label}<span>{collection.productIds.length}</span>
                </button>
              ))}
            </div>
            <div className="wishlist-reference-controls">
              <label className="wishlist-sort-control"><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recently added</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name</option></select></label>
              <div className="wishlist-view-toggle" role="group" aria-label="Wishlist view">
                <button type="button" className={view === 'grid' ? 'active' : ''} aria-label="Grid view" title="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><GridIcon /></button>
                <button type="button" className={view === 'list' ? 'active' : ''} aria-label="List view" title="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><ListIcon /></button>
              </div>
            </div>
          </div>
        )}

        <section className="wishlist-reference-products" aria-label="Saved products">
          {isLoadingWishlist && <ProductGridSkeleton count={8} />}
          {wishlistState.error && wishlistIds.length > 0 && <StatusPanel text={wishlistState.error} onRetry={wishlistState.retry} />}
          {!isLoadingWishlist && !wishlistState.error && visibleWishlistProducts.length > 0 && (
            <div className={`wishlist-reference-grid ${view === 'list' ? 'is-list' : ''}`}>
              {visibleWishlistProducts.map((product) => <WishlistProductCard key={wishlistProductId(product)} product={product} onRemove={() => removeFromWishlist(product)} />)}
            </div>
          )}
          {!isLoadingWishlist && !wishlistState.error && wishlistIds.length === 0 && (
            <section className="wishlist-reference-empty" aria-label="Empty wishlist">
              <div><h2>Your wishlist is waiting.</h2><p>Save pieces from the catalog and they will appear here.</p></div>
              <a href="/search">Explore products</a>
            </section>
          )}
          {!isLoadingWishlist && !wishlistState.error && wishlistIds.length > 0 && wishlistProducts.length === 0 && (
            <section className="wishlist-reference-empty" aria-label="Saved products unavailable">
              <div><h2>Saved items are syncing.</h2><p>We found saved products in your wishlist, but the live catalog did not return them yet.</p></div>
              <button type="button" onClick={wishlistState.retry}>Retry wishlist</button>
            </section>
          )}
          {!isLoadingWishlist && !wishlistState.error && wishlistProducts.length > 0 && visibleWishlistProducts.length === 0 && (
            <section className="wishlist-reference-empty" aria-label="Empty collection">
              <div><h2>This collection is empty.</h2><p>Choose another collection to see your saved products.</p></div>
              <button type="button" onClick={() => setActiveCollection('all')}>Show all items</button>
            </section>
          )}
        </section>

        <section className="wishlist-reference-upgrade" aria-label="AI try-on tokens">
          <span className="wishlist-upgrade-icon"><SparkleLineIcon /></span>
          <div><h2>Try on more looks</h2><p>{user ? `${user.tokens} tokens are ready for your next preview.` : 'Create a profile to unlock personalized AI try-on previews.'}</p></div>
          <a href={user ? '/tokens' : '/signup'}>{user ? 'Explore Tokens' : 'Create Profile'}</a>
        </section>
      </section>
    </main>
  );
}

function WishlistProductCard({ product, onRemove }) {
  const id = wishlistProductId(product);
  const detailHref = `/product/${encodeURIComponent(id)}`;
  const shopHref = product.affiliateLink || detailHref;
  const isExternalShop = Boolean(product.affiliateLink);
  const hasDiscount = product.compareAtPrice && product.compareAtPrice > product.price;

  return (
    <article className="wishlist-reference-card">
      <div className="wishlist-reference-card-media">
        <a href={detailHref} onClick={() => recordEvent('product_click', { productId: id })}><OptimizedImage src={product.imageUrl || asset('hero2.png')} alt={product.name} onError={(event) => { event.currentTarget.src = asset('hero2.png'); }} /></a>
        <button className="card-wishlist-heart saved wishlist-remove-heart" type="button" aria-label={`Remove ${product.name} from wishlist`} aria-pressed={true} title="Remove from wishlist" onClick={onRemove}><HeartIcon /></button>
      </div>
      <div className="wishlist-reference-card-copy">
        <p>{displayBrand(product)}</p>
        <a href={detailHref} onClick={() => recordEvent('product_click', { productId: id })}><h3>{product.name}</h3></a>
        <div><strong>{formatMoney(product.price || 0, product.currency)}</strong>{hasDiscount && <s>{formatMoney(product.compareAtPrice, product.currency)}</s>}</div>
      </div>
      <a className="wishlist-reference-card-action" href={shopHref} target={isExternalShop ? '_blank' : undefined} rel={isExternalShop ? 'noreferrer' : undefined} onClick={() => recordEvent(isExternalShop ? 'shop_click' : 'product_click', { productId: id })}>{isExternalShop ? 'Move to Bag' : 'View Product'} <span>→</span></a>
    </article>
  );
}

function CustomTryOnPage({ user, setUser }) {
  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  return (
    <main className="custom-tryon-page">
      <section className="wrap custom-tryon-hero">
        <h1>Custom Try-On</h1>
        <p className="lead">Transform your digital wardrobe. Upload a flat garment photo and our AI will render it onto your saved model contextually.</p>
      </section>
      <CustomClothingTryOn user={user} setUser={setUser} />
      <CustomTryOnConfidence user={user} />
    </main>
  );
}

function CustomClothingTryOn({ user, setUser }) {
  const fileRef = useRef(null);
  const generationControllerRef = useRef(null);
  const [garmentFile, setGarmentFile] = useState(null);
  const [garmentPreview, setGarmentPreview] = useState('');
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => () => {
    generationControllerRef.current?.abort();
  }, []);

  useEffect(() => () => {
    if (garmentPreview.startsWith('blob:')) URL.revokeObjectURL(garmentPreview);
  }, [garmentPreview]);

  const setGarmentFromFile = (file) => {
    setResult(null);
    setMessage('');
    if (!file) {
      setGarmentFile(null);
      setGarmentPreview('');
      return;
    }
    setGarmentFile(file);
    setGarmentPreview(URL.createObjectURL(file));
  };

  const chooseGarment = (event) => {
    setGarmentFromFile(event.currentTarget.files?.[0]);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    setGarmentFromFile(event.dataTransfer.files?.[0]);
  };

  const submit = async (event) => {
    event.preventDefault();
    const file = garmentFile || fileRef.current?.files?.[0];
    if (!file) {
      setMessage('Upload a clothing photo first.');
      return;
    }
    setLoading(true);
    setMessage('Generating custom try-on...');
    const controller = new AbortController();
    generationControllerRef.current = controller;
    try {
      const form = new FormData();
      form.append('garment', file);
      const data = await api('/tryons/custom', { method: 'POST', body: form, signal: controller.signal });
      setResult(data.tryOn);
      recordEvent('custom_tryon');
      if (data.user) {
        setUser((current) => {
          if (!current) return data.user;
          return { ...data.user, tokens: Math.min(current.tokens, data.user.tokens) };
        });
      }
      setMessage('Custom try-on ready.');
    } catch (err) {
      if (err.name === 'AbortError') setMessage('Generation canceled. Your garment photo is ready to try again.');
      else setMessage(err.message);
    } finally {
      if (generationControllerRef.current === controller) {
        generationControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const cancelGeneration = () => generationControllerRef.current?.abort();

  return (
    <>
      <section className="wrap custom-tryon">
        <form className="custom-tryon-panel" onSubmit={submit}>
          <label
            className={`upload-box custom-upload ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <input ref={fileRef} name="garment" type="file" accept="image/*" onChange={chooseGarment} />
            <span className="custom-upload-content">
              <span className="upload-icon"><UploadCloudIcon /></span>
              <span className="upload-title">Upload clothing photo</span>
              <span className="upload-help">Drag and drop your high-resolution garment image here</span>
              <span className="upload-action">Browse files</span>
            </span>
          </label>
          <div className="custom-preview-grid" aria-label="Custom try-on preview comparison">
            <article className="custom-preview-card">
              <header className="custom-preview-label">
                <strong>Garment Preview</strong>
                <span>Original Upload</span>
              </header>
              <div className={`custom-preview garment ${garmentPreview ? 'has-image' : ''}`}>
                {garmentPreview ? <ZoomableImage src={garmentPreview} alt="Uploaded garment preview" /> : <span>Garment preview</span>}
              </div>
            </article>

            <div className="custom-preview-bridge" aria-hidden="true"><SparkleLineIcon /></div>

            <article className="custom-preview-card">
              <header className="custom-preview-label">
                <strong>Generated Try-On</strong>
                <span>AI Powered</span>
              </header>
              <div className={`custom-preview result ${result?.imageUrl ? 'has-image' : ''}`}>
                {loading && <TryOnGenerating text="Rendering try-on" />}
                {result?.imageUrl ? (
                  <>
                    <ZoomableImage src={result.imageUrl} alt="Generated custom try-on" />
                    <button className="fullscreen-button" type="button" aria-label="Open generated image full screen" title="Open full screen" onClick={() => setFullscreenImage({ src: result.imageUrl, alt: 'Generated custom try-on', title: 'Custom Try-On' })}><FullscreenIcon /></button>
                  </>
                ) : <span>Generated try-on</span>}
                <span className="custom-result-status">{loading ? 'Rendering preview' : result?.imageUrl ? 'Custom try-on ready' : 'Ready for rendering'}</span>
              </div>
            </article>
          </div>

          <div className="custom-tryon-action-block">
            <p>Our AI considers lighting, fabric physics, and body contouring for a realistic preview.</p>
            <button className="submit" type="submit" disabled={loading}>{loading ? 'Generating...' : 'Generate Custom Try-On'}</button>
            {loading && <button className="custom-tryon-cancel" type="button" onClick={cancelGeneration}>Cancel generation</button>}
            <div className="custom-tryon-credit-row"><span>{user?.tokens ?? 0} Credits Left</span><i aria-hidden="true" /><a href="/tokens">Upgrade to Pro</a></div>
          </div>
          {message && <p className={`form-message ${result?.imageUrl ? '' : 'error-message'}`}>{message}</p>}
        </form>
      </section>
      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
    </>
  );
}

function CustomTryOnConfidence({ user }) {
  const recommendations = useRecommendedProducts(user, 5);
  const fallback = useProducts({ limit: 5, sort: 'newest' });
  const products = (recommendations.products.length ? recommendations.products : fallback.products).slice(0, 5);
  const loading = recommendations.loading || (!products.length && fallback.loading);

  return (
    <section className="wrap custom-confidence-section" aria-label="Style with confidence">
      <h2>Style with Confidence</h2>
      <div className="custom-confidence-grid">
        {loading && !products.length ? Array.from({ length: 3 }).map((_, index) => (
          <article className="custom-confidence-card custom-confidence-card-loading" key={`confidence-loading-${index}`}>
            <span aria-hidden="true" />
            <strong>Curating</strong>
          </article>
        )) : products.map((product) => (
          <article className="custom-confidence-card" key={wishlistProductId(product)}>
            <a className="custom-confidence-link" href={`/product/${encodeURIComponent(wishlistProductId(product))}`} onClick={() => recordEvent('product_click', { productId: wishlistProductId(product), source: 'custom_confidence' })}>
              <span className="custom-confidence-image"><OptimizedImage src={product.imageUrl || asset('hero2.png')} alt={product.name} onError={(event) => { event.currentTarget.src = asset('hero2.png'); }} /></span>
              <span className="custom-confidence-copy">
                <small>{displayBrand(product)}</small>
                <strong>{product.name}</strong>
                <b>{formatMoney(product.price || 0, product.currency)}</b>
              </span>
            </a>
            <WishlistHeartButton product={product} className="card-wishlist-heart" />
          </article>
        ))}
      </div>
    </section>
  );
}

function StyleBotPage({ user, setUser }) {
  const [query, setQuery] = useState('');
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const conciergeScrollRef = useRef(null);
  const conciergeEndRef = useRef(null);
  const starterSuggestions = useRecommendedProducts(user, 3);
  const promptIdeas = ['linen shirts under 1500', 'black party dress', 'gold sunglasses', 'oversized denim jacket'];

  useEffect(() => {
    if (!user || runs.length === 0) return undefined;
    let frameId = 0;
    const timeouts = [];
    const scrollToLatest = (behavior = 'smooth') => {
      frameId = window.requestAnimationFrame(() => {
        const scrollNode = conciergeScrollRef.current;
        conciergeEndRef.current?.scrollIntoView({ block: 'end', behavior });
        if (scrollNode) {
          scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior });
        }
      });
    };
    scrollToLatest();
    timeouts.push(window.setTimeout(() => scrollToLatest(), 180));
    timeouts.push(window.setTimeout(() => scrollToLatest(), 520));
    return () => {
      window.cancelAnimationFrame(frameId);
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [user, runs, busy]);

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const sessionHistory = runs.slice().reverse();

  const updateRun = (id, updater) => {
    setRuns((current) => current.map((run) => (run.id === id ? { ...run, ...updater(run) } : run)));
  };

  const submit = async (event) => {
    event.preventDefault();
    const prompt = query.trim();
    if (!prompt || busy) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const promptCompatibility = styleBotCompatibility(prompt);
    const genderPreference = genderPreferenceForStyleQuery(prompt, user.genderPreference || 'other');
    const searchPrompt = genderedStyleBotQuery(prompt, genderPreference);
    setQuery('');
    setBusy(true);
    recordEvent('style_bot_query', { query: prompt });
    setRuns((current) => [
      ...current,
      { id, query: prompt, products: [], tryOns: {}, loading: promptCompatibility.compatible, generating: {}, errors: {}, searchError: promptCompatibility.compatible ? '' : promptCompatibility.reason }
    ]);
    if (!promptCompatibility.compatible) {
      setBusy(false);
      return;
    }

    try {
      const data = await api('/products/amazon-search', {
        method: 'POST',
        body: JSON.stringify({ query: searchPrompt, limit: 2, genderPreference })
      });
      const products = (data.products || []).filter((product) => (
        styleBotProductCompatibility(product, prompt).compatible &&
        styleBotGenderCompatibility(product, genderPreference).compatible
      ));
      if (products.length === 0) {
        throw new Error('Amazon results were found, but none matched your try-on gender preference. Try a more specific clothing search.');
      }
      updateRun(id, () => ({
        products,
        loading: false,
        generating: Object.fromEntries(products.map((product) => [product.id, true]))
      }));

      await Promise.allSettled(products.map(async (product) => {
        try {
          const generated = await api('/tryons/external', {
            method: 'POST',
            body: JSON.stringify({ product })
          });
          recordEvent('try_on', { query: product.name, metadata: { product } });
          updateRun(id, (run) => ({
            tryOns: { ...run.tryOns, [product.id]: generated.tryOn },
            errors: { ...run.errors, [product.id]: '' }
          }));
          if (generated.user) {
            setUser((current) => {
              if (!current) return generated.user;
              return { ...generated.user, tokens: Math.min(current.tokens, generated.user.tokens) };
            });
          }
        } catch (err) {
          updateRun(id, (run) => ({ errors: { ...run.errors, [product.id]: err.message } }));
        } finally {
          updateRun(id, (run) => ({ generating: { ...run.generating, [product.id]: false } }));
        }
      }));
    } catch (err) {
      updateRun(id, () => ({ loading: false, searchError: err.message }));
    } finally {
      setBusy(false);
    }
  };

  const startNewSession = () => {
    setRuns([]);
    setQuery('');
  };

  return (
    <main className="style-bot-page concierge-page">
      <aside className="concierge-session-rail" aria-label="Stylist sessions">
        <a className="concierge-brand" href="/">FitLook</a>
        <p>Stylist sessions</p>
        <div className="concierge-session-list">
          {sessionHistory.length ? sessionHistory.map((run, index) => (
            <button type="button" key={run.id} onClick={() => setQuery(run.query)}>
              <span>{String(sessionHistory.length - index).padStart(2, '0')}</span><strong>{run.query}</strong><small>{run.loading ? 'Curating' : run.searchError ? 'Needs retry' : `${run.products.length} suggestions`}</small>
            </button>
          )) : <div className="concierge-empty-session"><strong>New style session</strong><span>Your personal edit begins here.</span></div>}
        </div>
        <button className="concierge-new-session" type="button" onClick={startNewSession}>+ New Session</button>
      </aside>

      <section className="concierge-workspace" aria-label="FitLook Concierge">
        <div className="concierge-chat-head"><span className="concierge-status-dot" aria-hidden="true" /><strong>FitLook Concierge</strong><small>{user.tokens} credits</small></div>
        <div className="concierge-scroll" ref={conciergeScrollRef}>
          <div className="concierge-message assistant">
            <p className="concierge-message-label">FitLook Concierge</p>
            <div className="concierge-bubble">Welcome. Share the item, occasion, color, or budget you have in mind and I’ll curate a considered edit for your wardrobe.</div>
            {!starterSuggestions.loading && starterSuggestions.products?.length > 0 && <div className="concierge-product-grid">{starterSuggestions.products.slice(0, 3).map((product) => <StyleBotProduct key={`starter-${product.id}`} product={product} onFullscreen={setFullscreenImage} />)}</div>}
          </div>
          {runs.map((run) => (
            <div className="concierge-run" key={run.id}>
              <div className="concierge-message user"><p className="concierge-message-label">You</p><div className="concierge-bubble">{run.query}</div></div>
              <div className="concierge-message assistant">
                <p className="concierge-message-label">FitLook Concierge</p>
                <div className="concierge-bubble concierge-response">
                  {run.loading && <span className="concierge-loading">Curating your edit...</span>}
                  {run.searchError && <p className="form-message error-message">{run.searchError}</p>}
                  {!run.loading && !run.searchError && <><p className="concierge-result-copy">A considered selection based on your request.</p><div className="concierge-product-grid">{run.products.map((product) => <StyleBotProduct key={product.id} product={product} tryOn={run.tryOns[product.id]} loading={Boolean(run.generating[product.id])} error={run.errors[product.id]} onFullscreen={setFullscreenImage} />)}</div></>}
                </div>
              </div>
            </div>
          ))}
          <div className="concierge-scroll-anchor" ref={conciergeEndRef} aria-hidden="true" />
        </div>
        <form className="concierge-composer" onSubmit={submit}>
          <div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask your stylist anything..." aria-label="Ask FitLook Concierge" /><button type="submit" disabled={busy || !query.trim()} aria-label={busy ? 'Curating suggestions' : 'Send message'} title={busy ? 'Curating suggestions' : 'Send message'}>{busy ? '...' : '→'}</button></div>
          <section aria-label="Prompt ideas">{promptIdeas.slice(0, 3).map((idea) => <button type="button" key={idea} onClick={() => setQuery(idea)}>{idea}</button>)}</section>
        </form>
      </section>
      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
    </main>
  );
}

function StyleBotProduct({ product, tryOn, loading, error, onFullscreen }) {
  const [tryOnImageFailed, setTryOnImageFailed] = useState(false);
  const productImage = product.imageUrl || asset('hero2.png');
  const hasUsableTryOn = Boolean(tryOn?.imageUrl) && !tryOnImageFailed;
  const detailHref = `/product/${encodeURIComponent(product.id)}`;

  useEffect(() => {
    setTryOnImageFailed(false);
  }, [tryOn?.imageUrl]);

  return (
    <article className="concierge-product-card">
      <a className="concierge-product-image" href={detailHref} onClick={() => recordEvent('product_click', { productId: product.id })}><OptimizedImage src={productImage} alt={product.name} /></a>
      <WishlistHeartButton product={product} className="card-wishlist-heart" />
      <p>{displayBrand(product)}</p>
      <h2>{product.name}</h2>
      <strong>{formatMoney(product.price, product.currency)}</strong>
      {loading && <span className="concierge-product-state">Preparing preview</span>}
      {hasUsableTryOn && <button className="concierge-preview-action" type="button" onClick={() => onFullscreen({ src: tryOn.imageUrl, alt: `AI try-on for ${product.name}`, title: product.name })}>View preview</button>}
      {tryOn?.imageUrl && !hasUsableTryOn && <span className="concierge-product-state">Preview unavailable</span>}
      {error && <span className="concierge-product-error">{error}</span>}
      <a className="concierge-shop-action" href={product.affiliateLink || detailHref} target={product.affiliateLink ? '_blank' : undefined} rel={product.affiliateLink ? 'noreferrer' : undefined} onClick={() => recordEvent(product.affiliateLink ? 'shop_click' : 'product_click', { productId: product.id })}>Shop the suggestion</a>
    </article>
  );
}

function ImageLightbox({ image, onClose }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Generated try-on preview" onClick={onClose}>
      <button className="lightbox-close" ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close full screen preview">×</button>
      <figure onClick={(event) => event.stopPropagation()}>
        <OptimizedImage src={image.src} alt={image.alt} eager />
        <figcaption>{image.title}</figcaption>
      </figure>
    </div>
  );
}

function TokenPage({ user, setUser }) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState('monthly');
  const [message, setMessage] = useState('');
  const verifiedOrderRef = useRef('');
  const params = new URLSearchParams(window.location.search);
  const returnedOrderId = params.get('merchantOrderId') || params.get('orderId') || '';
  const subscription = user?.subscription;
  const isActive = subscription?.status === 'active' && (!subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd) > new Date());

  useEffect(() => {
    if (!user || !returnedOrderId || verifiedOrderRef.current === returnedOrderId) return;
    verifiedOrderRef.current = returnedOrderId;
    let alive = true;
    setMessage('Verifying payment with PhonePe...');
    api(`/payments/orders/${encodeURIComponent(returnedOrderId)}/status`)
      .then((data) => {
        if (!alive) return;
        if (data.user) setUser(data.user);
        const state = data.order?.status;
        if (state === 'completed') setMessage('Payment confirmed. 100 tokens have been added to your account.');
        else if (state === 'failed') setMessage('Payment was not completed. You can try again when ready.');
        else setMessage('Payment is still pending. Refresh this page in a moment to check again.');
      })
      .catch((err) => {
        if (alive) setMessage(err.message);
      });
    return () => {
      alive = false;
    };
  }, [user, returnedOrderId, setUser]);

  const startCheckout = async () => {
    if (!user) {
      window.location.href = '/signup';
      return;
    }
    setCheckoutLoading(true);
    setMessage('Opening secure PhonePe checkout...');
    try {
      const data = await api('/payments/phonepe/subscription', { method: 'POST' });
      window.location.assign(data.redirectUrl);
    } catch (err) {
      setMessage(err.message);
      setCheckoutLoading(false);
    }
  };

  const creditPacks = [
    {
      id: 'starter',
      label: 'Starter',
      credits: '20',
      showCreditsSuffix: true,
      price: 'Free',
      billing: 'With your profile',
      copy: 'A free set of credits to explore FitLook before your first purchase.',
      cta: 'Open profile',
      href: '/profile'
    },
    {
      id: 'monthly',
      label: 'Monthly',
      credits: '100',
      showCreditsSuffix: true,
      price: 'Rs 1,000',
      billing: 'Every month',
      copy: 'Your renewable credit pack for product and custom clothing try-ons.',
      cta: user ? 'Continue to payment' : 'Create profile',
      featured: true
    },
    {
      id: 'archive',
      label: 'Archive',
      credits: 'Saved looks',
      showCreditsSuffix: false,
      price: 'Included',
      billing: 'Always available',
      copy: 'Revisit generated looks, browse the catalog, and compare products at no extra cost.',
      cta: 'View saved looks',
      href: '/wishlist'
    }
  ];
  const selectedPack = creditPacks.find((pack) => pack.id === selectedPackId) || creditPacks[1];
  const isPaidPack = selectedPack.id === 'monthly';
  const completeSelection = () => {
    if (!user) {
      window.location.assign('/signup');
      return;
    }
    if (isPaidPack) {
      startCheckout();
      return;
    }
    window.location.assign(selectedPack.href);
  };

  return (
    <main className="credit-purchase-page">
      <section className="wrap credit-purchase-shell">
        <header className="credit-purchase-head">
          <p>Curation power</p>
          <h1>Credits</h1>
          <span>Elevate your digital wardrobe experience. Credits empower our sophisticated AI neural networks to render high-fidelity virtual try-ons and generate personalized style journeys tailored to your unique aesthetic.</span>
        </header>

        {message && <p className={`credit-purchase-message ${/failed|not completed|missing|Could not|error/i.test(message) ? 'error-message' : ''}`} role="status">{message}</p>}

        <div className="credit-purchase-layout">
          <div className="credit-purchase-main">
            <section className="credit-pack-grid" aria-label="Credit packs">
              {creditPacks.map((pack) => (
                <button className={`credit-pack-option ${selectedPack.id === pack.id ? 'selected' : ''} ${pack.featured ? 'featured' : ''}`} type="button" key={pack.id} onClick={() => setSelectedPackId(pack.id)} aria-pressed={selectedPack.id === pack.id}>
                  {pack.featured && <span className="credit-pack-badge">Most popular</span>}
                  <small>{pack.label}</small>
                  <strong>{pack.credits}{pack.showCreditsSuffix && <> <em>credits</em></>}</strong>
                  <b>{pack.price}</b>
                  <span>{pack.billing}</span>
                  <i>{pack.copy}</i>
                </button>
              ))}
            </section>

            <section className="credit-payment-section" aria-label="Payment method">
              <div className="credit-section-heading"><h2>Payment Method</h2><span>Secure checkout</span></div>
              <button className="credit-payment-choice active" type="button" aria-pressed="true">
                <span className="credit-phonepe-mark">P</span><strong>PhonePe</strong><small>UPI, cards, and net banking</small><b>Selected</b>
              </button>
            </section>
          </div>

          <aside className="credit-order-summary" aria-label="Order summary">
            <div className="credit-summary-heading"><h2>Order Summary</h2><span>{isActive ? 'Active plan' : 'Selected pack'}</span></div>
            <div className="credit-summary-row"><span>Credit Package</span><strong>{selectedPack.label}</strong></div>
            <div className="credit-summary-row"><span>Credits</span><strong>{selectedPack.credits}</strong></div>
            <div className="credit-summary-row"><span>Billing</span><strong>{selectedPack.billing}</strong></div>
            <div className="credit-summary-row"><span>Processing Fee</span><strong>Free</strong></div>
            <div className="credit-summary-total"><span>Total, today</span><strong>{selectedPack.price}</strong></div>
            <button type="button" onClick={completeSelection} disabled={checkoutLoading}>{checkoutLoading ? 'Opening checkout...' : selectedPack.cta}</button>
            <small>{isPaidPack ? (isActive && subscription.currentPeriodEnd ? `Current plan ends ${formatDate(subscription.currentPeriodEnd)}. Credits are added after secure payment verification.` : 'Secured by PhonePe. Credits are added only after payment verification.') : selectedPack.copy}</small>
          </aside>
        </div>
      </section>
    </main>
  );
}

function ProfilePage({ user, setUser }) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const [preview, setPreview] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [profilePhotoMode, setProfilePhotoMode] = useState('ai-full-body');
  const [fullscreenImage, setFullscreenImage] = useState(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    if (user?.bodyPhotoStatus !== 'generating') return;
    let alive = true;
    const interval = setInterval(() => {
      api('/auth/me')
        .then((data) => {
          if (!alive) return;
          setUser(data.user);
          if (data.user?.bodyPhotoStatus === 'ready') setMessage('Full-body try-on profile is ready.');
          if (data.user?.bodyPhotoStatus === 'failed') setMessage('Full-body profile generation failed. Upload a clearer selfie or body photo.');
        })
        .catch(() => {});
    }, 5000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [user?.bodyPhotoStatus, setUser]);

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const photoSrc = preview || user.bodyPhotoUrl;
  const selectPhoto = (event) => {
    const file = event.currentTarget.files?.[0];
    setPhotoFile(file || null);
    setPreview(file ? URL.createObjectURL(file) : '');
    setMessage('');
  };

  const submitPhoto = async (event) => {
    event.preventDefault();
    const file = photoFile || fileRef.current?.files?.[0] || cameraRef.current?.files?.[0];
    if (!file) {
      setMessage('Choose a new profile photo first.');
      return;
    }
    setSaving(true);
    setMessage('Uploading profile photo...');
    try {
      const form = new FormData();
      form.append('bodyPhoto', await prepareBodyPhoto(file));
      form.append('profilePhotoMode', profilePhotoMode);
      const data = await api('/auth/body-photo', { method: 'POST', body: form });
      setUser(data.user);
      if (fileRef.current) fileRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
      setPhotoFile(null);
      setPreview('');
      setMessage(data.user?.bodyPhotoStatus === 'generating' ? 'Photo saved. Full-body try-on profile is preparing in the background.' : 'Profile photo updated.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const initials = (user.name || user.username || 'FL').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const creditProgress = Math.min(100, Math.max(0, ((user.tokens || 0) / 2000) * 100));
  const logout = () => {
    localStorage.removeItem('fitlook_token');
    setUser(null);
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <main className="profile-page profile-reference-page">
      <section className="wrap profile-reference-shell">
        <header className="profile-reference-head"><h1>My Profile</h1><p>Manage your account preferences</p></header>

        <section className="profile-reference-panel profile-reference-account" aria-label="Account overview">
          <div className="profile-reference-avatar">{photoSrc ? <img src={photoSrc} alt="" /> : <span>{initials}</span>}</div>
          <div className="profile-reference-account-copy"><div><h2>{user.name}</h2><span>@{user.username}</span></div><p>{user.email}</p><small>{genderPreferenceLabel(user.genderPreference)} preference · Member since {formatDate(user.joinedAt)}</small></div>
          <a href="#tryon-photo">Update photo</a>
        </section>

        <section className="profile-reference-panel profile-reference-credits" aria-label="Credit balance">
          <div className="profile-reference-section-head"><div><h2>Credit Balance</h2><p>Credits available for virtual try-ons</p></div><span className="profile-credit-mark"><SparkleLineIcon /></span></div>
          <div className="profile-reference-credit-number"><strong>{user.tokens}</strong><span>credits</span></div>
          <div className="profile-reference-progress"><i style={{ width: `${creditProgress}%` }} /></div>
          <div className="profile-reference-credit-foot"><p>Each new AI try-on uses 1 credit.</p><a href="/tokens">Buy more credits</a></div>
        </section>

        <section className="profile-reference-panel profile-reference-photo" id="tryon-photo" aria-label="Try-on photo">
          <div className="profile-reference-section-head"><div><h2>Try-On Portrait</h2><p>Manage the photo used for your virtual try-on previews.</p></div></div>
          <div className="profile-reference-photo-layout">
            <div className="profile-reference-photo-preview">
              {photoSrc ? <img src={photoSrc} alt="Current model profile" /> : <span>{initials}</span>}
              {photoSrc && <button className="fullscreen-button" type="button" aria-label="Open try-on photo full screen" title="Open full screen" onClick={() => setFullscreenImage({ src: photoSrc, alt: 'Current try-on profile', title: 'Try-on Photo' })}><FullscreenIcon /></button>}
            </div>
            <form className="profile-reference-photo-form" onSubmit={submitPhoto}>
              <label className="profile-reference-upload-zone">
                <input ref={fileRef} name="bodyPhoto" type="file" accept={BODY_PHOTO_ACCEPT} onChange={selectPhoto} />
                <UploadCloudIcon />
                <strong>Upload New Photo</strong>
                <span>Drag and drop or choose a clear photo here</span>
                <b>Browse files</b>
              </label>
              <input ref={cameraRef} className="camera-input" type="file" accept={BODY_PHOTO_ACCEPT} capture="user" onChange={selectPhoto} />
              <div className="profile-reference-photo-tools"><button type="button" onClick={() => cameraRef.current?.click()}>Take photo</button><div role="radiogroup" aria-label="Profile photo mode"><label><input type="radio" name="profilePhotoMode" value="ai-full-body" checked={profilePhotoMode === 'ai-full-body'} onChange={(event) => setProfilePhotoMode(event.target.value)} /> AI full-body profile</label><label><input type="radio" name="profilePhotoMode" value="exact" checked={profilePhotoMode === 'exact'} onChange={(event) => setProfilePhotoMode(event.target.value)} /> Exact photo</label></div></div>
              {preview && <button className="profile-reference-save-photo" type="submit" disabled={saving}>{saving ? 'Saving photo...' : 'Save new photo'}</button>}
              {message && <p className={`profile-reference-message ${/failed|error|clearer/i.test(message) ? 'error-message' : ''}`}>{message}</p>}
              {user.bodyPhotoStatus === 'generating' && <p className="profile-reference-message">Full-body profile is preparing in the background.</p>}
            </form>
          </div>
        </section>

        <section className="profile-reference-panel profile-reference-payment" aria-label="Payment methods">
          <div className="profile-reference-section-head"><div><h2>Payment Methods</h2><p>Payments are securely verified before credits are added.</p></div><a href="/tokens">Add credits</a></div>
          <div className="profile-reference-payment-row"><span>PhonePe</span><strong>UPI, cards, and net banking</strong><small>Secure checkout</small><a href="/tokens" aria-label="Open credit checkout">›</a></div>
        </section>

        <section className="profile-reference-panel profile-reference-settings" aria-label="Account settings">
          <div className="profile-reference-section-head"><div><h2>Account Settings</h2><p>Control how your profile is used across FitLook.</p></div></div>
          <div className="profile-reference-setting-list">
            <div><span>Username</span><strong>@{user.username}</strong></div>
            <div><span>Email address</span><strong>{user.email}</strong></div>
            <div className="profile-reference-mode"><span>Try-on photo mode</span><div role="radiogroup" aria-label="Try-on photo mode"><label><input type="radio" name="profilePhotoModeSettings" value="ai-full-body" checked={profilePhotoMode === 'ai-full-body'} onChange={(event) => setProfilePhotoMode(event.target.value)} /> AI full-body</label><label><input type="radio" name="profilePhotoModeSettings" value="exact" checked={profilePhotoMode === 'exact'} onChange={(event) => setProfilePhotoMode(event.target.value)} /> Exact photo</label></div></div>
            <button className="profile-reference-neutral-action" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fitlook:replay-onboarding'))}><span>Replay platform tour</span><b>›</b></button>
            <a href="/terms"><span>Terms and conditions</span><b>›</b></a>
            <a href="/privacy"><span>Privacy policy</span><b>›</b></a>
            <button type="button" onClick={logout}><span>Log out</span><b>›</b></button>
          </div>
        </section>
      </section>
      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
    </main>
  );
}

function ActiveFilterChips({ values }) {
  const active = [
    ['q', values.q, `Search: ${values.q}`],
    ['tag', values.tag, `Tag: ${values.tag}`],
    ['category', values.category, displayCategory({ category: values.category })],
    ['brand', values.brand, displayBrand({ brand: values.brand })],
    ['gender', values.gender, values.gender],
    ['newArrival', values.newArrival, 'New arrivals'],
    ['sort', values.sort, values.sort === 'price-asc' ? 'Price low to high' : values.sort === 'price-desc' ? 'Price high to low' : values.sort === 'newest' ? 'Newest' : '']
  ].filter(([, value, label]) => value && label);

  if (active.length === 0) return null;

  return (
    <div className="active-filters" aria-label="Active filters">
      {active.map(([key, , label]) => <a href={searchHref(values, { [key]: '' })} key={key}>{label}<span>×</span></a>)}
      <a className="clear" href="/search">Clear all</a>
    </div>
  );
}

function searchHref(values, overrides = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...values, ...overrides }).forEach(([name, value]) => {
    if (value) params.set(name, value);
  });
  return `/search${params.toString() ? `?${params}` : ''}`;
}

function ListingCategoryChips({ facets, values }) {
  const source = facets.categoryCounts?.length
    ? facets.categoryCounts
    : facets.categories.map((category) => ({ category, count: null }));
  const items = source.slice(0, 10);
  if (items.length === 0) return null;

  return (
    <nav className="listing-category-chips" aria-label="Product categories">
      <a className={!values.category ? 'active' : ''} href={searchHref(values, { category: '' })}>All</a>
      {items.map(({ category, count }) => {
        const active = categorySlug(category) === categorySlug(values.category);
        return (
          <a className={active ? 'active' : ''} href={searchHref(values, { category })} key={category}>
            <span>{displayCategory({ category })}</span>
            {count !== null && <small>{count}</small>}
          </a>
        );
      })}
    </nav>
  );
}

function FilterPanel({ facets, values, className = '' }) {
  const resetHref = '/search';
  const brands = usableBrands(facets.brands);

  return (
    <aside className={`filters ${className}`}>
      <div className="filter-head"><div><h2>Filters</h2><p>Refine the live catalog</p></div><a href={resetHref}>Reset</a></div>
      <form className="filter-form" action="/search">
        <label><span>Search</span><input name="q" defaultValue={values.q} placeholder="Search keyword" /></label>
        <label><span>Category</span><select name="category" defaultValue={values.category}>
            <option value="">All categories</option>
            {facets.categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
        <label><span>Brand</span><select name="brand" defaultValue={values.brand}>
            <option value="">All brands</option>
            {brands.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
        <label><span>Gender</span><select name="gender" defaultValue={values.gender}>
            <option value="">All genders</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
            <option value="unisex">Unisex</option>
          </select></label>
        <label><span>Sort</span><select name="sort" defaultValue={values.sort}>
            <option value="">Most relevant</option>
            <option value="newest">Newest</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
          </select></label>
        {values.newArrival && <input type="hidden" name="newArrival" value={values.newArrival} />}
        {values.tag && <input type="hidden" name="tag" value={values.tag} />}
        <button className="apply">Apply Filters</button>
      </form>
    </aside>
  );
}

function ProductPage({ id, user, setUser }) {
  const { product, loading, error } = useProduct(id);
  const related = useSimilarProducts(id, 4);
  const [tryOn, setTryOn] = useState(null);
  const [tryOnImageFailed, setTryOnImageFailed] = useState(false);
  const [tryOnLoading, setTryOnLoading] = useState(false);
  const [tryOnVideoLoading, setTryOnVideoLoading] = useState(false);
  const [tryOnError, setTryOnError] = useState('');
  const [tryOnVideoError, setTryOnVideoError] = useState('');
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [detailImageView, setDetailImageView] = useState('tryon');
  const [selectedSize, setSelectedSize] = useState('M');
  const [selectedTone, setSelectedTone] = useState('charcoal');
  const productViewStarted = useRef('');
  const relatedProducts = related.products.filter((item) => item.id !== id).slice(0, 4);

  useEffect(() => {
    if (!user || !id) {
      setTryOn(null);
      return;
    }
    let alive = true;
    api(`/tryons?productIds=${encodeURIComponent(id)}`)
      .then((data) => {
        if (!alive) return;
        setTryOn(data.tryOns?.[0] || null);
      })
      .catch(() => {
        if (alive) setTryOn(null);
      });
    return () => {
      alive = false;
    };
  }, [id, user]);

  useEffect(() => {
    setTryOnImageFailed(false);
    setDetailImageView(tryOn?.imageUrl ? 'tryon' : 'product');
  }, [tryOn?.imageUrl]);

  useEffect(() => {
    setSelectedSize('M');
    setSelectedTone('charcoal');
  }, [id]);

  useEffect(() => {
    if (!user || !product?.id || productViewStarted.current === product.id) return;
    productViewStarted.current = product.id;
    recordEvent('product_view', { productId: product.id });
  }, [user, product?.id]);

  if (loading) {
    return <ProductDetailSkeleton />;
  }

  if (error || !product) {
    return (
      <main className="wrap product-page">
        <div className="empty-products">
          <h3>Product not found.</h3>
          <p>This item may have been removed from the catalog.</p>
          <a className="button" href="/search">Back to Shop</a>
        </div>
      </main>
    );
  }

  const hasDiscount = product.compareAtPrice && product.compareAtPrice > product.price;
  const discount = hasDiscount ? `${Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)}% off` : '';
  const productImage = product.imageUrl || asset('hero2.png');
  const hasUsableTryOn = Boolean(tryOn?.imageUrl) && !tryOnImageFailed;
  const hasTryOnVideo = Boolean(tryOn?.videoUrl) && hasUsableTryOn;
  const showingTryOn = hasUsableTryOn && detailImageView !== 'product';
  const showingTryOnVideo = showingTryOn && hasTryOnVideo;
  const image = showingTryOn ? tryOn.imageUrl : productImage;
  const swapPreview = hasUsableTryOn && product.imageUrl
    ? {
        label: showingTryOn ? 'Product photo' : 'AI Try-On',
        src: showingTryOn ? product.imageUrl : tryOn.imageUrl,
        alt: showingTryOn ? `${product.name} product photo` : `AI try-on for ${product.name}`,
        nextView: showingTryOn ? 'product' : 'tryon'
      }
    : null;
  const brand = displayBrand(product);
  const category = displayCategory(product);
  const detailFacts = [
    ['Brand', brand],
    ['Category', category],
    ['Fit area', product.garmentPlacement === 'bottom' ? 'Bottomwear' : 'Topwear'],
    ['For', product.gender],
    ['Rating', `${Number(product.rating || 0).toFixed(1)}${product.ratingCount ? ` from ${product.ratingCount} reviews` : ''}`],
    ['Price', formatMoney(product.price, product.currency)]
  ].filter(([, value]) => value);
  const productTags = (product.tags || []).filter(Boolean).slice(0, 10);
  const editorialImage = relatedProducts.find((item) => item.imageUrl)?.imageUrl || productImage;
  const galleryItems = [
    {
      key: 'product',
      label: 'Product',
      src: productImage,
      active: !showingTryOn,
      onSelect: () => setDetailImageView('product')
    },
    hasUsableTryOn && {
      key: 'tryon',
      label: hasTryOnVideo ? 'AI Video' : 'AI Try-On',
      src: tryOn.imageUrl,
      active: showingTryOn,
      onSelect: () => setDetailImageView('tryon')
    }
  ].filter(Boolean);

  const generateProductTryOn = async () => {
    if (!product || tryOnLoading) return;
    const regenerate = Boolean(tryOn?.imageUrl);
    setTryOnLoading(true);
    setTryOnError('');
    try {
      const data = await api(`/tryons/${product.id}`, {
        method: 'POST',
        body: regenerate ? JSON.stringify({ force: true }) : undefined
      });
      setTryOn(data.tryOn);
      setDetailImageView('tryon');
      setTryOnImageFailed(false);
      recordEvent('try_on', { productId: product.id, metadata: { tryOnModel: product.tryOnModel || 'default', regenerated: regenerate } });
      if (data.user) {
        setUser((current) => {
          if (!current) return data.user;
          return { ...data.user, tokens: Math.min(current.tokens, data.user.tokens) };
        });
      }
    } catch (err) {
      setTryOnError(err.message);
    } finally {
      setTryOnLoading(false);
    }
  };

  const generateProductTryOnVideo = async () => {
    if (!product || tryOnVideoLoading || tryOnLoading) return;
    const needsImageTryOn = !tryOn?.imageUrl || tryOnImageFailed;
    setTryOnVideoLoading(true);
    setTryOnVideoError('');
    if (needsImageTryOn) {
      setTryOnLoading(true);
      setTryOnError('');
    }
    try {
      let activeTryOn = tryOn;

      if (needsImageTryOn) {
        const preview = await api(`/tryons/${product.id}`, {
          method: 'POST',
          body: tryOn?.imageUrl ? JSON.stringify({ force: true }) : undefined
        });
        activeTryOn = preview.tryOn;
        setTryOn(activeTryOn);
        setDetailImageView('tryon');
        setTryOnImageFailed(false);
        recordEvent('try_on', { productId: product.id, metadata: { tryOnModel: product.tryOnModel || 'default', generatedForVideo: true } });
        if (preview.user) {
          setUser((current) => {
            if (!current) return preview.user;
            return { ...preview.user, tokens: Math.min(current.tokens, preview.user.tokens) };
          });
        }
      }

      const regenerate = Boolean(activeTryOn?.videoUrl);
      const data = await api(`/tryons/${product.id}/video`, {
        method: 'POST',
        body: regenerate ? JSON.stringify({ force: true }) : undefined
      });
      setTryOn(data.tryOn);
      setDetailImageView('tryon');
      recordEvent('try_on', { productId: product.id, metadata: { video: true, regenerated: regenerate } });
      if (data.user) {
        setUser((current) => {
          if (!current) return data.user;
          return { ...data.user, tokens: Math.min(current.tokens, data.user.tokens) };
        });
      }
    } catch (err) {
      setTryOnVideoError(err.message);
    } finally {
      if (needsImageTryOn) setTryOnLoading(false);
      setTryOnVideoLoading(false);
    }
  };

  return (
    <main className="product-page product-editorial-page">
      <section className="wrap product-editorial-detail">
        <div className="product-editorial-breadcrumb"><a href="/search">New arrivals</a><span>/</span><a href={`/search?category=${encodeURIComponent(product.category || '')}`}>{category}</a></div>
        <div className="product-editorial-grid">
          <div className="product-editorial-gallery">
            <div className={`product-detail-media product-editorial-media ${showingTryOn ? 'showing-tryon' : 'showing-product'}`}>
              {showingTryOnVideo ? (
                <video className="tryon-video-player" src={tryOn.videoUrl} poster={tryOn.imageUrl} autoPlay muted loop playsInline controls />
              ) : (
                <ZoomableImage
                  src={image}
                  alt={product.name}
                  zoom={showingTryOn ? 1 : 1.75}
                  disableZoom={showingTryOn}
                  onError={(event) => {
                    if (hasUsableTryOn) setTryOnImageFailed(true);
                    else if (event.currentTarget.src !== window.location.origin + asset('hero2.png')) event.currentTarget.src = asset('hero2.png');
                  }}
                />
              )}
              {product.badge && <span className="badge">{product.badge}</span>}
              {showingTryOn && <span className="badge tryon-badge">{showingTryOnVideo ? 'Video Try-On' : 'AI Try-On'}</span>}
              {hasUsableTryOn && !showingTryOnVideo && (
                <button
                  className="fullscreen-button"
                  type="button"
                  aria-label="Open current product image full screen"
                  title="Open full screen"
                  onClick={() => setFullscreenImage({
                    src: image,
                    alt: showingTryOn ? `AI try-on for ${product.name}` : `${product.name} product photo`,
                    title: showingTryOn ? product.name : `${product.name} product photo`
                  })}
                >
                  <FullscreenIcon />
                </button>
              )}
              {(tryOnLoading || tryOnVideoLoading) && <TryOnGenerating text={tryOnVideoLoading ? 'Generating video' : 'Generating try-on'} />}
              {swapPreview && (
                <button
                  className="original-product-preview"
                  type="button"
                  onClick={() => setDetailImageView(swapPreview.nextView)}
                  aria-label={`Show ${swapPreview.label}`}
                  title={`Show ${swapPreview.label}`}
                >
                  <span>{swapPreview.label}</span>
                  <img src={swapPreview.src} alt={swapPreview.alt} />
                </button>
              )}
            </div>
            <div className="product-editorial-thumbnails" aria-label="Product image gallery">
              {galleryItems.map((item) => (
                <button className={item.active ? 'active' : ''} type="button" key={item.key} onClick={item.onSelect} aria-label={`Show ${item.label}`} title={item.label}>
                  <img src={item.src} alt="" />
                </button>
              ))}
            </div>
          </div>
          <div className="product-editorial-summary">
            <div className="product-editorial-summary-head">
              <p className="product-editorial-kicker">{brand}</p>
              <h1>{product.name}</h1>
              <div className="product-editorial-price-row">
                <strong>{formatMoney(product.price || 0, product.currency)}</strong>
                {hasDiscount && <del>{formatMoney(product.compareAtPrice, product.currency)}</del>}
                {discount && <span>{discount}</span>}
              </div>
              <p className="product-editorial-rating"><span>Rating</span> {Number(product.rating || 0).toFixed(1)} {product.ratingCount ? `(${product.ratingCount} reviews)` : ''}</p>
            </div>

            <div className="product-editorial-options" aria-label="Product options">
              <div className="product-editorial-option-row">
                <span>Colour <b>{selectedTone === 'charcoal' ? 'Charcoal' : selectedTone === 'stone' ? 'Stone' : 'Ink'}</b></span>
                <div className="product-editorial-swatches" aria-label="Choose colour">
                  {[
                    ['charcoal', 'Charcoal'],
                    ['stone', 'Stone'],
                    ['ink', 'Ink']
                  ].map(([tone, label]) => (
                    <button key={tone} type="button" className={selectedTone === tone ? `active ${tone}` : tone} onClick={() => setSelectedTone(tone)} aria-label={`Choose ${label}`} title={label} />
                  ))}
                </div>
              </div>
              <div className="product-editorial-option-row product-editorial-size-row">
                <span>Size <b>{selectedSize}</b></span>
                <div className="product-editorial-size-options" aria-label="Choose size">
                  {['XS', 'S', 'M', 'L', 'XL'].map((size) => <button className={selectedSize === size ? 'active' : ''} type="button" key={size} onClick={() => setSelectedSize(size)}>{size}</button>)}
                </div>
              </div>
            </div>

            <div className="product-editorial-ship"><span>Shipping</span><strong>Live catalog item</strong><small>Selected size: {selectedSize}</small></div>
            <div className="product-editorial-actions">
              {product.affiliateLink && <a className="product-editorial-shop" href={product.affiliateLink} target="_blank" rel="noreferrer" onClick={() => recordEvent('shop_click', { productId: product.id })}>Shop brand</a>}
              {user ? (
                <button className="product-editorial-tryon" type="button" onClick={generateProductTryOn} disabled={tryOnLoading}>
                  {tryOnLoading ? 'Generating...' : hasUsableTryOn ? 'Refresh try-on' : tryOnImageFailed ? 'Try again' : 'AI try-on'}
                </button>
              ) : <a className="product-editorial-tryon" href="/signup">AI try-on</a>}
              {user ? (
                <button className="product-editorial-video" type="button" onClick={generateProductTryOnVideo} disabled={tryOnLoading || tryOnVideoLoading} title="Generate an AI try-on video">
                  {tryOnLoading ? 'Creating try-on...' : tryOnVideoLoading ? 'Making video...' : hasTryOnVideo ? 'Refresh video' : 'Generate video'}
                </button>
              ) : <a className="product-editorial-video" href="/signup">Generate video</a>}
            </div>
            <div className="product-editorial-benefits">
              <div><strong>AI fit preview</strong><span>Built from your FitLook profile</span></div>
              <div><strong>Verified catalog</strong><span>Live brand and price details</span></div>
            </div>
            {tryOnError && <p className="form-message error-message">{tryOnError}</p>}
            {tryOnVideoError && <p className="form-message error-message">{tryOnVideoError}</p>}

            <div className="product-editorial-accordions">
              <details open>
                <summary>Product details</summary>
                <p>{product.description || 'This product is available through the live FitLook catalog.'}</p>
                <dl>{detailFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              </details>
              <details>
                <summary>Fit and style</summary>
                <p>{product.garmentPlacement === 'bottom' ? 'Designed for bottomwear styling.' : 'Designed to pair seamlessly with your wardrobe.'}{product.gender ? ` Suitable for ${product.gender}.` : ''}</p>
                {productTags.length > 0 && <p className="product-editorial-tags">{productTags.map((tag) => <a href={`/search?tag=${encodeURIComponent(tag)}`} key={tag}>{tag}</a>)}</p>}
              </details>
              <details>
                <summary>Delivery and returns</summary>
                <p>Checkout, delivery, and return terms are managed by the linked brand store.</p>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap product-editorial-story">
        <div>
          <p className="product-editorial-story-kicker">Considered by design</p>
          <h2>The details of<br /><em>modernity.</em></h2>
          <p>{product.description || `${brand} brings a considered point of view to ${category.toLowerCase()}. Explore the product, preview it with your personal fit profile, and follow through to the live brand store when it feels right.`}</p>
        </div>
        <img src={editorialImage} alt={`${brand} ${category}`} />
      </section>

      {relatedProducts.length > 0 && (
        <section className="wrap product-editorial-related">
          <div className="product-editorial-related-head"><div><p>Curated for you</p><h2>Complete the look</h2></div><a href={`/search?category=${encodeURIComponent(product.category || '')}`}>View all in {category}</a></div>
          <div className="product-editorial-related-grid">{relatedProducts.map((item) => <EditorialRelatedProduct key={item.id} product={item} />)}</div>
        </section>
      )}
      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
    </main>
  );
}

function EditorialRelatedProduct({ product }) {
  const category = displayCategory(product);
  const brand = displayBrand(product);
  return (
    <article className="product-editorial-related-card">
      <a href={`/product/${encodeURIComponent(product.id)}`}>
        <img src={product.imageUrl || asset('hero2.png')} alt={product.name} />
        <p>{brand}</p>
        <h3>{product.name}</h3>
        <strong>{formatMoney(product.price || 0, product.currency)}</strong>
        <span>{category}</span>
      </a>
      <WishlistHeartButton product={product} className="card-wishlist-heart" />
    </article>
  );
}

function StatusPanel({ text, onRetry }) {
  return <div className="status-panel" role="status" aria-live="polite"><p>{text}</p>{onRetry && <button type="button" onClick={onRetry}>Try again</button>}</div>;
}

function Toast({ toast, onDismiss }) {
  const isError = toast.tone === 'error';
  return (
    <div className={`app-toast ${isError ? 'error' : ''}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>
      <span>{toast.message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" title="Dismiss notification"><CloseIcon /></button>
    </div>
  );
}

function EmptyProducts({ search }) {
  return (
    <div className="empty-products">
      <h3>No real products yet.</h3>
      <p>{search ? `Nothing matched "${search}". Try a different search or browse the latest products.` : 'Products will appear here as soon as the catalog is available.'}</p>
      <a className="button" href="/search">Browse Products</a>
    </div>
  );
}

function HowItWorks({ user }) {
  const steps = [
    {
      title: 'Set your fit profile',
      copy: user ? 'Your profile photo is ready, so product try-ons can use the same body reference across the site.' : 'Create an account once with a clear full-body photo so future try-ons have a consistent reference.',
      meta: user ? 'Profile ready' : 'One-time setup'
    },
    {
      title: 'Find a product',
      copy: 'Browse the catalog, search directly, or ask Style Bot for a specific look, budget, occasion, or category.',
      meta: 'Search or Style Bot'
    },
    {
      title: 'Generate the preview',
      copy: 'Use one token to create a try-on image. If that same product was already generated for you, FitLook reuses the saved result.',
      meta: '1 token when new'
    },
    {
      title: 'Compare and shop',
      copy: 'Open the generated image full screen, compare it with the product photo, then continue to the brand store when ready.',
      meta: 'Review, then buy'
    }
  ];
  const signals = [
    ['Product pages', 'See product info, saved try-ons, and similar recommendations in one place.'],
    ['Custom try-on', 'Upload your own clothing reference and choose the right generation mode.'],
    ['Recommendations', 'Searches, clicks, try-ons, and shop clicks quietly tune your product suggestions.']
  ];

  return (
    <main className="how-page">
      <section className="wrap how-hero">
        <div>
          <p className="kicker">How FitLook Works</p>
          <h1>Four simple steps.</h1>
          <p className="lead">From profile photo to product preview, the whole flow is built around making online shopping feel less like guessing.</p>
          <a className="button" href={user ? '/search' : '/signup'}>{user ? 'Start Shopping' : 'Create Profile'}</a>
        </div>
        <div className="how-hero-visual" aria-hidden="true">
          <img src={asset('search-locked-preview.jpg')} alt="" />
          <div>
            <strong>{user ? 'Ready to try on' : 'Profile starts here'}</strong>
            <span>{user ? 'Browse, generate, compare.' : 'Upload once, preview often.'}</span>
          </div>
        </div>
      </section>

      <section className="wrap how-steps" aria-label="FitLook steps">
        {steps.map((step, index) => (
          <article className="how-step" key={step.title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <small>{step.meta}</small>
            <h2>{step.title}</h2>
            <p>{step.copy}</p>
          </article>
        ))}
      </section>

      <section className="wrap how-support">
        {signals.map(([title, copy]) => (
          <article key={title}>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

function InfoPage({ meta, children, user, ctaLabel, ctaHref }) {
  const [kicker, title, lead, image] = meta;
  const actionLabel = ctaLabel || (user ? 'Browse Products' : 'Create Profile');
  const actionHref = ctaHref || (user ? '/search' : '/signup');

  return (
    <>
      <section className="page-hero"><div className="wrap hero-grid"><div className="page-copy"><p className="kicker">{kicker}</p><h1>{title}</h1><p className="lead">{lead}</p><a className="button" href={actionHref}>{actionLabel}</a></div><div className="page-image"><OptimizedImage src={asset(image)} alt="" /></div></div></section>
      {children || <section className="section"><div className="wrap info-grid"><article className="info-card"><h3>AI try-on ready</h3><p>Preview selected products on your profile.</p></article><article className="info-card"><h3>Catalog shopping</h3><p>Explore styles, categories, and new arrivals.</p></article><article className="info-card"><h3>Token powered</h3><p>Use tokens only when generating previews.</p></article><article className="info-card"><h3>Privacy aware</h3><p>Your full-body photo is part of your personal profile.</p></article></div></section>}
    </>
  );
}

function AuthInputField({ label, className = '', icon = null, type = 'text', ...inputProps }) {
  const inputId = inputProps.id || `auth-${inputProps.name}`;
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className={`auth-input-field ${className}`.trim()}>
      <label htmlFor={inputId}>{label}</label>
      <div className="auth-input-shell">
        {icon && <span className="auth-input-icon" aria-hidden="true">{icon}</span>}
        <input id={inputId} type={isPassword && showPassword ? 'text' : type} {...inputProps} />
        {isPassword && (
          <button
            className="auth-password-toggle"
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            <EyeIcon crossed={showPassword} />
          </button>
        )}
      </div>
    </div>
  );
}

function AuthSubmitButton({ children, loading = false }) {
  return (
    <button className="auth-submit-button" type="submit" disabled={loading} aria-busy={loading}>
      <span>{children}</span>
      <span aria-hidden="true">&rarr;</span>
    </button>
  );
}

function OnboardingOverview({ user, onComplete, onClose, persist = true }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const nextButtonRef = useRef(null);

  const steps = useMemo(() => [
    {
      eyebrow: 'Welcome',
      title: `Welcome to FitLook${user?.name ? `, ${user.name.split(/\s+/)[0]}` : ''}`,
      body: 'FitLook exists to make online fashion feel personal before you buy. Build a try-on profile, explore curated pieces, and see how styles work with your wardrobe.',
      gain: 'You get a faster way to choose pieces with more confidence.',
      icon: <SparkleLineIcon />,
      visual: 'Profile - Browse - Try on'
    },
    {
      eyebrow: 'Explore',
      title: 'Shop the catalog',
      body: 'Use Home, Categories, and Search to browse new arrivals, sale edits, and product collections. Filters help you narrow by category, brand, gender, and price.',
      gain: 'Find relevant pieces without digging through the whole store.',
      icon: <SearchIcon />,
      visual: 'Search + filters'
    },
    {
      eyebrow: 'Preview',
      title: 'AI Try-On',
      body: 'Open supported products and generate a preview using your saved try-on portrait. You can switch between the product photo and your AI preview on the product page.',
      gain: 'See the fit and vibe on your profile before spending time or credits on more looks.',
      icon: <TryOnIcon />,
      visual: 'Product - AI preview'
    },
    {
      eyebrow: 'Wardrobe',
      title: 'Build your Smart Closet',
      body: 'Upload clothing you already own, save closet items, and combine them into outfits. The wardrobe workspace helps you plan looks around your own pieces.',
      gain: 'Turn browsing into outfit planning instead of one-item decisions.',
      icon: <ClosetIcon />,
      visual: 'Upload - Combine - Save'
    },
    {
      eyebrow: 'Personalize',
      title: 'Use Wishlist, Credits, and Concierge',
      body: 'Save products to Wishlist, manage try-on credits from the Credits page, and ask FitLook Concierge for style ideas when you want help choosing.',
      gain: 'Keep favorites, budget previews, and get guidance without losing your place.',
      icon: <HeartIcon />,
      visual: 'Save - Credit - Ask'
    },
    {
      eyebrow: 'Workflow',
      title: 'A simple way to use FitLook',
      body: 'Start with search or a category, open a product, generate a try-on when it matters, then save favorites or build outfits in your closet.',
      gain: 'Use credits only where they help you decide.',
      icon: <BagIcon />,
      visual: 'Browse - Try - Decide'
    },
    {
      eyebrow: 'Ready',
      title: 'You are all set',
      body: 'Your profile is ready for a more visual shopping flow. Jump in, explore styles, and come back to your Profile page anytime to replay this tour.',
      gain: 'Let us get your first look moving.',
      icon: <GlobeIcon />,
      visual: 'Enter FitLook'
    }
  ], [user?.name]);

  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  const markComplete = async (reason) => {
    if (saving) return;
    setError('');
    if (!persist) {
      onClose?.();
      return;
    }

    setSaving(true);
    try {
      const data = await api('/auth/onboarding', {
        method: 'PATCH',
        body: JSON.stringify({ reason })
      });
      if (data.user) onComplete?.(data.user);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not save onboarding status. Try again.');
      setSaving(false);
    }
  };

  const focusableElements = () => Array.from(dialogRef.current?.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ) || []).filter((element) => element.offsetParent !== null || element === document.activeElement);

  const onDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      markComplete('escape');
      return;
    }
    if (event.key !== 'Tab') return;

    const items = focusableElements();
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => nextButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    nextButtonRef.current?.focus();
  }, [stepIndex]);

  return (
    <div
      className="onboarding-overview"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) markComplete('outside-click');
      }}
    >
      <section
        ref={dialogRef}
        className="onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-copy"
        onKeyDown={onDialogKeyDown}
      >
        <header className="onboarding-topbar">
          <div>
            <p>{step.eyebrow}</p>
            <span>{stepIndex + 1} of {steps.length}</span>
          </div>
          <button type="button" onClick={() => markComplete('skip')} disabled={saving}>
            {saving ? 'Saving...' : 'Skip'}
          </button>
        </header>

        <div className="onboarding-progress" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
          {steps.map((item, index) => (
            <span className={index === stepIndex ? 'active' : ''} key={item.title} />
          ))}
        </div>

        <div className="onboarding-content">
          <div className="onboarding-visual" aria-hidden="true">
            <span>{step.icon}</span>
            <strong>{step.visual}</strong>
          </div>
          <div className="onboarding-copy">
            <h2 id="onboarding-title">{step.title}</h2>
            <p id="onboarding-copy">{step.body}</p>
            <small>{step.gain}</small>
          </div>
        </div>

        {error && <p className="onboarding-error" role="alert">{error}</p>}

        <footer className="onboarding-actions">
          <button type="button" onClick={() => setStepIndex((current) => Math.max(0, current - 1))} disabled={stepIndex === 0 || saving}>
            Back
          </button>
          <button
            ref={nextButtonRef}
            type="button"
            onClick={() => isLastStep ? markComplete('finish') : setStepIndex((current) => Math.min(steps.length - 1, current + 1))}
            disabled={saving}
          >
            {saving ? 'Saving...' : isLastStep ? 'Get Started' : 'Next'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AuthPage({ mode, setUser }) {
  const bodyPhotoCameraRef = useRef(null);
  const [message, setMessage] = useState('');
  const [nameValue, setNameValue] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameSuggestions, setUsernameSuggestions] = useState([]);
  const [bodyPhotoFile, setBodyPhotoFile] = useState(null);
  const [bodyPhotoPreview, setBodyPhotoPreview] = useState('');
  const [profilePhotoMode, setProfilePhotoMode] = useState('ai-full-body');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const isSignup = mode === 'signup';

  useEffect(() => {
    if (!isSignup) return;
    const cleanName = nameValue.trim();
    if (!cleanName) {
      setUsernameSuggestions([]);
      if (!usernameTouched) setUsername('');
      return;
    }

    let alive = true;
    const timer = setTimeout(() => {
      api(`/auth/username-suggestions?name=${encodeURIComponent(cleanName)}`)
        .then((data) => {
          if (!alive) return;
          const suggestions = data.suggestions || [];
          setUsernameSuggestions(suggestions);
          if (!usernameTouched && suggestions[0]) setUsername(suggestions[0]);
        })
        .catch(() => {
          if (alive) setUsernameSuggestions([]);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [isSignup, nameValue, usernameTouched]);

  useEffect(() => () => {
    if (bodyPhotoPreview) URL.revokeObjectURL(bodyPhotoPreview);
  }, [bodyPhotoPreview]);

  const previewBodyPhoto = (event) => {
    const file = event.currentTarget.files?.[0];
    setBodyPhotoFile(file || null);
    setMessage(file && file.size > MAX_BODY_PHOTO_BYTES ? ((isHeicFile(file) || isAvifFile(file)) ? 'Large AVIF/HEIC/HEIF photo selected. Please choose one under 8 MB.' : 'Large profile photo selected. It will be optimized before upload.') : '');
    setBodyPhotoPreview(file ? URL.createObjectURL(file) : '');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setMessage(isSignup ? 'Creating account...' : 'Working...');
    try {
      const form = event.currentTarget;
      const body = isSignup ? new FormData(form) : JSON.stringify(Object.fromEntries(new FormData(form)));
      if (isSignup) {
        const bodyPhoto = bodyPhotoFile || form.elements.bodyPhoto?.files?.[0] || bodyPhotoCameraRef.current?.files?.[0];
        if (!bodyPhoto) throw new Error('Choose or take a profile photo first.');
        body.set('bodyPhoto', await prepareBodyPhoto(bodyPhoto));
      }
      const data = await api(isSignup ? '/auth/signup' : '/auth/login', { method: 'POST', body });
      const destination = authReturnPath();
      localStorage.setItem('fitlook_token', data.token);
      setUser(data.user);
      window.history.pushState({}, '', destination);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isSignup) {
    return (
      <main className="auth-login-page auth-login-reference-page" aria-labelledby="login-title">
        <section className="auth-login-story auth-login-reference-story" aria-label="FitLook fashion experience">
          <OptimizedImage className="auth-login-background" src={asset('login-editorial-couple.png')} alt="" eager />
          <div className="auth-login-scrim" aria-hidden="true" />
          <a className="auth-login-logo" href="/">FitLook</a>
          <div className="auth-login-story-copy">
            <h2>AI Fashion Try-On Experience</h2>
            <p>See it on you before you buy it. Experience a more personal way to shop.</p>
            <ul className="auth-login-benefits" aria-label="FitLook benefits">
              {[
                ['AI Try-On', 'See selected styles on your profile.'],
                ['Smart Closet', 'Keep your wardrobe in one place.'],
                ['AI Stylist', 'Find looks that fit your point of view.']
              ].map(([title, copy]) => (
                <li key={title}>
                  <strong>{title}</strong>
                  <small>{copy}</small>
                </li>
              ))}
            </ul>
          </div>
          <p className="auth-login-copyright">FitLook, curated with intelligence.</p>
        </section>

        <section className="auth-login-panel auth-login-reference-panel">
          <p className="auth-login-switch-top">New to FitLook? <a href="/signup">Sign up</a></p>
          <div className="auth-login-card">
            <h1 id="login-title">Welcome Back</h1>
            <p className="auth-login-copy">Login to continue your fashion journey.</p>
            <div className="auth-login-tabs" aria-hidden="true"><span>Email</span></div>
            <form className="auth-login-form" onSubmit={submit} aria-busy={isSubmitting}>
              <AuthInputField label="Email or username" icon={<MailIcon />} name="email" type="text" required autoFocus autoComplete="username" placeholder="Enter your email or User name" />
              <AuthInputField label="Password" icon={<LockIcon />} name="password" type="password" required minLength="6" autoComplete="current-password" placeholder="Enter your password" onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock'))} onBlur={() => setCapsLock(false)} />
              <div className="auth-login-options">
                <label>
                  <input type="checkbox" />
                  <span>Remember me</span>
                </label>
                <a href="/support">Forgot password?</a>
              </div>
              {capsLock && <p className="auth-caps-lock" role="status">Caps Lock is on</p>}
              <AuthSubmitButton loading={isSubmitting}>{isSubmitting ? 'Logging in...' : 'Login'}</AuthSubmitButton>
            </form>
            {message && <p className={`auth-login-message form-message ${message === 'Working...' ? '' : 'error-message'}`}>{message}</p>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-signup-page auth-signup-reference-page" aria-labelledby="signup-title">
      <section className="auth-signup-reference-shell">
        <form className="auth-signup-form auth-signup-reference-form" onSubmit={submit} aria-busy={isSubmitting}>
          <a className="auth-signup-reference-logo" href="/">FitLook</a>
          <header className="auth-signup-reference-head">
            <h1 id="signup-title">Create Your<br />Account</h1>
            <p>Join a world of curated style made just for you.</p>
          </header>

          <div className="auth-signup-reference-fields">
            <label className="signup-field">
              <span>Full name</span>
              <input name="name" required autoFocus value={nameValue} autoComplete="name" placeholder="Enter your name" onChange={(event) => { setNameValue(event.target.value); setUsernameTouched(false); }} />
            </label>
            <label className="signup-field">
              <span>Username</span>
              <input name="username" required minLength="3" value={username} autoComplete="username" placeholder="Choose a username" onChange={(event) => { setUsernameTouched(true); setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); }} />
            </label>
            <label className="signup-field">
              <span>Email address</span>
              <input name="email" type="email" required autoComplete="email" placeholder="Enter your email" />
            </label>
            <label className="signup-field">
              <span>Create password</span>
              <input name="password" type="password" required minLength="6" autoComplete="new-password" placeholder="At least 6 characters" onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock'))} onBlur={() => setCapsLock(false)} />
            </label>
          </div>

          {usernameSuggestions.length > 0 && (
            <div className="signup-suggestions" aria-label="Username suggestions">
              {usernameSuggestions.slice(0, 3).map((item) => <button type="button" key={item} onClick={() => { setUsernameTouched(true); setUsername(item); }}>{item}</button>)}
            </div>
          )}

          <fieldset className="signup-gender-group">
            <legend>Style preference</legend>
            {[
              ['female', 'Women'],
              ['male', 'Men'],
              ['other', 'All styles']
            ].map(([value, label], index) => (
              <label key={value}>
                <input type="radio" name="genderPreference" value={value} required={index === 0} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <div className="signup-reference-photo-row">
            <label className={`signup-reference-photo-choice signup-upload-box ${bodyPhotoPreview ? 'has-preview' : ''}`}>
              <input name="bodyPhoto" type="file" accept={BODY_PHOTO_ACCEPT} onChange={previewBodyPhoto} />
              {bodyPhotoPreview ? <img className="upload-preview" src={bodyPhotoPreview} alt="Uploaded model profile preview" /> : <><strong>Upload a photo</strong><small>Clear selfie or full-body image</small></>}
            </label>
            <button className="signup-reference-photo-choice signup-camera-button" type="button" onClick={() => bodyPhotoCameraRef.current?.click()}><strong>Take a photo</strong><small>Use your camera</small></button>
            <input ref={bodyPhotoCameraRef} className="camera-input" type="file" accept={BODY_PHOTO_ACCEPT} capture="user" onChange={previewBodyPhoto} />
            <input type="hidden" name="profilePhotoMode" value={profilePhotoMode} />
          </div>

          {bodyPhotoPreview && (
            <div className="signup-reference-profile-mode" role="radiogroup" aria-label="Choose how to use your uploaded photo">
              <button type="button" className={profilePhotoMode === 'exact' ? 'active' : ''} onClick={() => setProfilePhotoMode('exact')} aria-pressed={profilePhotoMode === 'exact'}>Use this exact photo</button>
              <button type="button" className={profilePhotoMode === 'ai-full-body' ? 'active' : ''} onClick={() => setProfilePhotoMode('ai-full-body')} aria-pressed={profilePhotoMode === 'ai-full-body'}>AI full body profile</button>
            </div>
          )}

          <label className="signup-terms">
            <input name="terms" type="checkbox" required />
            <span>I agree to FitLook creating an AI try-on profile from my uploaded photo.</span>
          </label>
          {capsLock && <p className="auth-caps-lock" role="status">Caps Lock is on</p>}
          <button className="signup-submit-button" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? 'Creating account...' : 'Sign up'}</button>
          {message && <p className={`signup-message form-message ${message === 'Creating account...' ? '' : 'error-message'}`}>{message}</p>}
          <p className="signup-switch">Already have an account? <a href="/login">Log in</a></p>
        </form>

        <aside className="auth-signup-reference-scene" aria-label="FitLook wardrobe preview">
          <img src={asset('wardrobe-room.jpg')} alt="Warm modern wardrobe interior" />
          <a href="/" className="auth-signup-reference-explore">Explore</a>
          <div className="auth-signup-scene-notes" aria-hidden="true">
            <div><img src={asset('arrival-3.jpg')} alt="" /><span><strong>Personalized for you</strong><small>Curated pieces for your style</small></span></div>
            <div><img src={asset('arrival-5.jpg')} alt="" /><span><strong>AI style edit</strong><small>Looks built around you</small></span></div>
            <div><span><strong>Your profile, your closet</strong><small>Try on more before you buy</small></span></div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function FeatureBand() {
  const items = [
    ['Trending Now', 'Hot right now', <SparkleLineIcon />],
    ['Best Sellers', 'Top picks', <HeartIcon />],
    ['New Arrivals', 'New styles added', <BagIcon />],
    ['Fast Delivery', 'Across the world', <GlobeIcon />]
  ];

  return (
    <section className="feature-band">
      <div className="wrap features">
        {items.map(([title, copy, icon]) => (
          <div className="feature" key={title}>
            <div className="feature-icon" aria-hidden="true">{icon}</div>
            <div><p className="feature-title">{title}</p><p className="feature-copy">{copy}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function App() {
  const [path, setPath] = useState(normalizePath());
  const [routeKey, setRouteKey] = useState(() => `${window.location.pathname}${window.location.search}${window.location.hash}`);
  const [user, setUser] = useState(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [toast, setToast] = useState(null);
  const [replayTourOpen, setReplayTourOpen] = useState(false);
  const scrollPositions = useRef(new Map());
  const toastTimer = useRef(null);

  const syncRoute = () => {
    setPath(normalizePath());
    setRouteKey(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  };

  const navigateTo = (next) => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;
    scrollPositions.current.set(current, window.scrollY);
    window.history.pushState({}, '', next);
    syncRoute();
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  };

  useEffect(() => {
    const onPop = () => {
      syncRoute();
      const key = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current.get(key) || 0, left: 0, behavior: 'auto' }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const updateNetworkState = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);
    return () => {
      window.removeEventListener('online', updateNetworkState);
      window.removeEventListener('offline', updateNetworkState);
    };
  }, []);

  useEffect(() => {
    const showToast = (event) => {
      const detail = event.detail || {};
      const message = String(detail.message || '').trim();
      if (!message) return;
      window.clearTimeout(toastTimer.current);
      setToast({ id: Date.now(), message, tone: detail.tone === 'error' ? 'error' : 'success' });
      toastTimer.current = window.setTimeout(() => setToast(null), 4000);
    };
    window.addEventListener('fitlook:toast', showToast);
    return () => {
      window.removeEventListener('fitlook:toast', showToast);
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const replayOnboarding = () => {
      if (user) setReplayTourOpen(true);
    };
    window.addEventListener('fitlook:replay-onboarding', replayOnboarding);
    return () => window.removeEventListener('fitlook:replay-onboarding', replayOnboarding);
  }, [user]);

  const dismissToast = () => {
    window.clearTimeout(toastTimer.current);
    setToast(null);
  };

  useEffect(() => {
    const navigateInternally = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin) return;
      const next = `${target.pathname}${target.search}${target.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next === current) return;
      if (target.pathname === window.location.pathname && target.search === window.location.search && target.hash) return;
      event.preventDefault();
      navigateTo(next);
    };
    document.addEventListener('click', navigateInternally);
    return () => document.removeEventListener('click', navigateInternally);
  }, []);

  useEffect(() => {
    const submitInternally = (event) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      if (String(form.method || 'get').toLowerCase() !== 'get' || form.querySelector('input[type="file"]')) return;
      const target = new URL(form.action || window.location.href, window.location.href);
      if (target.origin !== window.location.origin) return;

      const search = new URLSearchParams(target.search);
      new FormData(form).forEach((value, key) => {
        if (typeof value !== 'string') return;
        if (value.trim()) search.set(key, value);
        else search.delete(key);
      });
      target.search = search.toString();
      const next = `${target.pathname}${target.search}${target.hash}`;
      event.preventDefault();
      navigateTo(next);
    };
    document.addEventListener('submit', submitInternally);
    return () => document.removeEventListener('submit', submitInternally);
  }, []);

  useEffect(() => {
    const rememberAuthOrigin = (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin) return;
      const targetPath = target.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
      if (targetPath !== '/login' && targetPath !== '/signup') return;

      const existingReturnTo = safeAuthReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const origin = existingReturnTo || safeAuthReturnPath(current);
      if (!origin) return;

      target.searchParams.set('returnTo', origin);
      link.href = `${target.pathname}${target.search}${target.hash}`;
    };
    document.addEventListener('click', rememberAuthOrigin, true);
    return () => document.removeEventListener('click', rememberAuthOrigin, true);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('fitlook_token')) return;
    api('/auth/me').then((data) => setUser(data.user)).catch(() => localStorage.removeItem('fitlook_token'));
  }, []);

  useEffect(() => {
    if (!user || (path !== '/signup' && path !== '/login')) return;
    const destination = authReturnPath();
    window.history.replaceState({}, '', destination);
    setPath(normalizePath());
  }, [path, routeKey, user]);

  const page = useMemo(() => {
    const productMatch = path.match(/^\/product\/([^/]+)$/);
    const categoryMatch = path.match(/^\/categories\/([^/]+)$/);
    const legacyCategory = new URLSearchParams(window.location.search).get('category');
    const hasSearchParameters = window.location.search.length > 1;
    if (path === '/') return <Home user={user} />;
    if (path === '/home') return <AtelierHome />;
    if (path === '/search' && legacyCategory) return <CategoryDepartmentPage category={legacyCategory} user={user} />;
    if (path === '/categories') return <CategoriesPage user={user} />;
    if (categoryMatch) return <CategoryDepartmentPage category={decodeURIComponent(categoryMatch[1])} user={user} />;
    if (path === '/search' && !hasSearchParameters) return <CategoriesPage user={user} />;
    if (path === '/search') return <SearchPage user={user} setUser={setUser} />;
    if (path === '/try-on') return <CustomTryOnPage user={user} setUser={setUser} />;
    if (path === '/closet') return <ClosetPage user={user} setUser={setUser} />;
    if (path === '/closet/add') return <ClosetAddPage user={user} setUser={setUser} />;
    if (path === '/closet/combo') return <ClosetComboPage user={user} setUser={setUser} />;
    if (path === '/closet/items') return <ClosetItemsPage user={user} setUser={setUser} />;
    if (path === '/wishlist') return <WishlistPage user={user} />;
    if (path === '/custom-try-on') return <CustomTryOnPage user={user} setUser={setUser} />;
    if (path === '/style-bot') return <StyleBotPage user={user} setUser={setUser} />;
    if (path === '/tokens') return <TokenPage user={user} setUser={setUser} />;
    if (path === '/profile') return <ProfilePage user={user} setUser={setUser} />;
    if (productMatch) return <ProductPage id={decodeURIComponent(productMatch[1])} user={user} setUser={setUser} />;
    if ((path === '/signup' || path === '/login') && user) return <SearchPage user={user} setUser={setUser} />;
    if (path === '/signup') return <AuthPage mode="signup" setUser={setUser} />;
    if (path === '/login') return <AuthPage mode="login" setUser={setUser} />;
    if (path === '/how-it-works') return <HowItWorks user={user} />;
    if (pageMeta[path]) return <InfoPage meta={pageMeta[path]} user={user} />;
    return <InfoPage meta={['Not Found', 'This page is not available yet.', 'Use the navigation to continue shopping with FitLook.', 'hero2.png']} user={user} ctaLabel="Back to Shop" ctaHref="/search" />;
  }, [path, routeKey, user]);

  useEffect(() => {
    const revealSelectors = [
      '.atelier-category-section',
      '.atelier-promos',
      '.atelier-arrivals',
      '.atelier-lookbook',
      '.atelier-newsletter',
      '.atelier-quick-links',
      '.atelier-category-title-section',
      '.atelier-category-hero-section',
      '.atelier-category-quick-section',
      '.atelier-category-audience-section',
      '.atelier-category-filter-section',
      '.atelier-category-products-section',
      '.department-catalog',
      '.results-shell',
      '.product-editorial-detail',
      '.product-editorial-story',
      '.product-editorial-related',
      '.custom-tryon-page .custom-tryon-hero',
      '.custom-tryon-page .custom-tryon-panel',
      '.atelier-closet-add-hero',
      '.atelier-closet-add-form',
      '.wishlist-reference-empty',
      '.wishlist-reference-section',
      '.profile-reference-panel',
      '.credit-purchase-layout',
      '.feature-band'
    ].join(',');
    const sections = Array.from(document.querySelectorAll(revealSelectors));
    if (!sections.length) return undefined;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    sections.forEach((section, index) => {
      section.classList.add('fitlook-motion-section');
      section.style.setProperty('--motion-delay', `${Math.min((index % 4) * 45, 135)}ms`);
      if (prefersReducedMotion) section.classList.add('is-visible');
    });
    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      sections.forEach((section) => section.classList.add('is-visible'));
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [routeKey]);

  const isStandaloneAuth = (path === '/login' || path === '/signup') && !user;
  const isConciergePage = path === '/style-bot' && Boolean(user);
  const isProductPage = /^\/product\/[^/]+$/.test(path);
  const isOpeningPage = path === '/';
  const isReferencePage = isOpeningPage || path === '/categories' || path === '/wishlist' || path === '/tokens' || path === '/profile' || isProductPage || isConciergePage;
  const isWardrobeWorkspace = path === '/closet' || path === '/closet/add';
  const shouldShowOnboarding = Boolean(user && !user.hasCompletedOnboarding && !isStandaloneAuth);

  return (
    <>
      {!isStandaloneAuth && !isOpeningPage && !isConciergePage && <Header user={user} setUser={setUser} />}
      {!isStandaloneAuth && !isOpeningPage && <a className="skip-link" href="#main-content">Skip to main content</a>}
      <div id="main-content" className="app-page-transition" tabIndex="-1" key={routeKey}>{page}</div>
      {!isOnline && <div className="network-status" role="status" aria-live="polite">You are offline. Changes will resume when you reconnect.</div>}
      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
      {!isStandaloneAuth && !isReferencePage && (
        <div className="floating-actions" aria-label="Quick actions">
          <a className="floating-action closet" href="/closet"><span>CL</span><div><small>Your wardrobe</small><strong>AI Closet</strong></div></a>
          <a className="floating-action custom" href="/custom-try-on"><span>AI</span><div><small>Upload clothing</small><strong>Custom Try-On</strong></div></a>
        </div>
      )}
      {!isStandaloneAuth && !isOpeningPage && !isConciergePage && !isWardrobeWorkspace && <FloatingStylistLauncher user={user} />}
      {!isStandaloneAuth && !isOpeningPage && !isConciergePage && <Footer compact={path === '/wishlist' || path === '/profile' || isProductPage} />}
      {shouldShowOnboarding && <OnboardingOverview user={user} onComplete={setUser} />}
      {replayTourOpen && user && <OnboardingOverview user={user} persist={false} onClose={() => setReplayTourOpen(false)} />}
    </>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

function MailIcon() {
  return <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 15v2" /></svg>;
}

function EyeIcon({ crossed = false }) {
  return <svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="3" />{crossed && <path d="m4 4 16 16" />}</svg>;
}

function TryOnIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 4 5 8v8l7 4 7-4V8l-7-4Z" /><path d="M9 13a3 3 0 0 0 6 0" /><path d="M9 9h.01" /><path d="M15 9h.01" /></svg>;
}

function ClosetIcon() {
  return <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="1.5" /><path d="M12 4v16" /><path d="M9 12h.01" /><path d="M15 12h.01" /></svg>;
}

function SparkleLineIcon() {
  return <svg viewBox="0 0 24 24"><path d="m12 3 1.4 4.1L18 8.5l-4.6 1.4L12 14l-1.4-4.1L6 8.5l4.6-1.4L12 3Z" /><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" /><path d="m5 15 .6 1.6L7 17l-1.4.4L5 19l-.6-1.6L3 17l1.4-.4L5 15Z" /></svg>;
}

function UploadCloudIcon() {
  return <svg viewBox="0 0 24 24"><path d="M16 16l-4-4-4 4" /><path d="M12 12v9" /><path d="M20.4 18.1A5 5 0 0 0 18 8.7h-1.3A7 7 0 1 0 5 15.1" /><path d="M5 15.1A4 4 0 0 0 6.5 23H18" /></svg>;
}

function CameraIcon() {
  return <svg viewBox="0 0 24 24"><path d="M4 7h4l1.5-2h5L16 7h4v12H4V7Z" /><circle cx="12" cy="13" r="3.5" /></svg>;
}

function UserIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>;
}

function HeartIcon() {
  return <svg viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /></svg>;
}

function GridIcon() {
  return <svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx=".5" /><rect x="14" y="4" width="6" height="6" rx=".5" /><rect x="4" y="14" width="6" height="6" rx=".5" /><rect x="14" y="14" width="6" height="6" rx=".5" /></svg>;
}

function ListIcon() {
  return <svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></svg>;
}

function BagIcon() {
  return <svg viewBox="0 0 24 24"><path d="M6 7h12l1 14H5L6 7Z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>;
}

function TagIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20 13 13 20a2 2 0 0 1-2.8 0L4 13.8V4h9.8L20 10.2a2 2 0 0 1 0 2.8Z" /><path d="M8 8h.01" /></svg>;
}

function GlobeIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></svg>;
}

function FullscreenIcon() {
  return <svg viewBox="0 0 24 24"><path d="M8 3H3v5" /><path d="M16 3h5v5" /><path d="M21 16v5h-5" /><path d="M8 21H3v-5" /></svg>;
}

function MenuIcon() {
  return <svg viewBox="0 0 24 24"><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
}

export default App;
