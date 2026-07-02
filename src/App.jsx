import { useEffect, useMemo, useRef, useState } from 'react';

const asset = (name) => `/assets/${name}`;

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
  '/gift-cards': ['Gift Cards', 'Style confidence makes a good gift.', 'Gift cards can be used toward shopping and try-on tokens when the product is connected.', 'hero-room.png'],
  '/about': ['About', 'Shopping online should feel more certain.', 'FitLook combines product discovery with AI try-on previews so shoppers can compare styles with more confidence.', 'hero-room.png'],
  '/support': ['Help', 'Support for shopping and try-on.', 'Find answers about shipping, returns, profile photos, tokens, and account access.', 'search-shirt-4.jpg'],
  '/contact': ['Contact', 'Tell us what you need.', 'For order, token, account, and AI try-on questions, reach the FitLook support team.', 'hero-room.png'],
  '/careers': ['Careers', 'Build the future of fitting rooms.', 'Future roles across product, design, engineering, fashion operations, and partnerships would be listed here.', 'hero-room.png'],
  '/blog': ['Blog', 'Fit notes, styling ideas, and AI try-on updates.', 'Editorial content, product guides, and try-on tips would live here.', 'arrival-4.jpg'],
  '/press': ['Press', 'FitLook press and media.', 'Company information, product screenshots, and media contact details would be available here.', 'hero-room.png'],
  '/terms': ['Terms', 'Terms and conditions.', 'This page outlines where account, token, shopping, and AI try-on usage rules live.', 'hero-room.png'],
  '/privacy': ['Privacy', 'Your try-on profile is personal.', 'This page describes how account details, full-body photos, token usage, and shopping activity are handled.', 'hero-room.png'],
  '/accessibility': ['Accessibility', 'Accessibility matters at every step.', 'Accessibility goals cover navigation, forms, image alt text, contrast, and keyboard-friendly flows.', 'hero-room.png']
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

