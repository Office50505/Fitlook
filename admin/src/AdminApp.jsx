import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

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
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(readableError(data, `Request failed (${res.status})`));
  return data;
}

function mediaUrl(value) {
  if (!value) return '/assets/hero2.png';
  if (/^(?:https?:|data:)/i.test(value)) return value;
  return API_BASE ? `${API_BASE}${value}` : value;
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

function garmentPlacementLabel(value) {
  return value === 'bottom' ? 'Bottom' : 'Top';
}

function inferGarmentPlacement(product = {}) {
  const text = [
    product.name,
    product.category,
    product.description,
    Array.isArray(product.tags) ? product.tags.join(' ') : product.tags
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(pants?|trousers?|jeans?|denim|shorts?|skirts?|leggings?|joggers?|palazzos?|bottoms?|lower)\b/.test(text) ? 'bottom' : 'top';
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

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('en-US').format(number);
}

function formatCompactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

function formatWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number % 1 === 0 ? formatCompactNumber(number) : formatCompactNumber(number.toFixed(1));
}

function formatEventType(value) {
  return String(value || 'signal').replace(/_/g, ' ');
}

function formatSignalDate(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function useProducts(params) {
  const query = useMemo(() => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    return search.toString();
  }, [params]);
  const [state, setState] = useState({
    products: [],
    total: 0,
    facets: { brands: [], categories: [], categoryCounts: [] },
    loading: true,
    error: ''
  });

  useEffect(() => {
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(`/products${query ? `?${query}` : ''}`)
      .then((data) => {
        if (alive) {
          setState({
            products: data.products || [],
            total: data.total || 0,
            facets: data.facets || { brands: [], categories: [], categoryCounts: [] },
            loading: false,
            error: ''
          });
        }
      })
      .catch((err) => {
        if (alive) {
          setState({
            products: [],
            total: 0,
            facets: { brands: [], categories: [], categoryCounts: [] },
            loading: false,
            error: err.message
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [query]);

  return state;
}

function useRecommendationStats(adminKey, refresh) {
  const [state, setState] = useState({ stats: null, loading: false, error: '' });

  useEffect(() => {
    if (!adminKey) {
      setState({ stats: null, loading: false, error: '' });
      return;
    }
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api('/recommendations/admin/stats', { headers: { 'x-admin-key': adminKey } })
      .then((data) => {
        if (alive) setState({ stats: data, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ stats: null, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [adminKey, refresh]);

  return state;
}

function AdminApp() {
  const formRef = useRef(null);
  const [adminKey, setAdminKey] = useState(localStorage.getItem('fitlook_admin_key') || '');
  const [activePage, setActivePage] = useState(() => (window.location.hash === '#stats' ? 'stats' : 'products'));
  const [message, setMessage] = useState('');
  const [previewImage, setPreviewImage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const state = useProducts({ limit: 96, sort: 'newest', refresh });
  const recommendationStats = useRecommendationStats(adminKey, refresh);
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

  useEffect(() => {
    const handleHashChange = () => setActivePage(window.location.hash === '#stats' ? 'stats' : 'products');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const showPage = (page) => {
    setActivePage(page);
    window.history.replaceState(null, '', page === 'stats' ? '#stats' : '#products');
  };

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
      [
        'affiliateLink',
        'name',
        'brand',
        'category',
        'gender',
        'price',
        'compareAtPrice',
        'currency',
        'rating',
        'ratingCount',
        'description',
        'tags',
        'remoteImageUrl',
        'sourceUrl'
      ].forEach((name) => setField(name, draft[name]));
      setField('garmentPlacement', draft.garmentPlacement || inferGarmentPlacement(draft));
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

  const removeAllProducts = async () => {
    if (!state.total) {
      setMessage('There are no active products to remove.');
      return;
    }
    const confirmed = window.confirm(`Remove all ${state.total} active products from the catalog? This will hide them from the storefront.`);
    if (!confirmed) return;
    const secondConfirmed = window.confirm('Please confirm again. This removes every listed product from the active catalog.');
    if (!secondConfirmed) return;
    setMessage('Removing all active products...');
    try {
      const data = await api('/products', { method: 'DELETE', headers: { 'x-admin-key': adminKey } });
      setMessage(`Removed ${data.removed || 0} products from the catalog.`);
      setRefresh((value) => value + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const updateGarmentPlacement = async (id, garmentPlacement) => {
    setMessage('Updating fit area...');
    try {
      await api(`/products/${id}/garment-placement`, {
        method: 'PATCH',
        body: JSON.stringify({ garmentPlacement }),
        headers: { 'x-admin-key': adminKey }
      });
      setMessage('Fit area updated.');
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
    <main className="admin-shell">
      <section className="admin-head">
        <div>
          <p className="kicker">FitLook Admin</p>
          <h1>Catalog operations.</h1>
          <p className="lead">Upload products and review recommendation signals from focused admin pages.</p>
        </div>
        <label className="field admin-key">
          <span>Admin key</span>
          <input value={adminKey} onChange={(event) => saveKey(event.target.value)} placeholder="Enter admin key" />
        </label>
      </section>

      <nav className="admin-tabs" aria-label="Admin pages">
        <button type="button" className={activePage === 'products' ? 'active' : ''} aria-current={activePage === 'products' ? 'page' : undefined} onClick={() => showPage('products')}>
          <span>
            <strong>Product Upload</strong>
            <small>Upload and manage catalog</small>
          </span>
          <em>{formatNumber(state.total || 0)}</em>
        </button>
        <button type="button" className={activePage === 'stats' ? 'active' : ''} aria-current={activePage === 'stats' ? 'page' : undefined} onClick={() => showPage('stats')}>
          <span>
            <strong>Stats</strong>
            <small>Recommendation signals</small>
          </span>
          <em>{formatNumber(recommendationStats.stats?.totals?.events || 0)}</em>
        </button>
      </nav>

      {activePage === 'stats' ? (
        <RecommendationStatsCard state={recommendationStats} onRefresh={() => setRefresh((value) => value + 1)} />
      ) : (
        <>
          <section className="admin-command-bar" aria-label="Catalog actions">
            <div>
              <strong>{state.total || 0} active products</strong>
              <span>{message || 'Catalog tools are ready.'}</span>
            </div>
            <div>
              <button type="button" onClick={rebuildCategories}>Rebuild Categories</button>
              <button className="danger-action" type="button" onClick={removeAllProducts} disabled={state.loading || !state.total}>Remove All</button>
            </div>
          </section>

          <section className="admin-grid">
            <form className="admin-card admin-form" onSubmit={submit} ref={formRef}>
              <div className="card-head">
                <div>
                  <h2>New Product</h2>
                  <p>Import, classify, price, and publish from one place.</p>
                </div>
                <span>{API_BASE || 'Local API proxy'}</span>
              </div>
              <section className="form-section">
                <div className="form-section-title"><strong>Import</strong><span>Start from an affiliate URL or fill manually.</span></div>
                <div className="affiliate-import">
                  <label className="field">
                    <span>Affiliate link</span>
                    <input name="affiliateLink" type="url" placeholder="https://brand.com/product-page" />
                  </label>
                  <button type="button" onClick={previewAffiliate}>Fetch Details</button>
                </div>
              </section>
              <input name="remoteImageUrl" type="hidden" />
              <input name="sourceUrl" type="hidden" />
              <input name="currency" type="hidden" defaultValue="USD" />
              {previewImage && (
                <div className="link-preview">
                  <img src={mediaUrl(previewImage)} alt="" />
                  <div><strong>Remote image found</strong><span>This image URL will be linked directly unless you upload another one.</span></div>
                </div>
              )}
              <section className="form-section">
                <div className="form-section-title"><strong>Product Details</strong><span>Shown on product cards and detail pages.</span></div>
                <label className="field"><span>Name</span><input name="name" required placeholder="Linen Blend Shirt" /></label>
                <label className="field"><span>Brand</span><input name="brand" required placeholder="Zara" /></label>
                <div className="two-col">
                  <label className="field"><span>Category</span><input name="category" required placeholder="shirts" /></label>
                  <label className="field"><span>Gender</span><select name="gender" defaultValue="men"><option value="men">Men</option><option value="women">Women</option><option value="unisex">Unisex</option></select></label>
                </div>
                <fieldset className="segmented-field">
                  <legend>Fit area</legend>
                  <label><input type="radio" name="garmentPlacement" value="top" defaultChecked /><span>Top</span></label>
                  <label><input type="radio" name="garmentPlacement" value="bottom" /><span>Bottom</span></label>
                </fieldset>
                <label className="field"><span>Description</span><textarea name="description" rows="4" placeholder="Short product description" /></label>
              </section>
              <section className="form-section">
                <div className="form-section-title"><strong>Pricing & Signals</strong><span>Used for filtering, recommendation ranking, and merchandising.</span></div>
                <div className="two-col">
                  <label className="field"><span>Price</span><input name="price" type="number" step="0.01" min="0" required placeholder="29.99" /></label>
                  <label className="field"><span>Compare price</span><input name="compareAtPrice" type="number" step="0.01" min="0" placeholder="49.99" /></label>
                </div>
                <div className="two-col">
                  <label className="field"><span>Rating</span><input name="rating" type="number" step="0.1" min="0" max="5" defaultValue="4.5" /></label>
                  <label className="field"><span>Rating count</span><input name="ratingCount" type="number" min="0" defaultValue="0" /></label>
                </div>
                <label className="field"><span>Badge</span><input name="badge" placeholder="New" /></label>
                <label className="field"><span>Tags</span><input name="tags" placeholder="linen, casual, summer" /></label>
                <label className="field"><span>Colors</span><input name="colors" placeholder="#d9c8b4, #123323, white" /></label>
              </section>
              <section className="form-section">
                <div className="form-section-title"><strong>Media & Publish</strong><span>Upload an image only if affiliate fetch did not find one.</span></div>
                <label className="upload-box">
                  <input name="image" type="file" accept="image/*" />
                  <span><span className="upload-icon">+</span><span className="upload-title">Upload product image</span><span className="upload-help">Optional if the affiliate link found an image.</span></span>
                </label>
                <div className="checks">
                  <label><input name="isFeatured" type="checkbox" /> Featured</label>
                  <label><input name="isNewArrival" type="checkbox" defaultChecked /> New arrival</label>
                </div>
              </section>
              <button className="submit">Upload Product</button>
              {message && <p className="form-message">{message}</p>}
            </form>

            <section className="admin-card">
              <div className="section-head admin-catalog-head">
                <h2>Catalog</h2>
                <div>
                  <span className="count">{state.total} active</span>
                </div>
              </div>
              {state.loading && <AdminProductSkeleton />}
              {state.error && <StatusPanel text={state.error} />}
              {!state.loading && !state.error && categoryDistribution.length > 0 && <CategoryDistribution items={categoryDistribution} total={state.total || state.products.length} />}
              {!state.loading && !state.error && state.products.length === 0 && <StatusPanel text="No products yet." />}
              <div className="admin-products">
                {state.products.map((product) => (
                  <article className="admin-product" key={product.id}>
                    <img src={mediaUrl(product.imageUrl)} alt={product.name} />
                    <div>
                      <h3>{product.name}</h3>
                      <p>{displayBrand(product)} - {displayCategory(product)} - {formatMoney(product.price || 0, product.currency)}</p>
                      <div className="product-admin-meta">
                        <span>{garmentPlacementLabel(product.garmentPlacement)}</span>
                        {product.gender && <span>{product.gender}</span>}
                        {product.isNewArrival && <span>New arrival</span>}
                      </div>
                      {product.affiliateLink && <a className="admin-affiliate" href={product.affiliateLink} target="_blank" rel="noreferrer">Affiliate link</a>}
                    </div>
                    <div className="admin-product-actions">
                      <div className="row-segmented" aria-label={`Fit area for ${product.name}`}>
                        <button className={(product.garmentPlacement || 'top') === 'top' ? 'active' : ''} type="button" onClick={() => updateGarmentPlacement(product.id, 'top')}>Top</button>
                        <button className={product.garmentPlacement === 'bottom' ? 'active' : ''} type="button" onClick={() => updateGarmentPlacement(product.id, 'bottom')}>Bottom</button>
                      </div>
                      <button type="button" onClick={() => removeProduct(product.id)}>Remove</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>
        </>
      )}
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
              <div><strong>{item.category}</strong><span>{item.count} products - {percent}%</span></div>
              <div className="distribution-bar"><span style={{ width: `${Math.max(percent, 4)}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationStatsCard({ state, onRefresh }) {
  const stats = state.stats;
  const totals = stats?.totals || {};
  const eventCounts = stats?.eventCounts || [];
  const topProducts = stats?.topProducts || [];
  const topCategories = stats?.topCategories || [];
  const topBrands = stats?.topBrands || [];
  const topTags = stats?.topTags || [];
  const topGenders = stats?.topGenders || [];
  const recentEvents = stats?.recentEvents || [];
  const topEvent = eventCounts[0];
  const topProduct = topProducts[0];
  const topCategory = topCategories[0];

  return (
    <section className="admin-card recommendation-card">
      <div className="section-head">
        <div>
          <h2>Recommendation Signals</h2>
          <p>Searches, clicks, try-ons, shop clicks, and profile weights.</p>
        </div>
        <button type="button" onClick={onRefresh}>Refresh Stats</button>
      </div>
      {state.loading && <StatusPanel text="Loading recommendation stats..." />}
      {state.error && <StatusPanel text={state.error} />}
      {!state.loading && !state.error && !stats && <StatusPanel text="Enter the admin key to load recommendation stats." />}
      {stats && (
        <>
          <div className="stats-grid">
            <StatBox label="Events" value={formatNumber(totals.events || 0)} meta={`${eventCounts.length || 0} signal types`} />
            <StatBox label="Active users 30d" value={formatNumber(totals.activeUsers30d || 0)} meta="recent personalization traffic" />
            <StatBox label="Profiles" value={formatNumber(totals.preferenceProfiles || 0)} meta="saved preference profiles" />
            <StatBox label="Avg price intent" value={totals.averagePreferredPrice ? formatMoney(totals.averagePreferredPrice, 'INR') : '-'} meta="weighted by user behavior" />
          </div>
          <div className="recommendation-overview">
            <div className="signal-spotlight">
              <div>
                <span>Leading signal</span>
                <strong>{topEvent ? formatEventType(topEvent.type) : 'No activity yet'}</strong>
                <p>{topEvent ? `${formatNumber(topEvent.count)} events with ${formatWeight(topEvent.weight)} weighted impact.` : 'Recommendation tracking will appear here once users interact with products.'}</p>
              </div>
              <div>
                <span>Strongest category</span>
                <strong>{topCategory?.label || 'No category yet'}</strong>
                <p>{topCategory ? `${formatWeight(topCategory.weight)} weighted preference score.` : 'Category affinities need more user activity.'}</p>
              </div>
              <div>
                <span>Top product</span>
                <strong>{topProduct?.name || 'No product yet'}</strong>
                <p>{topProduct ? `${displayBrand(topProduct)} - ${displayCategory(topProduct)} - ${formatNumber(topProduct.count)} events.` : 'Product-level winners will appear after clicks, try-ons, and shop taps.'}</p>
              </div>
            </div>
            <StatsList
              title="Event Mix"
              items={eventCounts.map((item) => ({
                label: formatEventType(item.type),
                value: item.count,
                meta: `${formatWeight(item.weight)} weighted impact`
              }))}
              valueLabel={(value) => formatNumber(value)}
            />
          </div>
          <div className="stats-columns">
            <StatsList title="Top Categories" items={topCategories.map((item) => ({ label: item.label, value: item.weight }))} />
            <StatsList title="Top Brands" items={topBrands.map((item) => ({ label: item.label, value: item.weight }))} />
            <StatsList title="Top Tags" items={topTags.map((item) => ({ label: item.label, value: item.weight }))} />
            <StatsList title="Audience" items={topGenders.map((item) => ({ label: item.label, value: item.weight }))} />
          </div>
          <div className="stats-columns two">
            <TopProductsList items={topProducts} />
            <RecentSignalsList items={recentEvents} />
          </div>
        </>
      )}
    </section>
  );
}

function StatBox({ label, value, meta }) {
  return <div className="stat-box"><span>{label}</span><strong>{value}</strong>{meta && <em>{meta}</em>}</div>;
}

function StatsList({ title, items = [], valueLabel = formatWeight }) {
  const visibleItems = items.slice(0, 8);
  const maxValue = Math.max(...visibleItems.map((item) => Number(item.value) || 0), 1);

  return (
    <div className="stats-list">
      <h3>{title}</h3>
      {visibleItems.length === 0 ? <p>No data yet.</p> : visibleItems.map((item) => (
        <div className="stats-row" key={`${title}-${item.label}-${item.value}`}>
          <div className="stats-row-main">
            <div><strong>{item.label}</strong>{item.meta && <span>{item.meta}</span>}</div>
            <b>{valueLabel(item.value)}</b>
          </div>
          <div className="stats-row-bar" aria-hidden="true"><span style={{ width: `${Math.max(6, Math.round(((Number(item.value) || 0) / maxValue) * 100))}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function TopProductsList({ items = [] }) {
  const visibleItems = items.slice(0, 6);
  const maxValue = Math.max(...visibleItems.map((item) => Number(item.weight) || 0), 1);

  return (
    <div className="stats-list top-products-list">
      <h3>Top Products</h3>
      {visibleItems.length === 0 ? <p>No data yet.</p> : visibleItems.map((item, index) => {
        const percent = Math.max(6, Math.round(((Number(item.weight) || 0) / maxValue) * 100));
        return (
          <div className="top-product-card" key={`${item.id || item.name}-${index}`}>
            <span>{index + 1}</span>
            <div>
              <strong>{item.name}</strong>
              <em>{displayBrand(item)} - {displayCategory(item)} - {formatNumber(item.count || 0)} events</em>
              <div className="stats-row-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
            </div>
            <b>{formatWeight(item.weight)}</b>
          </div>
        );
      })}
    </div>
  );
}

function RecentSignalsList({ items = [] }) {
  const visibleItems = items.slice(0, 8);

  return (
    <div className="stats-list recent-signals-list">
      <h3>Recent Signals</h3>
      {visibleItems.length === 0 ? <p>No data yet.</p> : visibleItems.map((item) => (
        <div className="recent-signal" key={item.id || `${item.type}-${item.createdAt}`}>
          <div>
            <strong>{item.product?.name || item.query || formatEventType(item.type)}</strong>
            <span>{formatEventType(item.type)} - {formatSignalDate(item.createdAt)}</span>
          </div>
          <b>{formatWeight(item.weight)}</b>
        </div>
      ))}
    </div>
  );
}

function AdminProductSkeleton() {
  return (
    <div className="admin-products admin-products-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <article className="admin-product" key={index}>
          <span className="admin-skeleton-thumb" />
          <div>
            <span className="admin-skeleton-line wide" />
            <span className="admin-skeleton-line medium" />
          </div>
          <span className="admin-skeleton-action" />
        </article>
      ))}
    </div>
  );
}

function StatusPanel({ text }) {
  return <div className="status-panel">{text}</div>;
}

export default AdminApp;
