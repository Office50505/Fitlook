import { useEffect, useMemo, useRef, useState } from 'react';

const asset = (name) => `/assets/${name}`;
const MAX_BODY_PHOTO_BYTES = 8 * 1024 * 1024;
const TARGET_BODY_PHOTO_BYTES = 6.5 * 1024 * 1024;

function formatFileSize(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
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
      reject(new Error('Please upload a JPG or PNG profile photo.'));
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

function ZoomableImage({ src, alt, className = '', imageClassName = '', zoom = 1.65, onError }) {
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
    moveOrigin(event);
    setZooming(true);
    if (event.pointerType !== 'mouse') event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const stopZoom = (event) => {
    setZooming(false);
    if (event.pointerType !== 'mouse') event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      ref={frameRef}
      className={`zoomable-image ${zooming ? 'is-zoomed' : ''} ${className}`.trim()}
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
      <img className={imageClassName} src={src} alt={alt} draggable="false" onError={onError} />
    </div>
  );
}

const styleBotWearablePatterns = [
  /\b(cloth(?:e|es|ing)?|apparel|garments?|outfits?|fashion|wearable|style|look)\b/i,
  /\b(sarees?|saris?|lehenga(?:s)?|dupatta(?:s)?|kurta(?:s)?|kurtis?|salwar(?:s)?|churidar(?:s)?|anarkali|palazzo(?:s)?|sharara(?:s)?)\b/i,
  /\b(sun\s*glasses|sunglasses|eye\s*glasses|eyeglasses|spectacles?|optical\s*frames?|goggles?|aviator|wayfarer)\b/i,
  /\b(underwear|briefs?|boxers?|trunks?|vests?|innerwear|lingerie|bras?|pant(?:y|ies)|camisoles?|shapewear)\b/i,
  /\b(night(?:y|ie|wear|gown|suit|dress)|sleepwear|pajamas?|pyjamas?|loungewear|robe)\b/i,
  /\b(dresses?|gowns?|suits?|skirts?|skorts?|jeans?|pants?|trousers?|joggers?|leggings?|chinos?|shorts?|bermudas?)\b/i,
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
  return styleBotCompatibility([
    query,
    product.name,
    product.brand,
    product.description,
    Array.isArray(product.tags) ? product.tags.join(' ') : product.tags
  ].filter(Boolean).join(' '));
}

function productGenderForPreference(value = '') {
  if (value === 'male') return 'men';
  if (value === 'female') return 'women';
  return '';
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

function currentSearchValue() {
  return new URLSearchParams(window.location.search).get('q') || '';
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
  const token = localStorage.getItem('fitlook_token');
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(readableError(data, `Request failed (${res.status})`));
  return data;
}

function recordEvent(type, payload = {}) {
  if (!localStorage.getItem('fitlook_token')) return;
  api('/recommendations/events', {
    method: 'POST',
    body: JSON.stringify({ type, ...payload })
  }).catch(() => {});
}

function useProducts(params) {
  const query = useMemo(() => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    return search.toString();
  }, [params]);
  const [state, setState] = useState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: true, error: '' });

  useEffect(() => {
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(`/products${query ? `?${query}` : ''}`)
      .then((data) => {
        if (alive) setState({ products: data.products || [], total: data.total || 0, facets: data.facets || { brands: [], categories: [], categoryCounts: [] }, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [query]);

  return state;
}

function useRecommendedProducts(user, limit = 6) {
  const [state, setState] = useState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: Boolean(user), error: '' });

  useEffect(() => {
    if (!user) {
      setState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: false, error: '' });
      return;
    }
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(`/recommendations/for-you?limit=${limit}`)
      .then((data) => {
        if (alive) setState({ products: data.products || [], total: data.products?.length || 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ products: [], total: 0, facets: { brands: [], categories: [], categoryCounts: [] }, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [user, limit]);

  return state;
}

function useSimilarProducts(id, limit = 4) {
  const [state, setState] = useState({ products: [], loading: true, error: '' });

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setState({ products: [], loading: true, error: '' });
    api(`/recommendations/similar/${encodeURIComponent(id)}?limit=${limit}`)
      .then((data) => {
        if (alive) setState({ products: data.products || [], loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ products: [], loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [id, limit]);

  return state;
}

function useProduct(id) {
  const [state, setState] = useState({ product: null, loading: true, error: '' });

  useEffect(() => {
    let alive = true;
    setState({ product: null, loading: true, error: '' });
    api(`/products/${encodeURIComponent(id)}`)
      .then((data) => {
        if (alive) setState({ product: data.product || null, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ product: null, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return state;
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
    api(`/tryons?productIds=${encodeURIComponent(productIds)}`)
      .then((data) => {
        if (!alive) return;
        const saved = Object.fromEntries((data.tryOns || []).map((tryOn) => [tryOn.productId, tryOn]));
        setTryOns((current) => ({ ...current, ...saved }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, productIds]);

  return [tryOns, setTryOns];
}

function Header({ user, setUser }) {
  const tokenLabel = user ? `${user.tokens} Tokens` : 'Tokens';
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = () => {
    localStorage.removeItem('fitlook_token');
    setUser(null);
    setMenuOpen(false);
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const navLinks = [
    ['Shop', '/search'],
    ['For Men', '/search?gender=men'],
    ['For Women', '/search?gender=women'],
    ['Categories', '/categories'],
    ['How it Works', '/how-it-works']
  ];

  return (
    <>
      <div className="announcement">
        <span>✨</span>
        <span>{user ? <>You have {user.tokens} tokens ready for AI try-on</> : <>Get free tokens on sign up to try AI try-on</>}</span>
        <span>✨</span>
      </div>
      <header className="site-header">
        <div className="wrap header-inner">
          <div className="header-left">
            <a className="brand" href="/">FitLook</a>
            <nav className="nav">
              {navLinks.map(([label, href]) => <a href={href} key={label}>{label}</a>)}
            </nav>
          </div>
          <div className="header-search" role="search">
            <form className="search-form" action="/search">
              <input name="q" type="search" placeholder="Search products, brands, categories" defaultValue={currentSearchValue()} aria-label="Search products" />
              <button className="search-submit" type="submit" aria-label="Search"><SearchIcon /></button>
            </form>
          </div>
          <div className="header-actions">
            <a className="token-pill" href="/tokens"><span>✨</span>{tokenLabel}</a>
            {user ? <a className="icon-button" href="/profile" aria-label="Profile"><UserIcon /></a> : <a className="icon-button" href="/login" aria-label="Account"><UserIcon /></a>}
            {user && <button className="text-button" onClick={logout}>Log out</button>}
            <button className="icon-button" aria-label="Wishlist"><HeartIcon /></button>
            <button className="icon-button menu-toggle" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
        <div className={`mobile-menu ${menuOpen ? 'open' : ''}`}>
          <div className="wrap mobile-menu-inner">
            {navLinks.map(([label, href]) => <a href={href} key={label} onClick={() => setMenuOpen(false)}>{label}</a>)}
            <a href="/tokens" onClick={() => setMenuOpen(false)}>{tokenLabel}</a>
            <a href={user ? '/profile' : '/login'} onClick={() => setMenuOpen(false)}>{user ? 'Profile' : 'Account'}</a>
            {user && <button type="button" onClick={logout}>Log out</button>}
          </div>
        </div>
      </header>
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <a className="footer-logo" href="/">FitLook</a>
            <p className="footer-about">Your AI fitting room.<br />See it on you, before you buy.</p>
          </div>
          <FooterCol title="Shop" links={[['All Products', '/search'], ['Men', '/search?gender=men'], ['Women', '/search?gender=women'], ['New Arrivals', '/search?newArrival=true'], ['Sale', '/sale'], ['Gift Cards', '/gift-cards']]} />
          <FooterCol title="Company" links={[['About Us', '/about'], ['How it Works', '/how-it-works'], ['Careers', '/careers'], ['Blog', '/blog'], ['Press', '/press']]} />
          <FooterCol title="Help" links={[['FAQ', '/support'], ['Shipping', '/support'], ['Returns & Exchanges', '/support'], ['Track Order', '/support'], ['Contact Us', '/contact']]} />
          <div className="newsletter"><h3>Join Our Community</h3><p>Subscribe to get new arrivals and token offers.</p><form className="newsletter-form"><input type="email" placeholder="Enter your email" /><button>Sign Up</button></form></div>
        </div>
        <div className="footer-bottom"><div>© 2024 FitLook. All rights reserved.</div><div className="legal"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/accessibility">Accessibility</a></div></div>
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

function Hero({ compact = false }) {
  const slide = {
    kicker: 'AI Try-On',
    title: <>See it on you,<br />before <em>you</em> buy.</>,
    copy: 'Upload once. Try thousands of outfits using AI and shop from top brands.',
    cta: 'Start Trying',
    href: '/tokens',
    image: compact ? 'hero2.png' : 'hero1.png'
  };

  return (
    <section className="hero">
      <div className="wrap">
        <div className={compact ? 'hero-panel compact' : 'hero-panel'}>
          <img className="hero-bg" src={asset(slide.image)} alt="" />
          <div className="hero-card">
            <span className="hero-kicker">{slide.kicker}</span>
            <h1 className="hero-title">{slide.title}</h1>
            <p className="hero-copy">{slide.copy}</p>
            <a className="hero-cta" href={slide.href}>{slide.cta} <span>→</span></a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Home({ user }) {
  const recommended = useRecommendedProducts(user, 6);
  const arrivals = useProducts({ newArrival: 'true', sort: 'newest', limit: 6 });

  return (
    <>
      <Hero />
      {user && (recommended.loading || recommended.products.length > 0) && <ProductSection title="Recommended For You" href="/search" state={recommended} user={user} />}
      <ProductSection title="New Arrivals" href="/search?newArrival=true" state={arrivals} user={user} />
      <section className="categories"><div className="wrap"><div className="section-head"><h2>Shop by Category</h2><a className="view-all" href="/categories">View all ›</a></div><div className="category-grid">{categories.slice(0, 8).map(([label, image, q]) => <a className="category" href={`/search?category=${encodeURIComponent(q)}`} key={label}><img src={asset(image)} alt={label} /><span>{label}</span></a>)}</div></div></section>
      <FeatureBand />
    </>
  );
}

function ProductSection({ title, href, state, user }) {
  const { products, loading, error } = state;
  const displayProducts = products.slice(0, 6);
  const [tryOns] = useTryOnCache(user, displayProducts);
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head"><h2>{title}</h2><a className="view-all" href={href}>View all ›</a></div>
        {loading && <ProductGridSkeleton count={6} />}
        {error && <StatusPanel text={error} />}
        {!loading && !error && products.length === 0 && <EmptyProducts />}
        {!loading && !error && products.length > 0 && <div className="product-grid">{displayProducts.map((product) => <ProductCard key={product.id} product={product} user={user} tryOn={tryOns[product.id]} />)}</div>}
      </div>
    </section>
  );
}

function CategoriesPage() {
  const state = useProducts({ limit: 96, sort: 'newest' });
  const fallbackBySlug = Object.fromEntries(categories.map(([label, image, slug]) => [slug, { label, image }]));
  const categoryCards = useMemo(() => {
    const groups = new Map();
    (state.products || []).forEach((product) => {
      const slug = String(product.category || 'uncategorized').toLowerCase();
      const current = groups.get(slug) || {
        slug,
        label: fallbackBySlug[slug]?.label || product.category || 'Uncategorized',
        fallbackImage: fallbackBySlug[slug]?.image || 'hero2.png',
        products: []
      };
      current.products.push(product);
      groups.set(slug, current);
    });

    const liveCategories = [...groups.values()].filter((category) => category.products.length > 0);
    if (liveCategories.length) {
      return liveCategories.sort((a, b) => b.products.length - a.products.length || a.label.localeCompare(b.label));
    }

    return categories.map(([label, image, slug]) => ({ slug, label, fallbackImage: image, products: [] }));
  }, [state.products]);

  return (
    <main className="category-page">
      <section className="wrap category-page-head">
        <p className="kicker">Categories</p>
        <h1>Shop by category.</h1>
        <p className="lead">Browse product groups with a quick visual preview from the live catalog.</p>
      </section>

      <section className="wrap category-showcase-grid">
        {state.loading && <StatusPanel text="Loading categories..." />}
        {state.error && <StatusPanel text={state.error} />}
        {!state.loading && !state.error && categoryCards.map((category) => {
          const previewImages = category.products.slice(0, 4).map((product) => product.imageUrl).filter(Boolean);
          const images = previewImages.length ? previewImages : [asset(category.fallbackImage)];
          return (
            <article className="category-showcase-card" key={category.slug}>
              <a className="category-showcase-media" href={`/search?category=${encodeURIComponent(category.slug)}`}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <img src={images[index % images.length]} alt="" key={`${category.slug}-${index}`} />
                ))}
              </a>
              <div className="category-showcase-info">
                <div className="category-showcase-title">
                  <img src={asset(category.fallbackImage)} alt="" />
                  <div>
                    <h2>{category.label}</h2>
                    <p>{category.products.length ? `${category.products.length} products` : 'Waiting for products'}</p>
                  </div>
                </div>
                <a href={`/search?category=${encodeURIComponent(category.slug)}`}>View more ›</a>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function ProductCard({ product, user, locked = false, tryOn, canTryOn = false, tryOnLoading = false, tryOnError = '', onTryOn }) {
  const [tryOnImageFailed, setTryOnImageFailed] = useState(false);
  const hasDiscount = product.compareAtPrice && product.compareAtPrice > product.price;
  const discount = hasDiscount ? `${Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)}% OFF` : '';
  const productImage = product.imageUrl || asset('hero2.png');
  const hasUsableTryOn = Boolean(tryOn?.imageUrl) && !tryOnImageFailed;
  const image = hasUsableTryOn ? tryOn.imageUrl : productImage;
  const detailHref = `/product/${encodeURIComponent(product.id)}`;
  const brand = displayBrand(product);

  useEffect(() => {
    setTryOnImageFailed(false);
  }, [tryOn?.imageUrl]);

  const content = (
    <>
      <div className="product-media">
        <img
          src={image}
          alt={product.name}
          onError={(event) => {
            if (hasUsableTryOn) setTryOnImageFailed(true);
            else if (event.currentTarget.src !== window.location.origin + asset('hero2.png')) event.currentTarget.src = asset('hero2.png');
          }}
        />
        {product.badge && <span className="badge">{product.badge}</span>}
        {hasUsableTryOn && <span className="badge tryon-badge">AI Try-On</span>}
        {tryOnLoading && <TryOnGenerating />}
        {!locked && <span className="heart"><HeartIcon /></span>}
      </div>
      <div className="product-info">
        <h3 className="product-title">{product.name}</h3>
        <p className="product-brand">{brand}</p>
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
      {locked ? <div>{content}</div> : <a className="product-card-link" href={detailHref} onClick={() => recordEvent('product_click', { productId: product.id })}>{content}</a>}
      {!locked && (
        <div className="product-card-actions">
          {canTryOn && onTryOn ? (
            <button type="button" onClick={() => onTryOn(product)} disabled={tryOnLoading || Boolean(tryOn?.imageUrl)}>
              {hasUsableTryOn ? 'Try-On Ready' : tryOnImageFailed ? 'Product Photo' : tryOnLoading ? 'Generating...' : 'Try On'}
            </button>
          ) : (
            <a href={user ? detailHref : '/signup'}>{hasUsableTryOn ? 'Try-On Ready' : 'Try On'}</a>
          )}
          {product.affiliateLink && <a className="shop-action" href={product.affiliateLink} target="_blank" rel="noreferrer" onClick={() => recordEvent('shop_click', { productId: product.id })}>Shop</a>}
          {tryOnError && <p>{tryOnError}</p>}
        </div>
      )}
    </article>
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
  const [tryOnErrors, setTryOnErrors] = useState({});
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

  const generateTryOn = async (product) => {
    setTryOnLoading((current) => ({ ...current, [product.id]: true }));
    setTryOnErrors((current) => ({ ...current, [product.id]: '' }));
    try {
      const data = await api(`/tryons/${product.id}`, { method: 'POST' });
      setTryOns((current) => ({ ...current, [product.id]: data.tryOn }));
      recordEvent('try_on', { productId: product.id });
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
    <>
      <Hero compact />
      <section className="wrap results-shell">
        <div className="results-main">
          <div className="results-head">
            <div><h1>{title}</h1><p className="count">{state.loading ? 'Searching...' : `${state.total} Products`}</p></div>
          </div>
          <ActiveFilterChips values={filterValues} />
          <FilterPanel className="mobile-filters" facets={state.facets} values={filterValues} />
          {state.loading && <ProductGridSkeleton count={8} />}
          {state.error && <StatusPanel text={state.error} />}
          {!state.loading && !state.error && state.products.length === 0 && <EmptyProducts search={title} />}
          {!state.loading && !state.error && state.products.length > 0 && (
            <div className="product-grid">
              {visibleProducts.map((product, index) => <ProductCard key={product.id} product={product} user={user} tryOn={tryOns[product.id]} canTryOn={allowTryOnTrial && index < 4} tryOnLoading={Boolean(tryOnLoading[product.id])} tryOnError={tryOnErrors[product.id]} onTryOn={generateTryOn} />)}
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
    </>
  );
}

function CustomTryOnPage({ user, setUser }) {
  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  return (
    <main className="custom-tryon-page">
      <section className="wrap custom-tryon-hero">
        <p className="kicker">Custom Try-On</p>
        <h1>Try on any clothing photo.</h1>
        <p className="lead">Upload a garment image and FitLook will generate it on your saved profile photo. Each generated image costs 1 token.</p>
      </section>
      <CustomClothingTryOn setUser={setUser} />
    </main>
  );
}

function CustomClothingTryOn({ setUser }) {
  const fileRef = useRef(null);
  const [garmentPreview, setGarmentPreview] = useState('');
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [tryOnModel, setTryOnModel] = useState('gpt-image-2');

  const chooseGarment = (event) => {
    const file = event.currentTarget.files?.[0];
    setResult(null);
    setMessage('');
    if (!file) {
      setGarmentPreview('');
      return;
    }
    setGarmentPreview(URL.createObjectURL(file));
  };

  const submit = async (event) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage('Upload a clothing photo first.');
      return;
    }
    setLoading(true);
    setMessage('Generating custom try-on...');
    try {
      const form = new FormData();
      form.append('garment', file);
      form.append('tryOnModel', tryOnModel);
      const data = await api('/tryons/custom', { method: 'POST', body: form });
      setResult(data.tryOn);
      recordEvent('custom_tryon', { metadata: { tryOnModel } });
      if (data.user) {
        setUser((current) => {
          if (!current) return data.user;
          return { ...data.user, tokens: Math.min(current.tokens, data.user.tokens) };
        });
      }
      setMessage('Custom try-on ready.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="wrap custom-tryon">
        <div className="custom-tryon-copy">
          <p className="kicker">Custom Clothing</p>
          <h2>Upload the garment.</h2>
          <p>Use a clear front-facing photo where the clothing item is easy to see.</p>
        </div>
        <form className="custom-tryon-panel" onSubmit={submit}>
          <label className="upload-box custom-upload">
            <input ref={fileRef} name="garment" type="file" accept="image/*" onChange={chooseGarment} />
            <span>
              <span className="upload-icon">↑</span>
              <span className="upload-title">Upload clothing photo</span>
              <span className="upload-help">Use a front-facing product photo with the garment clearly visible.</span>
            </span>
          </label>
          <div className="tryon-model-select" role="radiogroup" aria-label="Custom try-on clothing type">
            <label className={tryOnModel === 'gpt-image-2' ? 'active' : ''}>
              <input type="radio" name="tryOnModel" value="gpt-image-2" checked={tryOnModel === 'gpt-image-2'} onChange={(event) => setTryOnModel(event.target.value)} />
              <span>Everyday Clothing</span>
            </label>
            <label className={tryOnModel === 'wan-v2.6-image-to-image' ? 'active' : ''}>
              <input type="radio" name="tryOnModel" value="wan-v2.6-image-to-image" checked={tryOnModel === 'wan-v2.6-image-to-image'} onChange={(event) => setTryOnModel(event.target.value)} />
              <span>Fitted & Swimwear</span>
            </label>
          </div>
          <div className="custom-preview-grid">
            <div className="custom-preview">
              {garmentPreview ? <ZoomableImage src={garmentPreview} alt="Uploaded clothing preview" /> : <span>Garment preview</span>}
            </div>
            <div className="custom-preview result">
              {loading && <TryOnGenerating />}
              {result?.imageUrl ? (
                <>
                  <ZoomableImage src={result.imageUrl} alt="Generated custom try-on" />
                  <button className="fullscreen-button" type="button" aria-label="Open generated image full screen" title="Open full screen" onClick={() => setFullscreenImage({ src: result.imageUrl, alt: 'Generated custom try-on', title: 'Custom Try-On' })}><FullscreenIcon /></button>
                </>
              ) : <span>Generated try-on</span>}
            </div>
          </div>
          <button className="submit" type="submit" disabled={loading}>{loading ? 'Generating...' : 'Generate Custom Try-On'}</button>
          {message && <p className={`form-message ${result?.imageUrl ? '' : 'error-message'}`}>{message}</p>}
        </form>
      </section>
      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
    </>
  );
}

function StyleBotPage({ user, setUser }) {
  const [query, setQuery] = useState('');
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const promptIdeas = ['linen shirts under 1500', 'black party dress', 'gold sunglasses', 'oversized denim jacket'];

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const updateRun = (id, updater) => {
    setRuns((current) => current.map((run) => (run.id === id ? { ...run, ...updater(run) } : run)));
  };

  const submit = async (event) => {
    event.preventDefault();
    const prompt = query.trim();
    if (!prompt || busy) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const promptCompatibility = styleBotCompatibility(prompt);
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
        body: JSON.stringify({ query: prompt, limit: 2, genderPreference: user.genderPreference || 'other' })
      });
      const products = (data.products || []).filter((product) => (
        styleBotProductCompatibility(product, prompt).compatible &&
        styleBotGenderCompatibility(product, user.genderPreference).compatible
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

  return (
    <main className="style-bot-page">
      <section className="wrap style-bot-shell">
        <div className="style-bot-head">
          <p className="kicker">Style Bot</p>
          <h1>Tell FitLook what to find.</h1>
          <p className="lead">The bot searches public Amazon pages, pulls the top two product details into the chat, and auto-generates try-ons for those results. Each new try-on costs 1 token.</p>
          <div className="style-prompt-chips" aria-label="Style bot prompt ideas">
            {promptIdeas.map((idea) => <button type="button" key={idea} onClick={() => setQuery(idea)}>{idea}</button>)}
          </div>
        </div>

        <section className="chat-panel" aria-label="Style bot chat">
          <div className="chat-panel-head">
            <div><strong>FitLook Assistant</strong><span>Amazon trial search · 2 products max</span></div>
            <small>{`${user?.tokens ?? 0} tokens`}</small>
          </div>
          <div className="chat-scroll">
            <div className="chat-row assistant">
              <div className="chat-bubble">Tell me the item, vibe, color, budget, or occasion. I’ll find two options and generate the try-on right here.</div>
            </div>
            {runs.map((run) => (
              <div className="chat-run" key={run.id}>
                <div className="chat-row user"><div className="chat-bubble">{run.query}</div></div>
                <div className="chat-row assistant">
                  <div className="chat-bubble wide">
                    {run.loading && <StatusPanel text="Searching Amazon public pages..." />}
                    {run.searchError && <p className="form-message error-message">{run.searchError}</p>}
                    {!run.loading && !run.searchError && (
                      <>
                        <p className="chat-note">Found {run.products.length} products · try-ons generate automatically</p>
                        <div className="style-results">
                          {run.products.map((product) => (
                            <StyleBotProduct
                              key={product.id}
                              product={product}
                              tryOn={run.tryOns[product.id]}
                              loading={Boolean(run.generating[product.id])}
                              error={run.errors[product.id]}
                              onFullscreen={setFullscreenImage}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <form className="chat-composer" onSubmit={submit}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe the dress, outfit, or accessory" />
            <button type="submit" disabled={busy || !query.trim()}>{busy ? 'Working...' : 'Send'}</button>
          </form>
        </section>
      </section>
      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
    </main>
  );
}

function StyleBotProduct({ product, tryOn, loading, error, onFullscreen }) {
  const [tryOnImageFailed, setTryOnImageFailed] = useState(false);
  const tags = (product.tags || []).filter(Boolean).slice(0, 4);
  const productImage = product.imageUrl || asset('hero2.png');
  const hasUsableTryOn = Boolean(tryOn?.imageUrl) && !tryOnImageFailed;
  const brand = displayBrand(product);
  const category = displayCategory(product);

  useEffect(() => {
    setTryOnImageFailed(false);
  }, [tryOn?.imageUrl]);

  return (
    <article className="style-result-card">
      <div className="style-result-media">
        <div>
          <span className="style-media-label">Product</span>
          <ZoomableImage src={productImage} alt={product.name} />
        </div>
        <div className="style-generated">
          <span className="style-media-label">On You</span>
          {loading && <TryOnGenerating />}
          {hasUsableTryOn ? (
            <>
              <ZoomableImage src={tryOn.imageUrl} alt={`AI try-on for ${product.name}`} onError={() => setTryOnImageFailed(true)} />
              <button className="fullscreen-button" type="button" aria-label="Open generated image full screen" title="Open full screen" onClick={() => onFullscreen({ src: tryOn.imageUrl, alt: `AI try-on for ${product.name}`, title: product.name })}><FullscreenIcon /></button>
            </>
          ) : tryOn?.imageUrl ? (
            <ZoomableImage src={productImage} alt={product.name} />
          ) : <div className="style-placeholder">Waiting for try-on</div>}
        </div>
      </div>
      <div className="style-result-info">
        <h2>{product.name}</h2>
        <p>{brand} · {category}</p>
        <p className="rating"><span>★</span> {Number(product.rating || 0).toFixed(1)} {product.ratingCount ? `(${product.ratingCount})` : ''}</p>
        <div className="price-row"><span className="price">{formatMoney(product.price, product.currency)}</span></div>
        {product.description && <p className="style-result-description">{product.description}</p>}
        {tags.length > 0 && <div className="style-result-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        {error && <p className="form-message error-message">{error}</p>}
        <div className="style-result-actions">
          {product.affiliateLink && <a className="button" href={product.affiliateLink} target="_blank" rel="noreferrer" onClick={() => recordEvent('shop_click', { query: product.name, metadata: { product } })}>Shop ↗</a>}
        </div>
      </div>
    </article>
  );
}

function ImageLightbox({ image, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Generated try-on preview" onClick={onClose}>
      <button className="lightbox-close" type="button" onClick={onClose} aria-label="Close full screen preview">×</button>
      <figure onClick={(event) => event.stopPropagation()}>
        <img src={image.src} alt={image.alt} />
        <figcaption>{image.title}</figcaption>
      </figure>
    </div>
  );
}

function TokenPage({ user, setUser }) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  
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
    setMessage('Opening PhonePe checkout...');
    try {
      const data = await api('/payments/phonepe/subscription', { method: 'POST' });
      window.location.assign(data.redirectUrl);
    } catch (err) {
      setMessage(err.message);
      setCheckoutLoading(false);
    }
  };

  // Dev mode removed in frontend — token mode only

  return (
    <main className="token-page">
      <section className="wrap token-hero">
        <p className="kicker">FitLook Tokens</p>
        <h1>One token, one AI try-on.</h1>
        <p className="lead">Get 20 free tokens on signup. Subscribe for Rs 1000/month to receive 100 try-on tokens for the month.</p>
        <div className="token-balance">{user ? <><span>{user.tokens}</span><strong>tokens available</strong></> : <><span>20</span><strong>free tokens on signup</strong></>}</div>
        {message && <p className={`token-message ${/failed|not completed|missing|Could not|error/i.test(message) ? 'error-message' : ''}`}>{message}</p>}
      </section>

      <section className="wrap token-grid subscription-grid">
        <article className="token-pack featured-token-pack">
          <div className="plan-status-row">
            <h2>Monthly</h2>
            {isActive && <span>Active</span>}
          </div>
          <p className="token-amount">100 tokens every month</p>
          <p className="token-price">Rs 1000</p>
          <p>PhonePe checkout opens securely when you subscribe. Tokens are added only after payment is confirmed.</p>
          <button type="button" onClick={startCheckout} disabled={checkoutLoading}>
            {checkoutLoading ? 'Opening PhonePe...' : user ? 'Subscribe with PhonePe' : 'Create Account First'}
          </button>
          {isActive && subscription.currentPeriodEnd && <small>Current month ends {formatDate(subscription.currentPeriodEnd)}</small>}
        </article>
      </section>

      <section className="wrap token-rules">
        <article><h3>What costs tokens?</h3><p>Generating a product try-on or custom clothing try-on costs 1 token.</p></article>
        <article><h3>What is free?</h3><p>New accounts start with 20 free tokens. Browsing, search, product pages, and viewing saved try-ons are free.</p></article>
        <article><h3>How payment works</h3><p>FitLook verifies the PhonePe order status before adding subscription tokens, so a return or callback cannot double-credit your account.</p></article>
      </section>
    </main>
  );
}

function ProfilePage({ user, setUser }) {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState('');
  const [message, setMessage] = useState('');
  const [genderMessage, setGenderMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingGender, setSavingGender] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const photoSrc = preview || user.bodyPhotoUrl;
  const selectPhoto = (event) => {
    const file = event.currentTarget.files?.[0];
    setPreview(file ? URL.createObjectURL(file) : '');
    setMessage('');
  };

  const submitPhoto = async (event) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage('Choose a new profile photo first.');
      return;
    }
    setSaving(true);
    setMessage('Updating profile photo...');
    try {
      const form = new FormData();
      form.append('bodyPhoto', file);
      const data = await api('/auth/body-photo', { method: 'POST', body: form });
      setUser(data.user);
      if (fileRef.current) fileRef.current.value = '';
      setPreview('');
      setMessage('Profile photo updated. Future try-ons will use this image.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitGenderPreference = async (event) => {
    event.preventDefault();
    const genderPreference = new FormData(event.currentTarget).get('genderPreference');
    setSavingGender(true);
    setGenderMessage('Saving preference...');
    try {
      const data = await api('/auth/gender-preference', {
        method: 'PATCH',
        body: JSON.stringify({ genderPreference })
      });
      setUser(data.user);
      setGenderMessage('Gender preference updated. Style Bot will use this for future searches.');
    } catch (err) {
      setGenderMessage(err.message);
    } finally {
      setSavingGender(false);
    }
  };

  return (
    <main className="profile-page">
      <section className="wrap profile-hero">
        <div>
          <p className="kicker">Profile</p>
          <h1>Your fitting room profile.</h1>
          <p className="lead">Manage the account details and body photo FitLook uses for AI try-on previews.</p>
        </div>
        <div className="profile-credit-card">
          <span>{user.tokens}</span>
          <strong>credits available</strong>
          <a href="/tokens">View token plans</a>
        </div>
      </section>

      <section className="wrap profile-grid">
        <article className="profile-card">
          <h2>Basic details</h2>
          <dl className="profile-details">
            <div><dt>Name</dt><dd>{user.name}</dd></div>
            <div><dt>Username</dt><dd>@{user.username}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Preference</dt><dd>{genderPreferenceLabel(user.genderPreference)}</dd></div>
            <div><dt>Joined</dt><dd>{formatDate(user.joinedAt)}</dd></div>
          </dl>
          <form className="profile-preference-form" onSubmit={submitGenderPreference}>
            <label className="field">
              <span>Gender preference</span>
              <select name="genderPreference" defaultValue={user.genderPreference || 'other'}>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>
            <button className="secondary-button" type="submit" disabled={savingGender}>{savingGender ? 'Saving...' : 'Save Preference'}</button>
            {genderMessage && <p className="form-message">{genderMessage}</p>}
          </form>
        </article>

        <article className="profile-card">
          <h2>Credits</h2>
          <div className="profile-token-meter">
            <span>{user.tokens}</span>
            <div>
              <strong>{`${user.tokens} try-on credits`}</strong>
              <p>Each new AI-generated try-on costs 1 token. Cached try-ons are free to view again.</p>
            </div>
          </div>
        </article>

        <article className="profile-card profile-photo-card">
          <div>
            <h2>Try-on photo</h2>
            <p>This is the body reference used when generating product and custom try-ons.</p>
          </div>
          <form className="profile-photo-form" onSubmit={submitPhoto}>
            <label className={`upload-box profile-photo-upload ${photoSrc ? 'has-preview' : ''}`}>
              <input ref={fileRef} name="bodyPhoto" type="file" accept="image/*" onChange={selectPhoto} />
              {photoSrc ? (
                <>
                  <img className="upload-preview" src={photoSrc} alt="Current try-on profile" />
                  <span className="upload-overlay"><span className="upload-title">Change try-on photo</span><span className="upload-help">Use a clear front-facing full-body image.</span></span>
                </>
              ) : (
                <span><span className="upload-icon">↑</span><span className="upload-title">Upload try-on photo</span><span className="upload-help">Front-facing, full-length image with good lighting.</span></span>
              )}
            </label>
            <button className="submit" type="submit" disabled={saving || !preview}>{saving ? 'Saving...' : 'Save New Photo'}</button>
            {message && <p className="form-message">{message}</p>}
          </form>
        </article>
      </section>
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

  const hrefWithout = (key) => {
    const params = new URLSearchParams();
    Object.entries(values).forEach(([name, value]) => {
      if (name !== key && value) params.set(name, value);
    });
    return `/search${params.toString() ? `?${params}` : ''}`;
  };

  return (
    <div className="active-filters" aria-label="Active filters">
      {active.map(([key, , label]) => <a href={hrefWithout(key)} key={key}>{label}<span>×</span></a>)}
      <a className="clear" href="/search">Clear all</a>
    </div>
  );
}

function FilterPanel({ facets, values, className = '' }) {
  const resetHref = '/search';
  const brands = usableBrands(facets.brands);

  return (
    <aside className={`filters ${className}`}>
      <div className="filter-head"><h2>Filters</h2><a href={resetHref}>Reset</a></div>
      <form className="filter-form" action="/search">
        <input name="q" defaultValue={values.q} placeholder="Search keyword" />
        <select name="category" defaultValue={values.category}>
          <option value="">All categories</option>
          {facets.categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="brand" defaultValue={values.brand}>
          <option value="">All brands</option>
          {brands.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="gender" defaultValue={values.gender}>
          <option value="">All genders</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
          <option value="unisex">Unisex</option>
        </select>
        <select name="sort" defaultValue={values.sort}>
          <option value="">Most relevant</option>
          <option value="newest">Newest</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
        </select>
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
  const [tryOnError, setTryOnError] = useState('');
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [detailImageView, setDetailImageView] = useState('tryon');
  const productViewStarted = useRef('');
  const relatedProducts = related.products.filter((item) => item.id !== id).slice(0, 4);
  const [relatedTryOns] = useTryOnCache(user, relatedProducts);

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
  const showingTryOn = hasUsableTryOn && detailImageView !== 'product';
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
    ['For', product.gender],
    ['Rating', `${Number(product.rating || 0).toFixed(1)}${product.ratingCount ? ` from ${product.ratingCount} reviews` : ''}`],
    ['Price', formatMoney(product.price, product.currency)]
  ].filter(([, value]) => value);
  const productTags = (product.tags || []).filter(Boolean).slice(0, 10);

  const generateProductTryOn = async () => {
    if (!product || tryOnLoading || tryOn?.imageUrl) return;
    setTryOnLoading(true);
    setTryOnError('');
    try {
      const data = await api(`/tryons/${product.id}`, { method: 'POST' });
      setTryOn(data.tryOn);
      recordEvent('try_on', { productId: product.id, metadata: { tryOnModel: product.tryOnModel || 'default' } });
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

  return (
    <main className="product-page">
      <section className="wrap product-detail">
        <div className="breadcrumb"><a href="/search">Shop</a><span>/</span><a href={`/search?category=${encodeURIComponent(product.category || '')}`}>{category}</a></div>
        <div className="product-detail-grid">
          <div className={`product-detail-media ${showingTryOn ? 'showing-tryon' : 'showing-product'}`}>
            <ZoomableImage
              src={image}
              alt={product.name}
              zoom={1.75}
              onError={(event) => {
                if (hasUsableTryOn) setTryOnImageFailed(true);
                else if (event.currentTarget.src !== window.location.origin + asset('hero2.png')) event.currentTarget.src = asset('hero2.png');
              }}
            />
            {product.badge && <span className="badge">{product.badge}</span>}
            {showingTryOn && <span className="badge tryon-badge">AI Try-On</span>}
            {hasUsableTryOn && (
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
            {tryOnLoading && <TryOnGenerating />}
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
          <div className="product-summary">
            <p className="kicker">{brand}</p>
            <h1>{product.name}</h1>
            <p className="rating detail-rating"><span>★</span> {Number(product.rating || 0).toFixed(1)} {product.ratingCount ? `(${product.ratingCount} reviews)` : ''}</p>
            <div className="price-row detail-price">
              <span className="price">{formatMoney(product.price || 0, product.currency)}</span>
              {hasDiscount && <span className="was">{formatMoney(product.compareAtPrice, product.currency)}</span>}
              {discount && <span className="off">{discount}</span>}
            </div>
            <p className="product-description">{product.description || 'No product description has been added yet.'}</p>
            <div className="product-meta">
              {product.category && <a href={`/search?category=${encodeURIComponent(product.category)}`}>{category}</a>}
              {product.gender && <a href={`/search?gender=${encodeURIComponent(product.gender)}`}>{product.gender}</a>}
              {product.isNewArrival && <span>New arrival</span>}
            </div>
            <div className="product-detail-facts" aria-label="Product details">
              {detailFacts.map(([label, value]) => (
                <div key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
            {productTags.length > 0 && (
              <div className="product-tags" aria-label="Product tags">
                {productTags.map((tag) => <a href={`/search?tag=${encodeURIComponent(tag)}`} key={tag}>{tag}</a>)}
              </div>
            )}
            <div className="product-actions">
              {product.affiliateLink && <a className="button" href={product.affiliateLink} target="_blank" rel="noreferrer" onClick={() => recordEvent('shop_click', { productId: product.id })}>Shop Brand ↗</a>}
              {user ? (
                <button className="secondary-button" type="button" onClick={generateProductTryOn} disabled={tryOnLoading || Boolean(tryOn?.imageUrl)}>
                  {hasUsableTryOn ? 'Try-On Ready' : tryOnImageFailed ? 'Product Photo Shown' : tryOnLoading ? 'Generating Try-On...' : 'Generate AI Try-On'}
                </button>
              ) : <a className="secondary-button" href="/signup">Create Profile for Try-On</a>}
            </div>
            {tryOnError && <p className="form-message error-message">{tryOnError}</p>}
          </div>
        </div>
      </section>

      {relatedProducts.length > 0 && (
        <section className="section">
          <div className="wrap">
            <div className="section-head"><h2>More Like This</h2><a className="view-all" href={`/search?category=${encodeURIComponent(product.category || '')}`}>View all ›</a></div>
            <div className="product-grid">{relatedProducts.map((item) => <ProductCard key={item.id} product={item} user={user} tryOn={relatedTryOns[item.id]} />)}</div>
          </div>
        </section>
      )}
      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
    </main>
  );
}

function StatusPanel({ text }) {
  return <div className="status-panel">{text}</div>;
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
      <section className="page-hero"><div className="wrap hero-grid"><div className="page-copy"><p className="kicker">{kicker}</p><h1>{title}</h1><p className="lead">{lead}</p><a className="button" href={actionHref}>{actionLabel}</a></div><div className="page-image"><img src={asset(image)} alt="" /></div></div></section>
      {children || <section className="section"><div className="wrap info-grid"><article className="info-card"><h3>AI try-on ready</h3><p>Preview selected products on your profile.</p></article><article className="info-card"><h3>Catalog shopping</h3><p>Explore styles, categories, and new arrivals.</p></article><article className="info-card"><h3>Token powered</h3><p>Use tokens only when generating previews.</p></article><article className="info-card"><h3>Privacy aware</h3><p>Your full-body photo is part of your personal profile.</p></article></div></section>}
    </>
  );
}

function AuthPage({ mode, setUser }) {
  const [message, setMessage] = useState('');
  const [nameValue, setNameValue] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameSuggestions, setUsernameSuggestions] = useState([]);
  const [bodyPhotoPreview, setBodyPhotoPreview] = useState('');
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
    setMessage(file && file.size > MAX_BODY_PHOTO_BYTES ? 'Large profile photo selected. It will be optimized before upload.' : '');
    setBodyPhotoPreview(file ? URL.createObjectURL(file) : '');
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('Working...');
    try {
      const form = event.currentTarget;
      const body = isSignup ? new FormData(form) : JSON.stringify(Object.fromEntries(new FormData(form)));
      if (isSignup) {
        const bodyPhoto = form.elements.bodyPhoto?.files?.[0];
        body.set('bodyPhoto', await prepareBodyPhoto(bodyPhoto));
      }
      const data = await api(isSignup ? '/auth/signup' : '/auth/login', { method: 'POST', body });
      localStorage.setItem('fitlook_token', data.token);
      setUser(data.user);
      window.history.pushState({}, '', '/search');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <main className="auth-layout wrap">
      <section className="auth-panel">
        <div className="auth-card">
          <p className="auth-kicker">{isSignup ? 'Create Profile' : 'Welcome Back'}</p>
          <h1>{isSignup ? 'Build your AI fitting room.' : 'Log in to your fitting room.'}</h1>
          <p className="auth-copy">{isSignup ? 'Upload one full-body photo so FitLook can generate realistic outfit previews.' : 'Continue browsing, unlock your saved looks, and generate AI previews.'}</p>
          <form className="auth-form" onSubmit={submit}>
            {isSignup && (
              <>
                <label className="field"><span>Full name</span><input name="name" required value={nameValue} onChange={(event) => { setNameValue(event.target.value); setUsernameTouched(false); }} /></label>
                <label className="field"><span>Username</span><input name="username" required minLength="3" value={username} onChange={(event) => { setUsernameTouched(true); setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); }} /></label>
                {usernameSuggestions.length > 0 && (
                  <div className="username-suggestions" aria-label="Username suggestions">
                    {usernameSuggestions.map((item) => (
                      <button type="button" key={item} onClick={() => { setUsernameTouched(true); setUsername(item); }}>{item}</button>
                    ))}
                  </div>
                )}
              </>
            )}
            <label className="field"><span>{isSignup ? 'Email address' : 'Email or username'}</span><input name="email" type={isSignup ? 'email' : 'text'} required /></label>
            {isSignup && (
              <label className="field">
                <span>Gender preference</span>
                <select name="genderPreference" required defaultValue="">
                  <option value="" disabled>Choose preference</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>
            )}
            <label className="field"><span>Password</span><input name="password" type="password" required minLength="6" /></label>
            {isSignup && (
              <>
                <label className={`upload-box ${bodyPhotoPreview ? 'has-preview' : ''}`}>
                  <input name="bodyPhoto" type="file" accept="image/*" required onChange={previewBodyPhoto} />
                  {bodyPhotoPreview ? (
                    <>
                      <img className="upload-preview" src={bodyPhotoPreview} alt="Uploaded profile preview" />
                      <span className="upload-overlay"><span className="upload-title">Change profile photo</span><span className="upload-help">Use a clear front-facing full-body image.</span></span>
                    </>
                  ) : (
                    <span><span className="upload-icon">↑</span><span className="upload-title">Upload a clear standing photo</span><span className="upload-help">Front-facing, full-length image with good lighting.</span></span>
                  )}
                </label>
                <div className="photo-rules" aria-label="Allowed try-on photo guidelines">
                  <strong>Best photo for AI try-on</strong>
                  <ul>
                    <li>Use a single-person, full-body photo from head to shoes.</li>
                    <li>Stand facing the camera with your face clearly visible.</li>
                    <li>Choose bright lighting and a simple background.</li>
                    <li>Avoid mirror selfies, heavy filters, group photos, cropped bodies, or covered faces.</li>
                  </ul>
                </div>
              </>
            )}
            <button className="submit">{isSignup ? 'Create Account' : 'Log In'}</button>
          </form>
          {message && <p className={`form-message ${message === 'Working...' ? '' : 'error-message'}`}>{message}</p>}
          <p className="switch">{isSignup ? 'Already have an account?' : 'New to FitLook?'} <a href={isSignup ? '/login' : '/signup'}>{isSignup ? 'Log in' : 'Create an account'}</a></p>
        </div>
        <div className="auth-visual"><img src={asset('hero2.png')} alt="" /></div>
      </section>
    </main>
  );
}

function FeatureBand() {
  return <section className="feature-band"><div className="wrap features">{['AI Try-On', 'Top Brands', 'Secure & Private', 'Easy Returns', '24/7 Support'].map((f) => <div className="feature" key={f}><div className="feature-icon">✦</div><div><p className="feature-title">{f}</p><p className="feature-copy">Designed for confident shopping</p></div></div>)}</div></section>;
}

function App() {
  const [path, setPath] = useState(normalizePath());
  const [user, setUser] = useState(null);

  useEffect(() => {
    const onPop = () => setPath(normalizePath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('fitlook_token')) return;
    api('/auth/me').then((data) => setUser(data.user)).catch(() => localStorage.removeItem('fitlook_token'));
  }, []);

  useEffect(() => {
    if (!user || (path !== '/signup' && path !== '/login')) return;
    window.history.replaceState({}, '', '/search');
    setPath('/search');
  }, [path, user]);

  const page = useMemo(() => {
    const productMatch = path.match(/^\/product\/([^/]+)$/);
    if (path === '/') return <Home user={user} />;
    if (path === '/search') return <SearchPage user={user} setUser={setUser} />;
    if (path === '/categories') return <CategoriesPage />;
    if (path === '/try-on') return user ? <SearchPage user={user} setUser={setUser} tryOnMode /> : <AuthPage mode="signup" setUser={setUser} />;
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
  }, [path, user]);

  return (
    <>
      <Header user={user} setUser={setUser} />
      {page}
      <div className="floating-actions" aria-label="FitLook quick actions">
        <a className="floating-action style" href="/style-bot" aria-label="Open style bot"><span><SearchIcon /></span><strong><small>Ask for a look</small>Style Bot</strong></a>
        <a className="floating-action custom" href="/custom-try-on" aria-label="Custom clothing try-on"><span>AI</span><strong><small>Upload clothing</small>Custom Try-On</strong></a>
      </div>
      <Footer />
    </>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

function UserIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>;
}

function HeartIcon() {
  return <svg viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /></svg>;
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
