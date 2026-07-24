import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STORE_BASE = (import.meta.env.VITE_STORE_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const ADMIN_SESSION_KEY = 'fitlook_admin_session';

function storedAdminSession() {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || 'null');
  } catch {
    return null;
  }
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
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  const session = storedAdminSession();
  const authHeaders = session?.token ? { Authorization: `Bearer ${session.token}` } : {};
  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers: { ...headers, ...authHeaders, ...options.headers } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(readableError(data, `Request failed (${res.status})`));
  return data;
}

function mediaUrl(value) {
  if (!value) return '/assets/hero2.png';
  if (/^(?:https?:|data:)/i.test(value)) return value;
  return API_BASE ? `${API_BASE}${value}` : value;
}

function productPublicUrl(productOrId) {
  const id = typeof productOrId === 'string' ? productOrId : productOrId?.id;
  return `${STORE_BASE}/product/${encodeURIComponent(id || '')}`;
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

function formatCatalogDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function productQaFlags(product, duplicateFlags = []) {
  const flags = [...duplicateFlags];
  if (!product.affiliateLink && !product.sourceUrl) flags.push('Missing source');
  if (!product.tags?.length) flags.push('No tags');
  if (!product.colors?.length) flags.push('No colors');
  if (!product.compareAtPrice) flags.push('No compare price');
  if (!Number(product.ratingCount)) flags.push('No rating count');
  if (/brand unavailable|marketplace brand/i.test(product.brand || '')) flags.push('Generic brand');
  if ((product.category || '').toLowerCase() === 'clothing') flags.push('Broad category');
  return flags;
}

function fieldValue(form, name) {
  return form.elements.namedItem(name)?.value ?? '';
}

function checkedValue(form, name) {
  return Boolean(form.elements.namedItem(name)?.checked);
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

function useRecommendationStats(enabled, refresh) {
  const [state, setState] = useState({ stats: null, loading: false, error: '' });

  useEffect(() => {
    if (!enabled) {
      setState({ stats: null, loading: false, error: '' });
      return;
    }
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api('/recommendations/admin/stats')
      .then((data) => {
        if (alive) setState({ stats: data, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ stats: null, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [enabled, refresh]);

  return state;
}

function useSystemHealth(enabled, refresh) {
  const [state, setState] = useState({ health: null, loading: false, error: '' });

  useEffect(() => {
    if (!enabled) {
      setState({ health: null, loading: false, error: '' });
      return;
    }
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api('/health')
      .then((data) => {
        if (alive) setState({ health: data, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ health: null, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [enabled, refresh]);

  return state;
}

function useAdminUsers(enabled, refresh, search = '') {
  const [state, setState] = useState({ users: [], totals: { users: 0, loaded: 0, tokens: 0 }, loading: false, error: '' });

  useEffect(() => {
    if (!enabled) {
      setState({ users: [], totals: { users: 0, loaded: 0, tokens: 0 }, loading: false, error: '' });
      return;
    }
    let alive = true;
    const query = new URLSearchParams({ limit: '120' });
    if (search.trim()) query.set('q', search.trim());
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(`/auth/admin/users?${query.toString()}`)
      .then((data) => {
        if (alive) setState({ users: data.users || [], totals: data.totals || { users: 0, loaded: 0, tokens: 0 }, loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ users: [], totals: { users: 0, loaded: 0, tokens: 0 }, loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [enabled, refresh, search]);

  return state;
}

function useAdminOperations(enabled, refresh) {
  const [state, setState] = useState({ orders: [], orderTotals: {}, auditLogs: [], loading: false, error: '' });

  useEffect(() => {
    if (!enabled) {
      setState({ orders: [], orderTotals: {}, auditLogs: [], loading: false, error: '' });
      return;
    }
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    api('/auth/admin/operations')
      .then((data) => {
        if (alive) setState({ orders: data.orders || [], orderTotals: data.orderTotals || {}, auditLogs: data.auditLogs || [], loading: false, error: '' });
      })
      .catch((err) => {
        if (alive) setState({ orders: [], orderTotals: {}, auditLogs: [], loading: false, error: err.message });
      });
    return () => {
      alive = false;
    };
  }, [enabled, refresh]);

  return state;
}

const ADMIN_PAGES = [
  { id: 'overview', label: 'Overview' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'users', label: 'Users' },
  { id: 'settings', label: 'Settings' }
];

const PAGE_COPY = {
  overview: {
    kicker: 'Home',
    title: 'Overview',
    lead: 'See what is happening today: products, users, tokens, and items that need a quick fix.'
  },
  inventory: {
    kicker: 'Products',
    title: 'Inventory',
    lead: 'Add, edit, and review the products shown on the FitLook website.'
  },
  analytics: {
    kicker: 'Reports',
    title: 'Analytics',
    lead: 'See what users are doing and which products are getting attention.'
  },
  users: {
    kicker: 'Customers',
    title: 'Users',
    lead: 'Find users, check their token balance, and add or set tokens when needed.'
  },
  settings: {
    kicker: 'Setup',
    title: 'Settings',
    lead: 'Check system status, admin access, and your current login.'
  },
  'add-product': {
    kicker: 'Products',
    title: 'Add Product',
    lead: 'Create one new product from a link, review it, and publish it.'
  }
};

function pageFromHash() {
  const value = window.location.hash.replace(/^#/, '');
  if (value === 'add-product') return value;
  return ADMIN_PAGES.some((page) => page.id === value) ? value : 'overview';
}

function AdminApp() {
  const formRef = useRef(null);
  const [adminSession, setAdminSession] = useState(() => storedAdminSession());
  const [adminKey, setAdminKey] = useState('');
  const [activePage, setActivePage] = useState(pageFromHash);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [message, setMessage] = useState('');
  const [previewImage, setPreviewImage] = useState('');
  const [editingProduct, setEditingProduct] = useState(null);
  const [editMessage, setEditMessage] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userRefresh, setUserRefresh] = useState(0);
  const [operationsRefresh, setOperationsRefresh] = useState(0);
  const [tokenDrafts, setTokenDrafts] = useState({});
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [filters, setFilters] = useState({
    q: '',
    category: '',
    brand: '',
    gender: '',
    status: '',
    sort: 'newest'
  });
  const [refresh, setRefresh] = useState(0);
  const productParams = useMemo(() => ({
    limit: 96,
    sort: filters.sort,
    q: filters.q.trim(),
    category: filters.category,
    brand: filters.brand,
    gender: filters.gender,
    featured: filters.status === 'featured' ? 'true' : '',
    newArrival: filters.status === 'newArrival' ? 'true' : '',
    refresh
  }), [filters, refresh]);
  const state = useProducts(productParams);
  const recommendationStats = useRecommendationStats(Boolean(adminSession?.token), refresh);
  const systemHealth = useSystemHealth(Boolean(adminSession?.token), refresh);
  const usersState = useAdminUsers(Boolean(adminSession?.token), userRefresh, userSearch);
  const operationsState = useAdminOperations(Boolean(adminSession?.token), operationsRefresh);
  const duplicateWarnings = useMemo(() => {
    const counts = new Map();
    const remember = (type, value) => {
      const key = String(value || '').trim().toLowerCase();
      if (!key) return;
      counts.set(`${type}:${key}`, (counts.get(`${type}:${key}`) || 0) + 1);
    };
    state.products.forEach((product) => {
      remember('affiliate', product.affiliateLink);
      remember('source', product.sourceUrl);
      remember('image', product.imageUrl);
    });
    const warnings = new Map();
    state.products.forEach((product) => {
      const flags = [];
      if (product.affiliateLink && counts.get(`affiliate:${String(product.affiliateLink).trim().toLowerCase()}`) > 1) flags.push('Duplicate link');
      if (product.sourceUrl && counts.get(`source:${String(product.sourceUrl).trim().toLowerCase()}`) > 1) flags.push('Duplicate source');
      if (product.imageUrl && counts.get(`image:${String(product.imageUrl).trim().toLowerCase()}`) > 1) flags.push('Duplicate image');
      if (flags.length) warnings.set(product.id, flags);
    });
    return warnings;
  }, [state.products]);
  const reviewItems = useMemo(() => state.products
    .map((product) => ({ product, flags: productQaFlags(product, duplicateWarnings.get(product.id) || []) }))
    .filter((item) => item.flags.length), [duplicateWarnings, state.products]);
  const selectedProducts = useMemo(() => state.products.filter((product) => selectedIds.has(product.id)), [selectedIds, state.products]);
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
  const pageCopy = PAGE_COPY[activePage] || PAGE_COPY.overview;

  useEffect(() => {
    const handleHashChange = () => setActivePage(pageFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [productParams]);

  const showPage = (page) => {
    setActivePage(page);
    window.history.replaceState(null, '', `#${page}`);
  };

  const openProductFromSearch = (product) => {
    setFilters((current) => ({ ...current, q: product.name || '', sort: 'newest' }));
    showPage('inventory');
  };

  const openUserFromSearch = (user) => {
    setUserSearch(user.email || user.username || user.name || '');
    showPage('users');
  };

  const openCreateProduct = () => {
    showPage('add-product');
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const completeLogin = (session) => {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
    setAdminSession(session);
    setAdminKey('');
  };

  const logout = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    setAdminSession(null);
    setAdminKey('');
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
      setOperationsRefresh((value) => value + 1);
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
      setOperationsRefresh((value) => value + 1);
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
      setOperationsRefresh((value) => value + 1);
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
      setOperationsRefresh((value) => value + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const clearFilters = () => {
    setFilters({ q: '', category: '', brand: '', gender: '', status: '', sort: 'newest' });
  };

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      if (state.products.length && state.products.every((product) => current.has(product.id))) return new Set();
      return new Set(state.products.map((product) => product.id));
    });
  };

  const bulkPatch = async (updates, label) => {
    if (!selectedIds.size) {
      setMessage('Select products first.');
      return;
    }
    setMessage(`${label}...`);
    const results = await Promise.allSettled([...selectedIds].map((id) => api(`/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      headers: { 'x-admin-key': adminKey }
    })));
    const failed = results.filter((result) => result.status === 'rejected');
    setMessage(failed.length ? `${label} finished with ${failed.length} failed updates.` : `${label} complete for ${selectedIds.size} products.`);
    setSelectedIds(new Set());
    setRefresh((value) => value + 1);
    setOperationsRefresh((value) => value + 1);
  };

  const bulkRemove = async () => {
    if (!selectedIds.size) {
      setMessage('Select products first.');
      return;
    }
    if (!window.confirm(`Remove ${selectedIds.size} selected products from the active catalog?`)) return;
    setMessage('Removing selected products...');
    const results = await Promise.allSettled([...selectedIds].map((id) => api(`/products/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey }
    })));
    const failed = results.filter((result) => result.status === 'rejected');
    setMessage(failed.length ? `Removed selected products with ${failed.length} failures.` : `Removed ${selectedIds.size} selected products.`);
    setSelectedIds(new Set());
    setRefresh((value) => value + 1);
    setOperationsRefresh((value) => value + 1);
  };

  const openEditor = (product) => {
    setEditingProduct(product);
    setEditMessage('');
  };

  const closeEditor = () => {
    setEditingProduct(null);
    setEditMessage('');
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!editingProduct) return;
    const form = event.currentTarget;
    const payload = {
      name: fieldValue(form, 'name'),
      brand: fieldValue(form, 'brand'),
      category: fieldValue(form, 'category'),
      gender: fieldValue(form, 'gender'),
      garmentPlacement: fieldValue(form, 'garmentPlacement'),
      price: fieldValue(form, 'price'),
      compareAtPrice: fieldValue(form, 'compareAtPrice'),
      currency: fieldValue(form, 'currency'),
      rating: fieldValue(form, 'rating'),
      ratingCount: fieldValue(form, 'ratingCount'),
      badge: fieldValue(form, 'badge'),
      tags: fieldValue(form, 'tags'),
      colors: fieldValue(form, 'colors'),
      description: fieldValue(form, 'description'),
      affiliateLink: fieldValue(form, 'affiliateLink'),
      sourceUrl: fieldValue(form, 'sourceUrl'),
      remoteImageUrl: fieldValue(form, 'remoteImageUrl'),
      tryOnModel: fieldValue(form, 'tryOnModel'),
      isFeatured: checkedValue(form, 'isFeatured'),
      isNewArrival: checkedValue(form, 'isNewArrival')
    };
    setSavingEdit(true);
    setEditMessage('Saving product...');
    try {
      const data = await api(`/products/${editingProduct.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
        headers: { 'x-admin-key': adminKey }
      });
      setEditingProduct(data.product || null);
      setEditMessage('Product saved.');
      setMessage('Product saved.');
      setRefresh((value) => value + 1);
      setOperationsRefresh((value) => value + 1);
    } catch (err) {
      setEditMessage(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const rebuildCategories = async () => {
    setMessage('Rebuilding product categories...');
    try {
      const data = await api('/products/recategorize', { method: 'POST', headers: { 'x-admin-key': adminKey } });
      setMessage(`Categories rebuilt. Updated ${data.updated || 0} of ${data.checked || 0} products.`);
      setRefresh((value) => value + 1);
      setOperationsRefresh((value) => value + 1);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const setTokenDraft = (userId, value) => {
    setTokenDrafts((current) => ({ ...current, [userId]: value }));
  };

  const updateUserTokens = async (userId, mode) => {
    const amount = Number(tokenDrafts[userId]);
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      setMessage('Enter a whole token amount first.');
      return;
    }
    setMessage(mode === 'add' ? 'Adding tokens...' : 'Updating token balance...');
    try {
      await api(`/auth/admin/users/${userId}/tokens`, {
        method: 'PATCH',
        body: JSON.stringify({ mode, amount })
      });
      setTokenDrafts((current) => ({ ...current, [userId]: '' }));
      setUserRefresh((value) => value + 1);
      setOperationsRefresh((value) => value + 1);
      setMessage(mode === 'add' ? `Added ${amount} tokens.` : `Set balance to ${amount} tokens.`);
    } catch (err) {
      setMessage(err.message);
    }
  };

  if (!adminSession?.token) return <AdminLogin onLogin={completeLogin} />;

  return (
    <main className="admin-shell">
      <div className={`admin-frame ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className="admin-sidebar" aria-label="Admin navigation">
          <div className="sidebar-brand-row">
            <div className="sidebar-brand">
              <strong>FitLook</strong>
              <span>Admin</span>
            </div>
            <button
              className="sidebar-toggle"
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? '>' : '<'}
            </button>
          </div>
          <button className="sidebar-create" type="button" onClick={openCreateProduct}>
            <b>+</b>
            <span>Add Product</span>
          </button>
          <nav className="sidebar-nav" aria-label="Admin pages">
            {ADMIN_PAGES.map((page) => (
              <button
                key={page.id}
                type="button"
                className={activePage === page.id ? 'active' : ''}
                aria-current={activePage === page.id ? 'page' : undefined}
                onClick={() => showPage(page.id)}
              >
                <b aria-hidden="true"><SidebarIcon id={page.id} /></b>
                <span>{page.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-session">
            <span>{adminSession.admin?.email || 'Admin'}</span>
            <button type="button" onClick={logout}>Logout</button>
          </div>
        </aside>
        <section className="admin-workspace">
          <header className="admin-topbar">
            <div className="admin-brand">
              <span>FitLook</span>
              <strong>Admin</strong>
            </div>
            <div className="admin-topline">
              <span>{pageCopy.title}</span>
              <span>{message || 'Ready'}</span>
            </div>
            <GlobalAdminSearch
              value={globalSearch}
              onChange={setGlobalSearch}
              products={state.products}
              users={usersState.users}
              onProduct={openProductFromSearch}
              onUser={openUserFromSearch}
              onPage={showPage}
            />
            <div className="admin-profile">
              <span>{adminSession.admin?.email || 'Admin'}</span>
              <button type="button" onClick={logout}>Logout</button>
            </div>
          </header>

          <section className="admin-head">
            <div>
              <p className="kicker">{pageCopy.kicker}</p>
              <h1>{pageCopy.title}</h1>
              <p className="lead">{pageCopy.lead}</p>
            </div>
            <div className="hero-actions">
              <button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
              <button type="button" onClick={rebuildCategories}>Rebuild Categories</button>
              <button className="primary-action" type="button" onClick={openCreateProduct}>Add Product</button>
            </div>
          </section>

          {activePage === 'inventory' && <section className="overview-grid" aria-label="Admin summary">
            <StatBox label="Active products" value={formatNumber(state.total || 0)} meta={`${state.facets.categories?.length || 0} categories`} />
            <StatBox label="Need fixes" value={formatNumber(reviewItems.length)} meta="missing details or duplicates" />
            <StatBox label="User actions" value={formatNumber(recommendationStats.stats?.totals?.events || 0)} meta="clicks, searches, and try-ons" />
            <StatBox label="Users 30d" value={formatNumber(recommendationStats.stats?.totals?.activeUsers30d || 0)} meta="active in the last month" />
          </section>}

          {activePage === 'overview' && (
            <OverviewWorkspace
              products={state.products}
              totalProducts={state.total || 0}
              facets={state.facets}
              reviewItems={reviewItems}
              recommendationStats={recommendationStats.stats}
              usersState={usersState}
              operationsState={operationsState}
              onOpenInventory={() => showPage('inventory')}
              onOpenAnalytics={() => showPage('analytics')}
              onOpenUsers={() => showPage('users')}
              onAddProduct={openCreateProduct}
              onRebuildCategories={rebuildCategories}
            />
          )}

          {activePage === 'inventory' && <section className="admin-command-bar" aria-label="Catalog actions">
            <div>
              <strong>{state.total || 0} active products</strong>
              <span>{message || 'Product tools are ready.'}</span>
            </div>
            <div>
              <button type="button" onClick={rebuildCategories}>Rebuild Categories</button>
              <button className="danger-action" type="button" onClick={removeAllProducts} disabled={state.loading || !state.total}>Remove All</button>
            </div>
          </section>}

          {(activePage === 'inventory' || activePage === 'add-product') && <section className={`admin-grid ${activePage === 'add-product' ? 'create-grid' : 'inventory-grid'}`}>
            <form className="admin-card admin-form" onSubmit={submit} ref={formRef}>
              <div className="card-head">
                <div>
                  <h2>Create Product</h2>
                  <p>Fetch a draft, review the details, and publish to the catalog.</p>
                </div>
                <span>Draft to publish</span>
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
                <div className="form-section-title"><strong>Price and Tags</strong><span>Used for filters, product cards, and sorting.</span></div>
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

            <section className="admin-card catalog-panel">
              <div className="section-head admin-catalog-head">
                <div>
                  <h2>Catalog</h2>
                  <p>{state.total} active products matching the current view.</p>
                </div>
                <div className="catalog-head-actions">
                  <span className="count">{state.products.length} loaded</span>
                  <button type="button" onClick={toggleAllVisible} disabled={!state.products.length}>
                    {state.products.length && state.products.every((product) => selectedIds.has(product.id)) ? 'Clear Selection' : 'Select Visible'}
                  </button>
                </div>
              </div>
              <CatalogFilters filters={filters} facets={state.facets} onChange={updateFilter} onClear={clearFilters} />
              <QaSummary items={reviewItems} />
              <BulkActionBar
                selectedProducts={selectedProducts}
                onFeature={() => bulkPatch({ isFeatured: true }, 'Marking selected as featured')}
                onUnfeature={() => bulkPatch({ isFeatured: false }, 'Removing featured flag')}
                onNewArrival={() => bulkPatch({ isNewArrival: true }, 'Marking selected as new arrivals')}
                onClearNewArrival={() => bulkPatch({ isNewArrival: false }, 'Clearing new arrival flag')}
                onRemove={bulkRemove}
              />
              {state.loading && <AdminProductSkeleton />}
              {state.error && <StatusPanel text={state.error} />}
              {!state.loading && !state.error && state.products.length === 0 && <StatusPanel text="No products yet." />}
              {!state.loading && !state.error && state.products.length > 0 && <CatalogTableHeader />}
              <div className="admin-products">
                {state.products.map((product) => (
                  <AdminProductRow
                    key={product.id}
                    product={product}
                    selected={selectedIds.has(product.id)}
                    qaFlags={productQaFlags(product, duplicateWarnings.get(product.id) || [])}
                    onSelect={() => toggleSelected(product.id)}
                    onEdit={() => openEditor(product)}
                    onPlacement={updateGarmentPlacement}
                    onRemove={removeProduct}
                  />
                ))}
              </div>
            </section>
          </section>}

          {activePage === 'analytics' && (
            <RecommendationStatsCard
              state={recommendationStats}
              onRefresh={() => setRefresh((value) => value + 1)}
              categoryDistribution={categoryDistribution}
              categoryTotal={state.total || state.products.length}
            />
          )}

          {activePage === 'users' && (
            <UsersTokenPage
              state={usersState}
              search={userSearch}
              operationsState={operationsState}
              tokenDrafts={tokenDrafts}
              onSearch={setUserSearch}
              onDraftChange={setTokenDraft}
              onUpdateTokens={updateUserTokens}
              onRefresh={() => setUserRefresh((value) => value + 1)}
            />
          )}

          {activePage === 'settings' && (
            <section className="settings-grid">
              <SystemHealthPanel
                systemHealth={systemHealth}
                catalogState={state}
                recommendationState={recommendationStats}
                adminSession={adminSession}
              />
              <AuditLogPanel operationsState={operationsState} onRefresh={() => setOperationsRefresh((value) => value + 1)} />
              <section className="admin-card settings-panel">
                <div className="section-head">
                  <div>
                    <h2>Admin Access</h2>
                    <p>Only approved Gmail accounts with the admin key can log in.</p>
                  </div>
                </div>
                <div className="settings-summary-card">
                  <span>Current admin</span>
                  <strong>{adminSession.admin?.email || 'Admin'}</strong>
                  <p>You are signed in on this browser.</p>
                </div>
                <div className="settings-list">
                  <div><span>Allowlist</span><strong>server/config/admin-access.json</strong></div>
                  <div><span>Login rule</span><strong>Approved Gmail + admin key</strong></div>
                  <div><span>Session duration</span><strong>12 hours</strong></div>
                </div>
              </section>
              <section className="admin-card settings-panel">
                <div className="section-head">
                  <div>
                    <h2>Current Login</h2>
                    <p>Refresh data or sign out from this browser.</p>
                  </div>
                </div>
                <div className="settings-actions">
                  <button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh Data</button>
                  <button type="button" onClick={() => showPage('inventory')}>Open Inventory</button>
                  <button className="danger-action" type="button" onClick={logout}>Logout</button>
                </div>
              </section>
            </section>
          )}

          {editingProduct && <ProductEditor product={editingProduct} message={editMessage} saving={savingEdit} onClose={closeEditor} onSubmit={submitEdit} />}
        </section>
      </div>
    </main>
  );
}

function SidebarIcon({ id }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    focusable: 'false'
  };
  if (id === 'overview') {
    return (
      <svg {...common}>
        <path d="M4 11l8-7 8 7" />
        <path d="M6 10v9h12v-9" />
        <path d="M10 19v-5h4v5" />
      </svg>
    );
  }
  if (id === 'inventory') {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M6 7l1 12h10l1-12" />
        <path d="M9 11h6" />
        <path d="M9 15h4" />
      </svg>
    );
  }
  if (id === 'analytics') {
    return (
      <svg {...common}>
        <path d="M5 19V9" />
        <path d="M12 19V5" />
        <path d="M19 19v-7" />
        <path d="M3 19h18" />
      </svg>
    );
  }
  if (id === 'users') {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
        <circle cx="9.5" cy="7" r="4" />
        <path d="M20 8v6" />
        <path d="M17 11h6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7A2 2 0 1 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z" />
    </svg>
  );
}

function GlobalAdminSearch({ value, onChange, products, users, onProduct, onUser, onPage }) {
  const query = value.trim().toLowerCase();
  const productResults = query ? products
    .filter((product) => [product.name, product.brand, product.category].some((field) => String(field || '').toLowerCase().includes(query)))
    .slice(0, 4) : [];
  const userResults = query ? users
    .filter((user) => [user.name, user.email, user.username].some((field) => String(field || '').toLowerCase().includes(query)))
    .slice(0, 4) : [];
  const pageResults = query ? ADMIN_PAGES.filter((page) => page.label.toLowerCase().includes(query)).slice(0, 3) : [];
  const hasResults = query && (productResults.length || userResults.length || pageResults.length);
  const choose = (handler, item) => {
    handler(item);
    onChange('');
  };

  return (
    <div className="global-search">
      <label>
        <span>Search admin</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Search products, users, pages..." />
      </label>
      {hasResults ? (
        <div className="global-search-results">
          {productResults.map((product) => (
            <button type="button" key={`product-${product.id}`} onClick={() => choose(onProduct, product)}>
              <strong>{product.name}</strong>
              <span>Product - {displayBrand(product)} - {displayCategory(product)}</span>
            </button>
          ))}
          {userResults.map((user) => (
            <button type="button" key={`user-${user.id}`} onClick={() => choose(onUser, user)}>
              <strong>{user.name || user.email}</strong>
              <span>User - {user.email}</span>
            </button>
          ))}
          {pageResults.map((page) => (
            <button type="button" key={`page-${page.id}`} onClick={() => choose(onPage, page.id)}>
              <strong>{page.label}</strong>
              <span>Open page</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OverviewWorkspace({
  products,
  totalProducts,
  facets,
  reviewItems,
  recommendationStats,
  usersState,
  operationsState,
  onOpenInventory,
  onOpenAnalytics,
  onOpenUsers,
  onAddProduct,
  onRebuildCategories
}) {
  const recentProducts = products.slice(0, 5);
  const categories = facets?.categories?.length || facets?.categoryCounts?.length || 0;
  const brands = facets?.brands?.length || 0;
  const totals = recommendationStats?.totals || {};
  const topProduct = recommendationStats?.topProducts?.[0];
  const topCategory = recommendationStats?.topCategories?.[0];
  const topEvent = recommendationStats?.eventCounts?.[0];
  const qaRate = totalProducts ? Math.round(((totalProducts - reviewItems.length) / totalProducts) * 100) : 0;
  const lowTokenUsers = usersState.users.filter((user) => Number(user.tokens || 0) <= 5).slice(0, 5);
  const paymentIssues = operationsState.orders.filter((order) => ['failed', 'pending'].includes(order.status)).slice(0, 5);

  return (
    <section className="overview-crm">
      <section className="admin-card overview-command-card">
        <div>
          <p className="kicker">Today</p>
          <h2>Today at a glance</h2>
          <p>Products, users, tokens, and the work that needs attention.</p>
        </div>
        <div className="overview-command-actions">
          <button type="button" onClick={onAddProduct}>Add Product</button>
          <button type="button" onClick={onOpenUsers}>Manage Tokens</button>
          <button type="button" onClick={onRebuildCategories}>Fix Categories</button>
        </div>
      </section>

      <section className="overview-crm-grid">
        <section className="admin-card crm-card catalog-pipeline-card">
          <div className="section-head">
            <div>
              <h2>Product Status</h2>
              <p>How many products are live and how clean the list is.</p>
            </div>
            <button type="button" onClick={onOpenInventory}>Inventory</button>
          </div>
          <div className="pipeline-score">
            <span>{qaRate}%</span>
            <div>
              <strong>Ready to show</strong>
              <p>{formatNumber(totalProducts)} active products across {formatNumber(categories)} categories and {formatNumber(brands)} brands.</p>
            </div>
          </div>
          <div className="pipeline-breakdown">
            <div><span>Need fixes</span><strong>{formatNumber(reviewItems.length)}</strong></div>
            <div><span>Categories</span><strong>{formatNumber(categories)}</strong></div>
            <div><span>Brands</span><strong>{formatNumber(brands)}</strong></div>
          </div>
        </section>

        <section className="admin-card crm-card attention-card">
          <div className="section-head">
            <div>
              <h2>Action Inbox</h2>
              <p>Product fixes, low token users, and payment issues.</p>
            </div>
            <button type="button" onClick={onOpenInventory}>Resolve</button>
          </div>
          <ActionInbox
            reviewItems={reviewItems}
            lowTokenUsers={lowTokenUsers}
            paymentIssues={paymentIssues}
            onOpenInventory={onOpenInventory}
            onOpenUsers={onOpenUsers}
          />
        </section>

        <StatBox className="overview-bento-stat active-products-stat" label="Active products" value={formatNumber(totalProducts || 0)} meta={`${formatNumber(categories)} categories`} />
        <StatBox className="overview-bento-stat" label="Need fixes" value={formatNumber(reviewItems.length)} meta="products to clean up" />
        <StatBox className="overview-bento-stat" label="Users 30d" value={formatNumber(totals.activeUsers30d || 0)} meta="active this month" />
        <StatBox className="overview-bento-stat" label="Total tokens" value={formatNumber(usersState.totals?.tokens || 0)} meta="available to users" />

        <section className="admin-card crm-card recent-products-card">
          <div className="section-head">
            <div>
              <h2>New Products</h2>
              <p>Latest products added to the admin list.</p>
            </div>
            <button type="button" onClick={onOpenInventory}>Open</button>
          </div>
          <div className="recent-product-list">
            {recentProducts.length === 0 ? <StatusPanel text="No products loaded yet." /> : recentProducts.map((product) => (
              <article key={product.id} className="recent-product-item">
                <img src={mediaUrl(product.imageUrl)} alt="" />
                <div>
                  <strong>{product.name}</strong>
                  <span>{displayBrand(product)} - {displayCategory(product)}</span>
                </div>
                <b>{formatMoney(product.price || 0, product.currency)}</b>
              </article>
            ))}
          </div>
        </section>

        <section className="admin-card crm-card user-pulse-card">
          <div className="section-head">
            <div>
              <h2>Users and Tokens</h2>
              <p>Customer count, token pool, and recent app activity.</p>
            </div>
            <button type="button" onClick={onOpenUsers}>Users</button>
          </div>
          <div className="user-pulse-grid">
            <div><span>Users</span><strong>{formatNumber(usersState.totals?.users || 0)}</strong></div>
            <div><span>Total tokens</span><strong>{formatNumber(usersState.totals?.tokens || 0)}</strong></div>
            <div><span>Active 30d</span><strong>{formatNumber(totals.activeUsers30d || 0)}</strong></div>
            <div><span>Profiles</span><strong>{formatNumber(totals.preferenceProfiles || 0)}</strong></div>
          </div>
          <div className="signal-summary-strip">
            <div><span>Top action</span><strong>{topEvent ? formatEventType(topEvent.type) : 'No action'}</strong></div>
            <div><span>Top category</span><strong>{topCategory?.label || 'No category'}</strong></div>
            <div><span>Top product</span><strong>{topProduct?.name || 'No product'}</strong></div>
          </div>
          <button className="wide-card-action" type="button" onClick={onOpenAnalytics}>Open Analytics</button>
        </section>
      </section>
    </section>
  );
}

function ActionInbox({ reviewItems, lowTokenUsers, paymentIssues, onOpenInventory, onOpenUsers }) {
  const hasItems = reviewItems.length || lowTokenUsers.length || paymentIssues.length;
  if (!hasItems) return <StatusPanel text="Nothing urgent right now." />;

  return (
    <div className="attention-list action-inbox-list">
      {reviewItems.slice(0, 3).map(({ product, flags }) => (
        <button type="button" key={`product-${product.id}`} onClick={onOpenInventory}>
          <span>Product fix</span>
          <strong>{product.name}</strong>
          <em>{flags.slice(0, 2).join(', ')}</em>
        </button>
      ))}
      {lowTokenUsers.map((user) => (
        <button type="button" key={`user-${user.id}`} onClick={onOpenUsers}>
          <span>Low tokens</span>
          <strong>{user.name || user.email}</strong>
          <em>{formatNumber(user.tokens || 0)} tokens left</em>
        </button>
      ))}
      {paymentIssues.map((order) => (
        <button type="button" key={`order-${order.id}`} onClick={onOpenUsers}>
          <span>{order.status} payment</span>
          <strong>{order.user?.name || order.user?.email || order.merchantOrderId}</strong>
          <em>{formatMoney(order.amount || 0, order.currency)} - {formatCatalogDate(order.createdAt)}</em>
        </button>
      ))}
    </div>
  );
}

function UsersTokenPage({ state, search, operationsState, tokenDrafts, onSearch, onDraftChange, onUpdateTokens, onRefresh }) {
  const lowTokenUsers = state.users.filter((user) => Number(user.tokens || 0) <= 5).slice(0, 8);

  return (
    <section className="users-page">
      <section className="overview-grid users-summary-grid" aria-label="User summary">
        <StatBox label="Total users" value={formatNumber(state.totals?.users || 0)} meta={`${formatNumber(state.totals?.loaded || 0)} loaded`} />
        <StatBox label="Total tokens" value={formatNumber(state.totals?.tokens || 0)} meta="tokens users can spend" />
        <StatBox label="Search results" value={formatNumber(state.users.length || 0)} meta={search ? 'filtered users' : 'latest users'} />
        <StatBox label="Token changes" value="Set/Add" meta="change a user balance" />
      </section>

      <section className="users-page-top-grid">
        <LowTokenUsersPanel users={lowTokenUsers} />
        <RecentOrdersPanel operationsState={operationsState} />
      </section>

      <section className="admin-card users-crm-card">
        <div className="section-head users-head">
          <div>
            <h2>User Tokens</h2>
            <p>Search users, check their plan, and change token balances.</p>
          </div>
          <button type="button" onClick={onRefresh}>Refresh Users</button>
        </div>
        <div className="users-toolbar">
          <label className="field">
            <span>Search users</span>
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Name, Gmail, or username" />
          </label>
        </div>
        {state.loading && <StatusPanel text="Loading users..." />}
        {state.error && <StatusPanel text={state.error} />}
        {!state.loading && !state.error && state.users.length === 0 && <StatusPanel text="No users found." />}
        {!state.loading && !state.error && state.users.length > 0 && (
          <>
            <div className="users-table-head" aria-hidden="true">
              <span>User</span>
              <span>Plan</span>
              <span>Tokens</span>
              <span>Last Order</span>
              <span>Actions</span>
            </div>
            <div className="users-list">
              {state.users.map((user) => (
                <UserTokenRow
                  key={user.id}
                  user={user}
                  draft={tokenDrafts[user.id] || ''}
                  onDraftChange={(value) => onDraftChange(user.id, value)}
                  onSet={() => onUpdateTokens(user.id, 'set')}
                  onAdd={() => onUpdateTokens(user.id, 'add')}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </section>
  );
}

function LowTokenUsersPanel({ users }) {
  return (
    <section className="admin-card crm-card low-token-card">
      <div className="section-head">
        <div>
          <h2>Low Token Users</h2>
          <p>Users with 5 or fewer tokens.</p>
        </div>
      </div>
      <div className="compact-user-list">
        {users.length === 0 ? <StatusPanel text="No low-token users in the loaded list." /> : users.map((user) => (
          <div key={user.id}>
            <strong>{user.name || user.email}</strong>
            <span>{user.email}</span>
            <b>{formatNumber(user.tokens || 0)} tokens</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentOrdersPanel({ operationsState }) {
  const totals = operationsState.orderTotals || {};
  const completed = totals.completed?.count || 0;
  const pending = totals.pending?.count || 0;
  const failed = totals.failed?.count || 0;

  return (
    <section className="admin-card crm-card orders-card">
      <div className="section-head">
        <div>
          <h2>Recent Orders</h2>
          <p>Latest token payments and payment status.</p>
        </div>
      </div>
      <div className="order-summary-strip">
        <div><span>Completed</span><strong>{formatNumber(completed)}</strong></div>
        <div><span>Pending</span><strong>{formatNumber(pending)}</strong></div>
        <div><span>Failed</span><strong>{formatNumber(failed)}</strong></div>
      </div>
      {operationsState.loading && <StatusPanel text="Loading orders..." />}
      {operationsState.error && <StatusPanel text={operationsState.error} />}
      {!operationsState.loading && !operationsState.error && operationsState.orders.length === 0 && <StatusPanel text="No token orders yet." />}
      {!operationsState.loading && !operationsState.error && operationsState.orders.length > 0 && (
        <div className="orders-list">
          {operationsState.orders.slice(0, 6).map((order) => (
            <article key={order.id} className={`order-row ${order.status}`}>
              <div>
                <strong>{order.user?.name || order.user?.email || 'Unknown user'}</strong>
                <span>{order.planName} - {formatNumber(order.tokens || 0)} tokens</span>
              </div>
              <div>
                <b>{formatMoney(order.amount || 0, order.currency)}</b>
                <em>{order.status}</em>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UserTokenRow({ user, draft, onDraftChange, onSet, onAdd }) {
  const planStatus = user.subscription?.status || 'none';
  const planName = user.subscription?.planId || (planStatus === 'none' ? 'Free' : planStatus);
  const initials = String(user.name || user.email || 'U').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <article className="user-row">
      <div className="user-identity">
        <span className="user-avatar">{initials || 'U'}</span>
        <div>
          <strong>{user.name || 'Unnamed user'}</strong>
          <span>{user.email}</span>
          {user.username && <em>@{user.username}</em>}
        </div>
      </div>
      <div className="user-plan-cell">
        <strong>{planName}</strong>
        <span>{planStatus}</span>
        <em>{user.bodyPhotoStatus || 'uploaded'} profile</em>
      </div>
      <div className="user-token-cell">
        <strong>{formatNumber(user.tokens || 0)}</strong>
        <span>tokens</span>
      </div>
      <div className="user-order-cell">
        {user.lastOrder ? (
          <>
            <strong>{user.lastOrder.planName}</strong>
            <span>{formatNumber(user.lastOrder.tokens || 0)} tokens - {user.lastOrder.status}</span>
            <em>{formatCatalogDate(user.lastOrder.createdAt)}</em>
          </>
        ) : (
          <>
            <strong>No order yet</strong>
            <span>Joined {formatCatalogDate(user.joinedAt)}</span>
          </>
        )}
      </div>
      <div className="user-token-actions">
        <input type="number" step="1" value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Tokens" />
        <button type="button" onClick={onAdd}>Add</button>
        <button type="button" onClick={onSet}>Set</button>
      </div>
    </article>
  );
}

function formatAuditAction(value = '') {
  return String(value || 'admin action')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function AuditLogPanel({ operationsState, onRefresh }) {
  return (
    <section className="admin-card settings-panel audit-panel">
      <div className="section-head">
        <div>
          <h2>Audit Log</h2>
          <p>Recent admin changes for products, tokens, and categories.</p>
        </div>
        <button type="button" onClick={onRefresh}>Refresh Log</button>
      </div>
      {operationsState.loading && <StatusPanel text="Loading audit log..." />}
      {operationsState.error && <StatusPanel text={operationsState.error} />}
      {!operationsState.loading && !operationsState.error && operationsState.auditLogs.length === 0 && <StatusPanel text="No admin actions recorded yet." />}
      {!operationsState.loading && !operationsState.error && operationsState.auditLogs.length > 0 && (
        <div className="audit-list">
          {operationsState.auditLogs.slice(0, 10).map((log) => (
            <article key={log.id}>
              <div>
                <strong>{formatAuditAction(log.action)}</strong>
                <span>{log.label || log.entityType}</span>
              </div>
              <div>
                <b>{log.actorEmail || 'admin'}</b>
                <em>{formatSignalDate(log.createdAt)}</em>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CatalogTableHeader() {
  return (
    <div className="catalog-table-head" aria-hidden="true">
      <span>Product</span>
      <span>Details</span>
      <span>Merchandising</span>
      <span>Links</span>
      <span>Actions</span>
    </div>
  );
}

function HealthRow({ label, status, detail }) {
  return (
    <div className="health-row">
      <span className={`health-dot ${status}`} />
      <div>
        <strong>{label}</strong>
        <em>{detail}</em>
      </div>
      <b>{status === 'ok' ? 'Healthy' : status === 'warn' ? 'Check' : 'Down'}</b>
    </div>
  );
}

function SystemHealthPanel({ systemHealth, catalogState, recommendationState, adminSession }) {
  const apiOk = Boolean(systemHealth.health?.ok);
  const mongoOk = Boolean(systemHealth.health?.mongo);
  const catalogOk = !catalogState.loading && !catalogState.error;
  const analyticsOk = !recommendationState.loading && !recommendationState.error;

  return (
    <section className="admin-card settings-panel health-panel">
      <div className="section-head">
        <div>
          <h2>System Status</h2>
          <p>Check if the main parts of the admin panel are working.</p>
        </div>
      </div>
      <div className="health-list">
        <HealthRow
          label="API server"
          status={systemHealth.loading ? 'warn' : apiOk ? 'ok' : 'down'}
          detail={systemHealth.loading ? 'Checking the server...' : systemHealth.error || 'Server is responding.'}
        />
        <HealthRow
          label="MongoDB"
          status={systemHealth.loading ? 'warn' : mongoOk ? 'ok' : 'down'}
          detail={mongoOk ? 'Database is connected.' : 'Database is not confirmed.'}
        />
        <HealthRow
          label="Admin session"
          status={adminSession?.token ? 'ok' : 'down'}
          detail={adminSession?.admin?.email || 'No active admin email found.'}
        />
        <HealthRow
          label="Catalog API"
          status={catalogState.loading ? 'warn' : catalogOk ? 'ok' : 'down'}
          detail={catalogState.loading ? 'Loading products...' : catalogState.error || `${formatNumber(catalogState.total || 0)} active products loaded.`}
        />
        <HealthRow
          label="Analytics API"
          status={recommendationState.loading ? 'warn' : analyticsOk ? 'ok' : 'down'}
          detail={recommendationState.loading ? 'Loading user activity...' : recommendationState.error || `${formatNumber(recommendationState.stats?.totals?.events || 0)} user actions found.`}
        />
      </div>
    </section>
  );
}

function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('Checking access...');
    try {
      const data = await api('/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ email, adminKey })
      });
      onLogin(data);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-art">
          <div className="brand-mark">F</div>
          <span>FitLook Admin</span>
          <h1>Catalog access for invited Gmail accounts.</h1>
          <p>Use an approved Gmail and the admin key to enter the dashboard.</p>
          <div className="login-metrics" aria-label="Admin capabilities">
            <div><strong>Catalog</strong><span>Upload and edit products</span></div>
            <div><strong>Activity</strong><span>See what users do</span></div>
            <div><strong>Checks</strong><span>Find missing product details</span></div>
          </div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <div>
            <p className="kicker">Secure login</p>
            <h2>Sign in</h2>
            <p>Only approved Gmail accounts can enter this dashboard.</p>
          </div>
          <label className="field">
            <span>Gmail</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@gmail.com" required />
          </label>
          <label className="field">
            <span>Admin key</span>
            <input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} placeholder="Enter admin key" required />
          </label>
          <button className="submit" type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Enter Admin'}</button>
          {message && <p className="form-message">{message}</p>}
        </form>
      </section>
    </main>
  );
}

function CatalogFilters({ filters, facets, onChange, onClear }) {
  const categories = facets?.categories || [];
  const brands = facets?.brands || [];

  return (
    <section className="catalog-filters" aria-label="Catalog filters">
      <label className="field search-field">
        <span>Search</span>
        <input value={filters.q} onChange={(event) => onChange('q', event.target.value)} placeholder="Search name, tag, brand..." />
      </label>
      <label className="field">
        <span>Category</span>
        <select value={filters.category} onChange={(event) => onChange('category', event.target.value)}>
          <option value="">All categories</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Brand</span>
        <select value={filters.brand} onChange={(event) => onChange('brand', event.target.value)}>
          <option value="">All brands</option>
          {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Gender</span>
        <select value={filters.gender} onChange={(event) => onChange('gender', event.target.value)}>
          <option value="">All genders</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
          <option value="unisex">Unisex</option>
        </select>
      </label>
      <label className="field">
        <span>Status</span>
        <select value={filters.status} onChange={(event) => onChange('status', event.target.value)}>
          <option value="">All statuses</option>
          <option value="featured">Featured</option>
          <option value="newArrival">New arrivals</option>
        </select>
      </label>
      <label className="field">
        <span>Sort</span>
        <select value={filters.sort} onChange={(event) => onChange('sort', event.target.value)}>
          <option value="newest">Newest</option>
          <option value="featured">Featured first</option>
          <option value="price-asc">Price low to high</option>
          <option value="price-desc">Price high to low</option>
        </select>
      </label>
      <button type="button" onClick={onClear}>Reset</button>
    </section>
  );
}

function QaSummary({ items }) {
  const visible = items.slice(0, 5);
  return (
    <section className={`qa-summary ${items.length ? 'needs-work' : ''}`} aria-label="Product checks summary">
      <div>
        <strong>{items.length ? `${items.length} products need fixes` : 'Product list looks clean'}</strong>
        <span>{items.length ? 'Checks look for missing details, duplicates, and broad categories.' : 'No obvious product issues in the loaded list.'}</span>
      </div>
      {visible.length > 0 && (
        <div className="qa-summary-list">
          {visible.map(({ product, flags }) => (
            <span key={product.id}>{product.name}: {flags.slice(0, 2).join(', ')}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function BulkActionBar({ selectedProducts, onFeature, onUnfeature, onNewArrival, onClearNewArrival, onRemove }) {
  if (!selectedProducts.length) return null;
  return (
    <section className="bulk-action-bar" aria-label="Bulk product actions">
      <strong>{selectedProducts.length} selected</strong>
      <div>
        <button type="button" onClick={onFeature}>Feature</button>
        <button type="button" onClick={onUnfeature}>Unfeature</button>
        <button type="button" onClick={onNewArrival}>New Arrival</button>
        <button type="button" onClick={onClearNewArrival}>Clear New</button>
        <button className="danger-action" type="button" onClick={onRemove}>Remove</button>
      </div>
    </section>
  );
}

function AdminProductRow({ product, selected, qaFlags, onSelect, onEdit, onPlacement, onRemove }) {
  return (
    <article className={`admin-product ${selected ? 'selected' : ''}`}>
      <div className="product-cell product-identity-cell">
        <label className="row-check" aria-label={`Select ${product.name}`}>
          <input type="checkbox" checked={selected} onChange={onSelect} />
        </label>
        <img src={mediaUrl(product.imageUrl)} alt={product.name} />
        <div className="admin-product-title">
          <h3>{product.name}</h3>
          <p>{displayBrand(product)}</p>
        </div>
      </div>
      <div className="product-cell product-detail-cell">
        <strong>{displayCategory(product)}</strong>
        <span>{product.gender || 'unisex'} - {garmentPlacementLabel(product.garmentPlacement)}</span>
        <span>{formatCatalogDate(product.createdAt)}</span>
      </div>
      <div className="product-cell product-merch-cell">
        <strong>{formatMoney(product.price || 0, product.currency)}</strong>
        <span>{Number(product.rating || 0).toFixed(1)} rating - {formatNumber(product.ratingCount || 0)} reviews</span>
        <div className="product-admin-meta">
          {product.tryOnModel && <span>{product.tryOnModel}</span>}
          {product.isFeatured && <span>Featured</span>}
          {product.isNewArrival && <span>New arrival</span>}
        </div>
      </div>
      <div className="product-cell product-link-cell">
        <div className="admin-row-links">
          {product.affiliateLink && <a className="admin-affiliate" href={product.affiliateLink} target="_blank" rel="noreferrer">Affiliate</a>}
          {product.sourceUrl && <a className="admin-affiliate" href={product.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
          {!product.affiliateLink && !product.sourceUrl && <span>No source</span>}
        </div>
        {qaFlags.length > 0 && (
          <div className="qa-flags">
            {qaFlags.slice(0, 2).map((flag) => <span key={`${product.id}-${flag}`}>{flag}</span>)}
          </div>
        )}
      </div>
      <div className="product-cell admin-product-actions">
        <div className="row-segmented" aria-label={`Fit area for ${product.name}`}>
          <button className={(product.garmentPlacement || 'top') === 'top' ? 'active' : ''} type="button" onClick={() => onPlacement(product.id, 'top')}>Top</button>
          <button className={product.garmentPlacement === 'bottom' ? 'active' : ''} type="button" onClick={() => onPlacement(product.id, 'bottom')}>Bottom</button>
        </div>
        <div className="row-actions">
          <a className="preview-action" href={productPublicUrl(product)} target="_blank" rel="noreferrer">Preview</a>
          <button type="button" onClick={onEdit}>Edit</button>
          <button className="danger-action" type="button" onClick={() => onRemove(product.id)}>Remove</button>
        </div>
      </div>
    </article>
  );
}

function ProductEditor({ product, message, saving, onClose, onSubmit }) {
  const remoteImageValue = /^(?:https?:|data:)/i.test(product.imageUrl || '') ? product.imageUrl : '';

  return (
    <div className="editor-backdrop" role="presentation">
      <aside className="product-editor" aria-label={`Edit ${product.name}`}>
        <div className="editor-head">
          <div>
            <span>Edit Product</span>
            <h2>{product.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close editor">Close</button>
        </div>
        <form className="editor-form" onSubmit={onSubmit} key={product.id}>
          <div className="editor-preview">
            <img src={mediaUrl(product.imageUrl)} alt="" />
            <div>
              <strong>{displayBrand(product)}</strong>
              <span>{displayCategory(product)} - {formatMoney(product.price || 0, product.currency)}</span>
            </div>
          </div>
          <section className="form-section">
            <div className="form-section-title"><strong>Product Details</strong><span>Shown on the website and used for matching outfits.</span></div>
            <label className="field"><span>Name</span><input name="name" required defaultValue={product.name || ''} /></label>
            <label className="field"><span>Brand</span><input name="brand" required defaultValue={product.brand || ''} /></label>
            <div className="two-col">
              <label className="field"><span>Category</span><input name="category" required defaultValue={product.category || ''} /></label>
              <label className="field"><span>Gender</span><select name="gender" defaultValue={product.gender || 'unisex'}><option value="men">Men</option><option value="women">Women</option><option value="unisex">Unisex</option></select></label>
            </div>
            <fieldset className="segmented-field">
              <legend>Fit area</legend>
              <label><input type="radio" name="garmentPlacement" value="top" defaultChecked={(product.garmentPlacement || 'top') === 'top'} /><span>Top</span></label>
              <label><input type="radio" name="garmentPlacement" value="bottom" defaultChecked={product.garmentPlacement === 'bottom'} /><span>Bottom</span></label>
            </fieldset>
            <label className="field"><span>Description</span><textarea name="description" rows="4" defaultValue={product.description || ''} /></label>
          </section>
          <section className="form-section">
            <div className="form-section-title"><strong>Merchandising</strong><span>Used by catalog cards, filters, and personalized ranking.</span></div>
            <div className="two-col">
              <label className="field"><span>Price</span><input name="price" type="number" step="0.01" min="0" required defaultValue={product.price ?? ''} /></label>
              <label className="field"><span>Compare price</span><input name="compareAtPrice" type="number" step="0.01" min="0" defaultValue={product.compareAtPrice ?? ''} /></label>
            </div>
            <div className="two-col">
              <label className="field"><span>Currency</span><input name="currency" defaultValue={product.currency || 'USD'} /></label>
              <label className="field"><span>Badge</span><input name="badge" defaultValue={product.badge || ''} /></label>
            </div>
            <div className="two-col">
              <label className="field"><span>Rating</span><input name="rating" type="number" step="0.1" min="0" max="5" defaultValue={product.rating ?? 4.5} /></label>
              <label className="field"><span>Rating count</span><input name="ratingCount" type="number" min="0" defaultValue={product.ratingCount ?? 0} /></label>
            </div>
            <label className="field"><span>Tags</span><input name="tags" defaultValue={(product.tags || []).join(', ')} /></label>
            <label className="field"><span>Colors</span><input name="colors" defaultValue={(product.colors || []).join(', ')} /></label>
            <div className="checks">
              <label><input name="isFeatured" type="checkbox" defaultChecked={Boolean(product.isFeatured)} /> Featured</label>
              <label><input name="isNewArrival" type="checkbox" defaultChecked={Boolean(product.isNewArrival)} /> New arrival</label>
            </div>
          </section>
          <section className="form-section">
            <div className="form-section-title"><strong>Links & Try-On</strong><span>Source URLs help duplicate detection and external attribution.</span></div>
            <label className="field"><span>Affiliate link</span><input name="affiliateLink" type="url" defaultValue={product.affiliateLink || ''} /></label>
            <label className="field"><span>Source URL</span><input name="sourceUrl" type="url" defaultValue={product.sourceUrl || ''} /></label>
            <label className="field"><span>Remote image URL</span><input name="remoteImageUrl" type="url" defaultValue={remoteImageValue} /></label>
            <label className="field"><span>Try-on model</span><select name="tryOnModel" defaultValue={product.tryOnModel || 'gpt-image-2'}><option value="gpt-image-2">gpt-image-2</option><option value="wan-v2.6-image-to-image">wan-v2.6-image-to-image</option></select></label>
          </section>
          <div className="editor-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="submit" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
          {message && <p className="form-message">{message}</p>}
        </form>
      </aside>
    </div>
  );
}

function CategoryDistribution({ items, total }) {
  const palette = ['#123323', '#ead8c2', '#d8c8b6', '#6d675f', '#8b2f2f', '#2f2418'];
  let cursor = 0;
  const segments = items.slice(0, 6).map((item, index) => {
    const percent = total ? (item.count / total) * 100 : 0;
    const start = cursor;
    cursor += percent;
    return `${palette[index % palette.length]} ${start}% ${cursor}%`;
  });
  const pieStyle = { background: segments.length ? `conic-gradient(${segments.join(', ')})` : 'var(--line)' };

  return (
    <div className="category-distribution" aria-label="Category distribution">
      <div className="distribution-head">
        <h3>Category Distribution</h3>
        <span>{total} loaded</span>
      </div>
      <div className="distribution-pie-wrap">
        <div className="distribution-pie" style={pieStyle}><span>{items.length}</span></div>
        <div className="distribution-pie-copy">
          <strong>{items[0]?.category || 'No categories'}</strong>
          <span>{items[0] ? `${items[0].count} products in the leading category` : 'Publish products to build category insights.'}</span>
        </div>
      </div>
      <div className="distribution-list">
        {items.slice(0, 6).map((item, index) => {
          const percent = total ? Math.round((item.count / total) * 100) : 0;
          return (
            <div className="distribution-item" key={item.category}>
              <div><strong><i style={{ background: palette[index % palette.length] }} />{item.category}</strong><span>{item.count} products - {percent}%</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationStatsCard({ state, onRefresh, categoryDistribution = [], categoryTotal = 0 }) {
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
          <h2>User Activity</h2>
          <p>Searches, clicks, try-ons, shop clicks, and product interest.</p>
        </div>
        <button type="button" onClick={onRefresh}>Refresh Data</button>
      </div>
      {state.loading && <StatusPanel text="Loading user activity..." />}
      {state.error && <StatusPanel text={state.error} />}
      {!state.loading && !state.error && !stats && <StatusPanel text="Sign in to load user activity." />}
      {stats && (
        <>
          <div className="stats-grid">
            <StatBox label="Events" value={formatNumber(totals.events || 0)} meta={`${eventCounts.length || 0} signal types`} />
            <StatBox label="Users 30d" value={formatNumber(totals.activeUsers30d || 0)} meta="active in the last month" />
            <StatBox label="Profiles" value={formatNumber(totals.preferenceProfiles || 0)} meta="saved preference profiles" />
            <StatBox label="Avg wanted price" value={totals.averagePreferredPrice ? formatMoney(totals.averagePreferredPrice, 'INR') : '-'} meta="based on user activity" />
          </div>
          <div className="recommendation-overview">
            <div className="signal-column">
              <div className="signal-spotlight">
                <div>
                  <span>Top action</span>
                  <strong>{topEvent ? formatEventType(topEvent.type) : 'No activity yet'}</strong>
                  <p>{topEvent ? `${formatNumber(topEvent.count)} times users did this.` : 'User actions will appear here once people use the app.'}</p>
                </div>
                <div>
                  <span>Strongest category</span>
                  <strong>{topCategory?.label || 'No category yet'}</strong>
                  <p>{topCategory ? `${formatWeight(topCategory.weight)} interest score.` : 'This needs more user activity.'}</p>
                </div>
                <div>
                  <span>Top product</span>
                  <strong>{topProduct?.name || 'No product yet'}</strong>
                  <p>{topProduct ? `${displayBrand(topProduct)} - ${displayCategory(topProduct)} - ${formatNumber(topProduct.count)} actions.` : 'Top products will appear after clicks, try-ons, and shop taps.'}</p>
                </div>
              </div>
              {categoryDistribution.length > 0 ? (
                <CategoryDistribution items={categoryDistribution} total={categoryTotal} />
              ) : (
                <StatusPanel text="No category data yet." />
              )}
            </div>
            <StatsList
              title="Action Mix"
              items={eventCounts.map((item) => ({
                label: formatEventType(item.type),
                value: item.count,
                meta: `${formatWeight(item.weight)} activity score`
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

function StatBox({ label, value, meta, className = '' }) {
  return <div className={`stat-box ${className}`.trim()}><span>{label}</span><strong>{value}</strong>{meta && <em>{meta}</em>}</div>;
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
      <h3>Recent Actions</h3>
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
          <span className="admin-skeleton-check" />
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