async function api(path, options = {}) {
  const token = localStorage.getItem('fitlook_token');
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(readableError(data, `Request failed (${res.status})`));
  return data;
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
  const tokenLabel = user?.devMode ? 'Dev Mode' : user ? `${user.tokens} Tokens` : 'Tokens';
  const logout = () => {
    localStorage.removeItem('fitlook_token');
    setUser(null);
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <>
      <div className="announcement">
        <span>✨</span>
        <span>{user?.devMode ? <>Dev Mode is on: unlimited AI try-ons</> : user ? <>You have {user.tokens} tokens ready for AI try-on</> : <>Get free tokens on sign up to try AI try-on</>}</span>
        <span>✨</span>
      </div>
      <header className="site-header">
        <div className="wrap header-inner">
          <div className="header-left">
            <a className="brand" href="/">FitLook</a>
            <nav className="nav">
              <a href="/search">Shop</a>
              <a href="/search?gender=men">For Men</a>
              <a href="/search?gender=women">For Women</a>
              <a href="/search?newArrival=true">New Arrivals</a>
              <a href="/how-it-works">How it Works</a>
              <a href="/admin">Admin</a>
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
            {user ? <button className="text-button" onClick={logout}>Log out</button> : <a className="icon-button" href="/login" aria-label="Account"><UserIcon /></a>}
            <button className="icon-button" aria-label="Wishlist"><HeartIcon /></button>
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
          <FooterCol title="Help" links={[['FAQ', '/support'], ['Shipping', '/support'], ['Returns & Exchanges', '/support'], ['Track Order', '/support'], ['Contact Us', '/contact'], ['Admin', '/admin']]} />
          <div className="newsletter"><h3>Join Our Community</h3><p>Subscribe to get new arrivals and token offers.</p><form className="newsletter-form"><input type="email" placeholder="Enter your email" /><button>Sign Up</button></form></div>
        </div>
        <div className="footer-bottom"><div>© 2024 FitLook. All rights reserved.</div><div className="legal"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/accessibility">Accessibility</a></div></div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }) {
  return <div><h3>{title}</h3><ul>{links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}</ul></div>;
}

function Hero({ compact = false }) {
  return (
    <section className="hero">
      <div className="wrap">
        <div className={compact ? 'hero-panel compact' : 'hero-panel'}>
          <img className="hero-bg" src={asset('hero-room.png')} alt="" />
          <div className="hero-card">
            <span className="hero-kicker">AI Try-On</span>
            <h1 className="hero-title">See it on you,<br />before <em>you</em> buy.</h1>
            <p className="hero-copy">Upload once. Try thousands of outfits using AI and shop from top brands.</p>
            <a className="hero-cta" href="/search">Start Trying <span>→</span></a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Home({ user }) {
  const trending = useProducts({ limit: 6 });
  const arrivals = useProducts({ newArrival: 'true', sort: 'newest', limit: 6 });

  return (
    <>
      <Hero />
      <ProductSection title="Trending Now" href="/search" state={trending} user={user} />
      <ProductSection title="New Arrivals" href="/search?newArrival=true" state={arrivals} user={user} />
      <section className="categories"><div className="wrap"><div className="section-head"><h2>Shop by Category</h2></div><div className="category-grid">{categories.map(([label, image, q]) => <a className="category" href={`/search?category=${encodeURIComponent(q)}`} key={label}><img src={asset(image)} alt={label} /><span>{label}</span></a>)}</div></div></section>
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
        {loading && <StatusPanel text="Loading products..." />}
        {error && <StatusPanel text={error} />}
        {!loading && !error && products.length === 0 && <EmptyProducts />}
        {!loading && !error && products.length > 0 && <div className="product-grid">{displayProducts.map((product) => <ProductCard key={product.id} product={product} tryOn={tryOns[product.id]} />)}</div>}
      </div>
    </section>
  );
}

function ProductCard({ product, locked = false, tryOn, canTryOn = false, tryOnLoading = false, tryOnError = '', onTryOn }) {
  const hasDiscount = product.compareAtPrice && product.compareAtPrice > product.price;
  const discount = hasDiscount ? `${Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)}% OFF` : '';
  const image = tryOn?.imageUrl || product.imageUrl || asset('hero-room.png');
  const detailHref = `/product/${encodeURIComponent(product.id)}`;
  const content = (
    <>
      <div className="product-media">
        <img src={image} alt={product.name} />
        {product.badge && <span className="badge">{product.badge}</span>}
        {tryOn?.imageUrl && <span className="badge tryon-badge">AI Try-On</span>}
        {tryOnLoading && <TryOnGenerating />}
        {!locked && <span className="heart"><HeartIcon /></span>}
      </div>
      <div className="product-info">
        <h3 className="product-title">{product.name}</h3>
        <p className="product-brand">{product.brand}</p>
        <p className="rating"><span>★</span> {Number(product.rating || 0).toFixed(1)} {product.ratingCount ? `(${product.ratingCount})` : ''}</p>
        <div className="price-row">
          <span className="price">{formatMoney(product.price || 0, product.currency)}</span>
          {hasDiscount && <span className="was">{formatMoney(product.compareAtPrice, product.currency)}</span>}
          {discount && <span className="off">{discount}</span>}
        </div>
        <div className="swatches">{(product.colors?.length ? product.colors : ['#c7bbae', '#39433e', '#d8ccc6']).slice(0, 4).map((color) => <span style={{ background: color }} key={color} />)}</div>
      </div>
    </>
  );

  return (
    <article className={`product-card ${locked ? 'locked-product' : ''}`}>
      {locked ? <div>{content}</div> : <a className="product-card-link" href={detailHref}>{content}</a>}
      {!locked && canTryOn && (
        <div className="tryon-card-actions">
          <button type="button" onClick={() => onTryOn(product)} disabled={tryOnLoading || Boolean(tryOn?.imageUrl)}>
            {tryOn?.imageUrl ? 'Try-On Ready' : tryOnLoading ? 'Generating...' : 'Try On'}
          </button>
          {tryOnError && <p>{tryOnError}</p>}
        </div>
      )}
      {!locked && product.affiliateLink && <a className="affiliate-cta" href={product.affiliateLink} target="_blank" rel="noreferrer">Shop Brand ↗</a>}
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

function SearchPage({ user, setUser, tryOnMode = false }) {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const brand = params.get('brand') || '';
  const gender = params.get('gender') || '';
  const sort = params.get('sort') || '';
  const newArrival = params.get('newArrival') || '';
  const state = useProducts({ q, category, brand, gender, sort, newArrival, limit: 60 });
  const [tryOns, setTryOns] = useTryOnCache(user, state.products);
  const [tryOnLoading, setTryOnLoading] = useState({});
  const [tryOnErrors, setTryOnErrors] = useState({});
  const [continueWithoutTryOn, setContinueWithoutTryOn] = useState(false);
  const autoTryOnStarted = useRef('');
  const hasSearchIntent = Boolean(q);
  const allowTryOnTrial = Boolean(user) && !continueWithoutTryOn && (tryOnMode || hasSearchIntent);
  const shouldAutoGenerate = Boolean(user) && !continueWithoutTryOn && hasSearchIntent && !tryOnMode;
  const trialProducts = state.products.slice(0, 4);
  const visibleProducts = allowTryOnTrial ? trialProducts : user ? state.products : state.products.slice(0, 4);
  const lockedProducts = allowTryOnTrial ? state.products.slice(4, 12) : user ? [] : state.products.slice(4, 12);
  const title = tryOnMode ? 'AI Try-On' : q || category || brand || gender || (newArrival ? 'New Arrivals' : 'All Products');

  const generateTryOn = async (product) => {
    setTryOnLoading((current) => ({ ...current, [product.id]: true }));
    setTryOnErrors((current) => ({ ...current, [product.id]: '' }));
    try {
      const data = await api(`/tryons/${product.id}`, { method: 'POST' });
      setTryOns((current) => ({ ...current, [product.id]: data.tryOn }));
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
            <form className="toolbar" action="/search">
              <input type="hidden" name="q" value={q} />
              {newArrival && <input type="hidden" name="newArrival" value={newArrival} />}
              <select name="sort" defaultValue={sort} aria-label="Sort products">
                <option value="">Most Relevant</option>
                <option value="newest">Newest</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
              </select>
              <button>Apply</button>
            </form>
          </div>
          {state.loading && <StatusPanel text="Finding products..." />}
          {state.error && <StatusPanel text={state.error} />}
          {!state.loading && !state.error && state.products.length === 0 && <EmptyProducts search={title} />}
          {!state.loading && !state.error && state.products.length > 0 && (
            <div className="product-grid">
              {visibleProducts.map((product, index) => <ProductCard key={product.id} product={product} tryOn={tryOns[product.id]} canTryOn={allowTryOnTrial && index < 4} tryOnLoading={Boolean(tryOnLoading[product.id])} tryOnError={tryOnErrors[product.id]} onTryOn={generateTryOn} />)}
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
        <FilterPanel facets={state.facets} values={{ q, category, brand, gender, sort, newArrival }} />
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

function VtoTrialPage({ user, setUser }) {
  const personRef = useRef(null);
  const garmentRef = useRef(null);
  const [personPreview, setPersonPreview] = useState('');
  const [garmentPreview, setGarmentPreview] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const strictPrompt = [
    'Use the person photo as the only identity reference: keep the same face, eyes, nose, mouth, jawline, hair, skin tone, pose, crop, lighting, and background.',
    'Send preserve_pose=true to the FAL model.',
    'Ignore any model, face, hair, skin, body, pose, or background in the clothing photo.',
    'Transfer the garment color, pattern, texture, neckline, sleeve length, hemline, buttons, logos, seams, and silhouette.',
    'Do not copy, blend, borrow, or average the face from the clothing photo.'
  ].join(' ');

  if (!user) return <AuthPage mode="signup" setUser={setUser} />;

  const previewFile = (event, setter) => {
    const file = event.currentTarget.files?.[0];
    setter(file ? URL.createObjectURL(file) : '');
    setResult(null);
    setMessage('');
  };

  const submit = async (event) => {
    event.preventDefault();
    const person = personRef.current?.files?.[0];
    const garment = garmentRef.current?.files?.[0];
    if (!person || !garment) {
      setMessage('Upload both a person image and a garment image first.');
      return;
    }
    setLoading(true);
    setResult(null);
    setMessage('Running unrestricted FAL virtual try-on trial...');
    try {
      const form = new FormData();
      form.append('person', person);
      form.append('garment', garment);
      form.append('note', note);
      const data = await api('/tryons/vto-trial', { method: 'POST', body: form });
      setResult(data.trial);
      if (data.user) setUser(data.user);
      setMessage(`Trial ready using ${data.trial?.payloadVariant || 'model payload'}.`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="vto-trial-page">
      <section className="wrap vto-trial-hero">
        <p className="kicker">FAL Trial</p>
        <h1>Pose-lock test for virtual try-on.</h1>
        <p className="lead">This page tests <strong>fal-ai/image-apps-v2/virtual-try-on</strong> with a strict prompt. It does not charge tokens or save to the normal product try-on cache.</p>
        <p className="trial-note">Use a clearly adult, fully clothed person photo and a standard garment product photo. FAL can still block underwear, swimwear, transparent clothing, nudity, or heavily cropped body framing.</p>
      </section>

      <section className="wrap vto-trial-shell">
        <form className="vto-trial-panel" onSubmit={submit}>
          <div className="vto-upload-grid">
            <label className="upload-box custom-upload">
              <input ref={personRef} name="person" type="file" accept="image/*" onChange={(event) => previewFile(event, setPersonPreview)} />
              <span><span className="upload-icon">↑</span><span className="upload-title">Upload person photo</span><span className="upload-help">Fully clothed adult photo with the pose to preserve.</span></span>
            </label>
            <label className="upload-box custom-upload">
              <input ref={garmentRef} name="garment" type="file" accept="image/*" onChange={(event) => previewFile(event, setGarmentPreview)} />
              <span><span className="upload-icon">↑</span><span className="upload-title">Upload garment photo</span><span className="upload-help">Use a standard product photo of the clothing item.</span></span>
            </label>
          </div>
          <label className="field"><span>Extra tester note</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional: preserve crossed arms, keep same background..." /></label>
          <div className="vto-prompt-box"><span>Strict prompt focus</span><p>{strictPrompt}</p></div>
          <button className="submit" type="submit" disabled={loading}>{loading ? 'Running Trial...' : 'Run FAL VTO Trial'}</button>
          {message && <p className={`form-message ${result?.imageUrl ? '' : 'error-message'}`}>{message}</p>}
        </form>

        <div className="vto-trial-preview">
          <div className="vto-preview-card">
            <span>Person</span>
            {personPreview ? <img src={personPreview} alt="Person preview" /> : <div>Upload person</div>}
          </div>
          <div className="vto-preview-card">
            <span>Garment</span>
            {garmentPreview ? <img src={garmentPreview} alt="Garment preview" /> : <div>Upload garment</div>}
          </div>
          <div className="vto-preview-card result">
            <span>Generated</span>
            {loading && <TryOnGenerating text="FAL VTO trial is running" />}
            {result?.imageUrl ? (
              <>
                <img src={result.imageUrl} alt="FAL virtual try-on trial result" />
                <button className="fullscreen-button" type="button" aria-label="Open trial image full screen" title="Open full screen" onClick={() => setFullscreenImage({ src: result.imageUrl, alt: 'FAL virtual try-on trial result', title: 'FAL VTO Trial' })}><FullscreenIcon /></button>
              </>
            ) : <div>Generated result</div>}
          </div>
          {result && <div className="vto-debug"><strong>{result.model}</strong><span>payload: {result.payloadVariant}</span><span>preserve_pose: {result.preservePose ? 'true' : 'false'}</span><span>aspect_ratio: {result.aspectRatio}</span><span>keys: {(result.rawKeys || []).join(', ')}</span></div>}
        </div>
      </section>

      {fullscreenImage && <ImageLightbox image={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
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
      const data = await api('/tryons/custom', { method: 'POST', body: form });
      setResult(data.tryOn);
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
          <div className="custom-preview-grid">
            <div className="custom-preview">
              {garmentPreview ? <img src={garmentPreview} alt="Uploaded clothing preview" /> : <span>Garment preview</span>}
            </div>
            <div className="custom-preview result">
              {loading && <TryOnGenerating />}
              {result?.imageUrl ? (
                <>
                  <img src={result.imageUrl} alt="Generated custom try-on" />
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
    setQuery('');
    setBusy(true);
    setRuns((current) => [
      ...current,
      { id, query: prompt, products: [], tryOns: {}, loading: true, generating: {}, errors: {}, searchError: '' }
    ]);

    try {
      const data = await api('/products/amazon-search', {
        method: 'POST',
        body: JSON.stringify({ query: prompt, limit: 2 })
      });
      const products = data.products || [];
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
            <small>{user?.devMode ? 'Dev mode' : `${user?.tokens ?? 0} tokens`}</small>
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
  const tags = (product.tags || []).filter(Boolean).slice(0, 4);
  return (
    <article className="style-result-card">
      <div className="style-result-media">
        <div>
          <span className="style-media-label">Product</span>
          <img src={product.imageUrl || asset('hero-room.png')} alt={product.name} />
        </div>
        <div className="style-generated">
          <span className="style-media-label">On You</span>
          {loading && <TryOnGenerating />}
          {tryOn?.imageUrl ? (
            <>
              <img src={tryOn.imageUrl} alt={`AI try-on for ${product.name}`} />
              <button className="fullscreen-button" type="button" aria-label="Open generated image full screen" title="Open full screen" onClick={() => onFullscreen({ src: tryOn.imageUrl, alt: `AI try-on for ${product.name}`, title: product.name })}><FullscreenIcon /></button>
            </>
          ) : <div className="style-placeholder">Waiting for try-on</div>}
        </div>
      </div>
      <div className="style-result-info">
        <h2>{product.name}</h2>
        <p>{product.brand} · {product.category}</p>
        <p className="rating"><span>★</span> {Number(product.rating || 0).toFixed(1)} {product.ratingCount ? `(${product.ratingCount})` : ''}</p>
        <div className="price-row"><span className="price">{formatMoney(product.price, product.currency)}</span></div>
        {product.description && <p className="style-result-description">{product.description}</p>}
        {tags.length > 0 && <div className="style-result-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        {error && <p className="form-message error-message">{error}</p>}
        <div className="style-result-actions">
          {product.affiliateLink && <a className="button" href={product.affiliateLink} target="_blank" rel="noreferrer">Shop ↗</a>}
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

function TokenPage({ user }) {
  const packs = [
    ['Starter', 10, '$4.99', 'For quick outfit checks.'],
    ['Everyday', 30, '$11.99', 'Best for regular browsing.'],
    ['Studio', 80, '$24.99', 'For heavy try-on sessions.']
  ];

  return (
    <main className="token-page">
      <section className="wrap token-hero">
        <p className="kicker">FitLook Tokens</p>
        <h1>One token, one AI try-on.</h1>
        <p className="lead">Tokens are used only when FitLook generates a new AI try-on image. Cached try-ons for the same product do not charge again.</p>
        <div className="token-balance">{user?.devMode ? <><span>∞</span><strong>dev mode active</strong></> : user ? <><span>{user.tokens}</span><strong>tokens available</strong></> : <><span>4</span><strong>free tokens on signup</strong></>}</div>
      </section>

      <section className="wrap token-grid">
        {packs.map(([name, amount, price, copy]) => (
          <article className="token-pack" key={name}>
            <h2>{name}</h2>
            <p className="token-amount">{amount} tokens</p>
            <p className="token-price">{price}</p>
            <p>{copy}</p>
            <button type="button" disabled>{user ? 'Checkout Coming Soon' : 'Create Account First'}</button>
          </article>
        ))}
      </section>

      <section className="wrap token-rules">
        <article><h3>What costs tokens?</h3><p>{user?.devMode ? 'Dev Mode bypasses token charging for testing.' : 'Generating a product try-on or custom clothing try-on costs 1 token.'}</p></article>
        <article><h3>What is free?</h3><p>Browsing, search, product pages, and viewing previously generated try-ons are free.</p></article>
        <article><h3>Why cache matters</h3><p>If a try-on already exists for the same user and product, FitLook reuses it without charging another token.</p></article>
      </section>
    </main>
  );
}

function FilterPanel({ facets, values }) {
  return (
    <aside className="filters">
      <div className="filter-head"><h2>Filters</h2><a href="/search">Reset</a></div>
      <form className="filter-form" action="/search">
        <input name="q" defaultValue={values.q} placeholder="Search keyword" />
        <select name="category" defaultValue={values.category}>
          <option value="">All categories</option>
          {facets.categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select name="brand" defaultValue={values.brand}>
          <option value="">All brands</option>
          {facets.brands.map((item) => <option key={item} value={item}>{item}</option>)}
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
        <button className="apply">Apply Filters</button>
      </form>
    </aside>
  );
}

function ProductPage({ id, user, setUser }) {
  const { product, loading, error } = useProduct(id);
  const related = useProducts({ category: product?.category || '', limit: 5 });
  const [tryOn, setTryOn] = useState(null);
  const [tryOnLoading, setTryOnLoading] = useState(false);
  const [tryOnError, setTryOnError] = useState('');
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

  if (loading) {
    return <main className="wrap product-page"><StatusPanel text="Loading product..." /></main>;
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
  const image = tryOn?.imageUrl || product.imageUrl || asset('hero-room.png');
  const detailFacts = [
    ['Brand', product.brand],
    ['Category', product.category],
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
        <div className="breadcrumb"><a href="/search">Shop</a><span>/</span><a href={`/search?category=${encodeURIComponent(product.category || '')}`}>{product.category || 'Products'}</a></div>
        <div className="product-detail-grid">
          <div className="product-detail-media">
            <img src={image} alt={product.name} />
            {product.badge && <span className="badge">{product.badge}</span>}
            {tryOn?.imageUrl && <span className="badge tryon-badge">AI Try-On</span>}
            {tryOnLoading && <TryOnGenerating />}
            {tryOn?.imageUrl && product.imageUrl && (
              <div className="original-product-preview">
                <span>Product photo</span>
                <img src={product.imageUrl} alt={`${product.name} product photo`} />
              </div>
            )}
          </div>
          <div className="product-summary">
            <p className="kicker">{product.brand}</p>
            <h1>{product.name}</h1>
            <p className="rating detail-rating"><span>★</span> {Number(product.rating || 0).toFixed(1)} {product.ratingCount ? `(${product.ratingCount} reviews)` : ''}</p>
            <div className="price-row detail-price">
              <span className="price">{formatMoney(product.price || 0, product.currency)}</span>
              {hasDiscount && <span className="was">{formatMoney(product.compareAtPrice, product.currency)}</span>}
              {discount && <span className="off">{discount}</span>}
            </div>
            <p className="product-description">{product.description || 'No product description has been added yet.'}</p>
            <div className="product-meta">
              {product.category && <a href={`/search?category=${encodeURIComponent(product.category)}`}>{product.category}</a>}
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
                {productTags.map((tag) => <a href={`/search?q=${encodeURIComponent(tag)}`} key={tag}>{tag}</a>)}
              </div>
            )}
            <div className="detail-swatches">
              <span>Colors</span>
              <div className="swatches">{(product.colors?.length ? product.colors : ['#c7bbae', '#39433e', '#d8ccc6']).slice(0, 6).map((color) => <span style={{ background: color }} key={color} title={color} />)}</div>
            </div>
            <div className="product-actions">
              {product.affiliateLink && <a className="button" href={product.affiliateLink} target="_blank" rel="noreferrer">Shop Brand ↗</a>}
              {user ? (
                <button className="secondary-button" type="button" onClick={generateProductTryOn} disabled={tryOnLoading || Boolean(tryOn?.imageUrl)}>
                  {tryOn?.imageUrl ? 'Try-On Ready' : tryOnLoading ? 'Generating Try-On...' : 'Generate AI Try-On'}
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
            <div className="section-head"><h2>More in {product.category}</h2><a className="view-all" href={`/search?category=${encodeURIComponent(product.category || '')}`}>View all ›</a></div>
            <div className="product-grid">{relatedProducts.map((item) => <ProductCard key={item.id} product={item} tryOn={relatedTryOns[item.id]} />)}</div>
          </div>
        </section>
      )}
    </main>
  );
}

function AdminPage() {
  const formRef = useRef(null);
  const [adminKey, setAdminKey] = useState(localStorage.getItem('fitlook_admin_key') || '');
  const [message, setMessage] = useState('');
  const [previewImage, setPreviewImage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const state = useProducts({ limit: 96, sort: 'newest', refresh });
  const categoryDistribution = useMemo(() => {
    if (state.facets.categoryCounts?.length) {
      return state.facets.categoryCounts
        .map((item) => ({ category: item.category || 'uncategorized', count: item.count || 0 }))
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    }
    const counts = new Map();
    state.products.forEach((product) => {
      const category = product.category || 'uncategorized';
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }, [state.facets.categoryCounts, state.products]);

  const saveKey = (value) => {
    setAdminKey(value);
    localStorage.setItem('fitlook_admin_key', value);
  };

  const setField = (name, value) => {
    const field = formRef.current?.elements.namedItem(name);
    if (!field || value === undefined || value === null || value === '') return;
    field.value = Array.isArray(value) ? value.join(', ') : value;
  };

  const previewAffiliate = async () => {
    const form = formRef.current;
    const affiliateLink = form?.elements.namedItem('affiliateLink')?.value;
    if (!affiliateLink) {
      setMessage('Paste an affiliate link first.');
      return;
    }
    setMessage('Fetching product details...');
    try {
      const data = await api('/products/preview-link', {
        method: 'POST',
        body: JSON.stringify({ affiliateLink }),
        headers: { 'x-admin-key': adminKey }
      });
      const draft = data.draft || {};
      ['affiliateLink', 'name', 'brand', 'category', 'gender', 'price', 'compareAtPrice', 'currency', 'rating', 'ratingCount', 'description', 'tags', 'remoteImageUrl', 'sourceUrl'].forEach((name) => setField(name, draft[name]));
      if (draft.remoteImageUrl) setPreviewImage(draft.remoteImageUrl);
      setMessage('Draft filled. Review it, adjust anything missing, then save.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('Uploading product...');
    try {
      const form = event.currentTarget;
      await api('/products', { method: 'POST', body: new FormData(form), headers: { 'x-admin-key': adminKey } });
      form.reset();
      setPreviewImage('');
      setMessage('Product uploaded.');
      setRefresh((value) => value + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const removeProduct = async (id) => {
    if (!window.confirm('Remove this product from the catalog?')) return;
    setMessage('Removing product...');
    try {
      await api(`/products/${id}`, { method: 'DELETE', headers: { 'x-admin-key': adminKey } });
      setMessage('Product removed.');
      setRefresh((value) => value + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const updateTryOnModel = async (id, tryOnModel) => {
    setMessage('Updating try-on model...');
    try {
      await api(`/products/${id}/tryon-model`, {
        method: 'PATCH',
        body: JSON.stringify({ tryOnModel }),
        headers: { 'x-admin-key': adminKey }
      });
      setMessage('Try-on model updated.');
      setRefresh((value) => value + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const rebuildCategories = async () => {
    setMessage('Rebuilding product categories...');
    try {
      const data = await api('/products/recategorize', { method: 'POST', headers: { 'x-admin-key': adminKey } });
      setMessage(`Categories rebuilt. Updated ${data.updated || 0} of ${data.checked || 0} products.`);
      setRefresh((value) => value + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <main className="admin-layout wrap">
      <section className="admin-head">
        <div>
          <p className="kicker">Admin Panel</p>
          <h1>Upload real products.</h1>
          <p className="lead">Products added here go straight into MongoDB and appear in home, search, filters, and locked try-on rows.</p>
        </div>
        <label className="field admin-key"><span>Admin key</span><input value={adminKey} onChange={(event) => saveKey(event.target.value)} placeholder="Enter admin key" /></label>
      </section>

      <section className="admin-grid">
        <form className="admin-card admin-form" onSubmit={submit} ref={formRef}>
          <h2>New Product</h2>
          <div className="affiliate-import">
            <label className="field"><span>Affiliate link</span><input name="affiliateLink" type="url" placeholder="https://brand.com/product-page" /></label>
            <button type="button" onClick={previewAffiliate}>Fetch Details</button>
          </div>
          <input name="remoteImageUrl" type="hidden" />
          <input name="sourceUrl" type="hidden" />
          <input name="currency" type="hidden" defaultValue="USD" />
          {previewImage && <div className="link-preview"><img src={previewImage} alt="" /><div><strong>Remote image found</strong><span>This image URL will be linked directly unless you upload another one.</span></div></div>}
          <label className="field"><span>Name</span><input name="name" required placeholder="Linen Blend Shirt" /></label>
          <label className="field"><span>Brand</span><input name="brand" required placeholder="Zara" /></label>
          <div className="two-col">
            <label className="field"><span>Category</span><input name="category" required placeholder="shirts" /></label>
            <label className="field"><span>Gender</span><select name="gender" defaultValue="men"><option value="men">Men</option><option value="women">Women</option><option value="unisex">Unisex</option></select></label>
          </div>
          <div className="two-col">
            <label className="field"><span>Price</span><input name="price" type="number" step="0.01" min="0" required placeholder="29.99" /></label>
            <label className="field"><span>Compare price</span><input name="compareAtPrice" type="number" step="0.01" min="0" placeholder="49.99" /></label>
          </div>
          <div className="two-col">
            <label className="field"><span>Rating</span><input name="rating" type="number" step="0.1" min="0" max="5" defaultValue="4.5" /></label>
            <label className="field"><span>Rating count</span><input name="ratingCount" type="number" min="0" defaultValue="0" /></label>
          </div>
          <label className="field"><span>Badge</span><input name="badge" placeholder="New" /></label>
          <label className="field"><span>Try-on model</span><select name="tryOnModel" defaultValue="gpt-image-2"><option value="gpt-image-2">GPT Image 2</option><option value="vto-unrestricted">FAL VTO unrestricted</option></select></label>
          <label className="field"><span>Description</span><textarea name="description" rows="4" placeholder="Short product description" /></label>
          <label className="field"><span>Tags</span><input name="tags" placeholder="linen, casual, summer" /></label>
          <label className="field"><span>Colors</span><input name="colors" placeholder="#d9c8b4, #123323, white" /></label>
          <label className="upload-box"><input name="image" type="file" accept="image/*" /><span><span className="upload-icon">↑</span><span className="upload-title">Upload product image</span><span className="upload-help">Optional if the affiliate link found an image.</span></span></label>
          <div className="checks">
            <label><input name="isFeatured" type="checkbox" /> Featured</label>
            <label><input name="isNewArrival" type="checkbox" defaultChecked /> New arrival</label>
          </div>
          <button className="submit">Upload Product</button>
          {message && <p className="form-message">{message}</p>}
        </form>

        <section className="admin-card">
          <div className="section-head admin-catalog-head">
            <h2>Catalog</h2>
            <div><button type="button" onClick={rebuildCategories}>Rebuild Categories</button><span className="count">{state.total} active</span></div>
          </div>
          {state.loading && <StatusPanel text="Loading catalog..." />}
          {state.error && <StatusPanel text={state.error} />}
          {!state.loading && !state.error && categoryDistribution.length > 0 && <CategoryDistribution items={categoryDistribution} total={state.total || state.products.length} />}
          {!state.loading && !state.error && state.products.length === 0 && <EmptyProducts />}
          <div className="admin-products">
            {state.products.map((product) => (
              <article className="admin-product" key={product.id}>
                <img src={product.imageUrl || asset('hero-room.png')} alt={product.name} />
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.brand} · {product.category} · {formatMoney(product.price || 0, product.currency)}</p>
                  {product.affiliateLink && <a className="admin-affiliate" href={product.affiliateLink} target="_blank" rel="noreferrer">Affiliate link</a>}
                </div>
                <div className="admin-product-actions">
                  <label>
                    <span>Try-on model</span>
                    <select value={product.tryOnModel || 'gpt-image-2'} onChange={(event) => updateTryOnModel(product.id, event.target.value)}>
                      <option value="gpt-image-2">GPT Image 2</option>
                      <option value="vto-unrestricted">FAL VTO</option>
                    </select>
                  </label>
                  <button type="button" onClick={() => removeProduct(product.id)}>Remove</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function CategoryDistribution({ items, total }) {
  return (
    <div className="category-distribution" aria-label="Category distribution">
      <div className="distribution-head">
        <h3>Category Distribution</h3>
        <span>{total} loaded</span>
      </div>
      <div className="distribution-list">
        {items.map((item) => {
          const percent = total ? Math.round((item.count / total) * 100) : 0;
          return (
            <div className="distribution-item" key={item.category}>
              <div><strong>{item.category}</strong><span>{item.count} products · {percent}%</span></div>
              <div className="distribution-bar"><span style={{ width: `${Math.max(percent, 4)}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPanel({ text }) {
  return <div className="status-panel">{text}</div>;
}

function EmptyProducts({ search }) {
  return (
    <div className="empty-products">
      <h3>No real products yet.</h3>
      <p>{search ? `Nothing matched "${search}". Upload products in the admin panel or try a different search.` : 'Upload products in the admin panel and they will appear here automatically.'}</p>
      <a className="button" href="/admin">Open Admin</a>
    </div>
  );
}

function HowItWorks({ user }) {
  const steps = [
    {
      title: user ? 'Use your profile' : 'Create your profile',
      copy: user ? 'Your account is ready, so you can move straight into browsing products.' : 'Upload one clear standing photo once, then keep using it for try-on previews.'
    },
    {
      title: 'Choose a product',
      copy: 'Open any product from the catalog and review the brand, price, image, colors, and details.'
    },
    {
      title: 'Generate the try-on',
      copy: 'Use tokens to preview how selected pieces look on your profile before leaving FitLook.'
    },
    {
      title: 'Compare and shop',
      copy: 'Shortlist the looks that work, then continue to the brand store when you are ready.'
    }
  ];

  return (
    <main className="how-page">
      <section className="wrap how-hero">
        <p className="kicker">How FitLook Works</p>
        <h1>Four simple steps.</h1>
        <p className="lead">From profile photo to product preview, the whole flow is built around making online shopping feel less like guessing.</p>
        <a className="button" href={user ? '/search' : '/signup'}>{user ? 'Start Shopping' : 'Create Profile'}</a>
      </section>

      <section className="wrap how-steps" aria-label="FitLook steps">
        {steps.map((step, index) => (
          <article className="how-step" key={step.title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h2>{step.title}</h2>
            <p>{step.copy}</p>
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
  const isSignup = mode === 'signup';
  const submit = async (event) => {
    event.preventDefault();
    setMessage('Working...');
    try {
      const form = event.currentTarget;
      const body = isSignup ? new FormData(form) : JSON.stringify(Object.fromEntries(new FormData(form)));
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
            {isSignup && <label className="field"><span>Full name</span><input name="name" required /></label>}
            <label className="field"><span>Email address</span><input name="email" type="email" required /></label>
            <label className="field"><span>Password</span><input name="password" type="password" required minLength="6" /></label>
            {isSignup && <label className="upload-box"><input name="bodyPhoto" type="file" accept="image/*" required /><span><span className="upload-icon">↑</span><span className="upload-title">Upload a clear standing photo</span><span className="upload-help">Front-facing, full-length image with good lighting.</span></span></label>}
            <button className="submit">{isSignup ? 'Create Account' : 'Log In'}</button>
          </form>
          {message && <p className="form-message">{message}</p>}
          <p className="switch">{isSignup ? 'Already have an account?' : 'New to FitLook?'} <a href={isSignup ? '/login' : '/signup'}>{isSignup ? 'Log in' : 'Create an account'}</a></p>
        </div>
        <div className="auth-visual"><img src={asset('hero-room.png')} alt="" /></div>
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
    if (path === '/try-on') return user ? <SearchPage user={user} setUser={setUser} tryOnMode /> : <AuthPage mode="signup" setUser={setUser} />;
    if (path === '/custom-try-on') return <CustomTryOnPage user={user} setUser={setUser} />;
    if (path === '/vto-trial') return <VtoTrialPage user={user} setUser={setUser} />;
    if (path === '/style-bot') return <StyleBotPage user={user} setUser={setUser} />;
    if (path === '/tokens') return <TokenPage user={user} />;
    if (productMatch) return <ProductPage id={decodeURIComponent(productMatch[1])} user={user} setUser={setUser} />;
    if ((path === '/signup' || path === '/login') && user) return <SearchPage user={user} setUser={setUser} />;
    if (path === '/signup') return <AuthPage mode="signup" setUser={setUser} />;
    if (path === '/login') return <AuthPage mode="login" setUser={setUser} />;
    if (path === '/admin') return <AdminPage />;
    if (path === '/how-it-works') return <HowItWorks user={user} />;
    if (pageMeta[path]) return <InfoPage meta={pageMeta[path]} user={user} />;
    return <InfoPage meta={['Not Found', 'This page is not available yet.', 'Use the navigation to continue shopping with FitLook.', 'hero-room.png']} user={user} ctaLabel="Back to Shop" ctaHref="/search" />;
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

export default App;
