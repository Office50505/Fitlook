const SITE_NAME = 'FitLook';
const DEFAULT_DESCRIPTION = 'AI-powered fashion shopping with virtual try-on, curated products, wardrobe tools, and style recommendations.';

const routeMeta = {
  '/': ['FitLook - AI Fashion Try-On', 'Upload your photo, try outfits virtually, and shop with more confidence.'],
  '/home': ['FitLook Home - AI-Powered Fashion', 'Discover curated new arrivals, categories, and AI try-on tools.'],
  '/categories': ['Fashion Categories - FitLook', 'Explore live catalog categories and discover styles by department.'],
  '/search': ['Shop Fashion - FitLook', 'Search products, filter the live catalog, and try selected looks with AI.'],
  '/custom-try-on': ['Custom AI Try-On - FitLook', 'Upload a clothing photo and generate a custom AI try-on preview.'],
  '/try-on': ['AI Try-On - FitLook', 'Create virtual try-on previews with your FitLook profile.'],
  '/closet': ['My Wardrobe - FitLook', 'Build outfits from your saved wardrobe and AI-generated looks.'],
  '/wishlist': ['Wishlist - FitLook', 'Review saved products and create your personal style shortlist.'],
  '/tokens': ['FitLook Credits', 'Buy secure credits for AI try-on generation.'],
  '/profile': ['My Profile - FitLook', 'Manage your profile photo, credits, privacy, and account preferences.'],
  '/cart': ['Cart - FitLook', 'Review selected products before checkout.'],
  '/privacy': ['Privacy Policy - FitLook', 'How FitLook handles profile photos, try-on results, and account data.'],
  '/terms': ['Terms and Conditions - FitLook', 'FitLook shopping, credits, AI try-on, and platform terms.'],
  '/support': ['Support - FitLook', 'Get help with orders, payments, AI try-on, and account questions.'],
  '/contact': ['Contact FitLook', 'Contact FitLook support for shopping, payment, or AI try-on help.']
};

function upsertMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    Object.entries(attributes.identity).forEach(([key, value]) => node.setAttribute(key, value));
    document.head.appendChild(node);
  }
  Object.entries(attributes.values).forEach(([key, value]) => node.setAttribute(key, value));
}

function upsertLink(rel, href) {
  let node = document.head.querySelector(`link[rel="${rel}"]`);
  if (!node) {
    node = document.createElement('link');
    node.setAttribute('rel', rel);
    document.head.appendChild(node);
  }
  node.setAttribute('href', href);
}

export function updateRouteSeo(path, search = '') {
  if (typeof document === 'undefined') return;
  const normalizedPath = path || '/';
  const [title, description] = routeMeta[normalizedPath] || routeMeta['/'];
  const canonical = `${window.location.origin}${normalizedPath}${search && normalizedPath === '/search' ? search : ''}`;
  document.title = title;
  upsertMeta('meta[name="description"]', { identity: { name: 'description' }, values: { content: description || DEFAULT_DESCRIPTION } });
  upsertMeta('meta[property="og:title"]', { identity: { property: 'og:title' }, values: { content: title } });
  upsertMeta('meta[property="og:description"]', { identity: { property: 'og:description' }, values: { content: description || DEFAULT_DESCRIPTION } });
  upsertMeta('meta[property="og:site_name"]', { identity: { property: 'og:site_name' }, values: { content: SITE_NAME } });
  upsertMeta('meta[property="og:type"]', { identity: { property: 'og:type' }, values: { content: 'website' } });
  upsertMeta('meta[name="twitter:card"]', { identity: { name: 'twitter:card' }, values: { content: 'summary_large_image' } });
  upsertLink('canonical', canonical);
}

export function updateProductSeo(product) {
  if (typeof document === 'undefined' || !product) return;
  const title = `${product.name} - FitLook`;
  const description = product.description || `${product.name} by ${product.brand || 'FitLook catalog'}. Preview supported items with AI try-on.`;
  document.title = title;
  upsertMeta('meta[name="description"]', { identity: { name: 'description' }, values: { content: description.slice(0, 160) } });
  upsertMeta('meta[property="og:title"]', { identity: { property: 'og:title' }, values: { content: title } });
  upsertMeta('meta[property="og:description"]', { identity: { property: 'og:description' }, values: { content: description.slice(0, 200) } });
  if (product.imageUrl) upsertMeta('meta[property="og:image"]', { identity: { property: 'og:image' }, values: { content: product.imageUrl } });
  upsertLink('canonical', `${window.location.origin}/product/${encodeURIComponent(product.id)}`);
}
