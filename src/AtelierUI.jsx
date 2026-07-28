import { useMemo, useState } from 'react';

const asset = (name) => `/assets/${name}`;

function routeTo(href) {
  window.history.pushState({}, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function AppLink({ href, className = '', children, ...props }) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        routeTo(href);
      }}
      {...props}
    >
      {children}
    </a>
  );
}

const products = [
  { brand: 'AURA', name: 'Runner Elite', price: '$49.99', category: 'Sneakers', image: 'trending-1.jpg' },
  { brand: 'CHAOTIC', name: 'Oversize Hoodie', price: '$59.99', category: 'Hoodie', image: 'trending-2.jpg' },
  { brand: 'NOMAD', name: 'Puffer Vest', price: '$69.99', category: 'Outerwear', image: 'trending-3.jpg' },
  { brand: 'LEGACY', name: 'Letterman Jacket', price: '$79.99', category: 'Varsity Jacket', image: 'trending-4.jpg' },
  { brand: 'FITLOOK', name: 'Archive Knit Dress', price: '$485.00', category: 'Signature', image: 'arrival-4.jpg' },
  { brand: 'ATELIER', name: 'Sculpted Boot', price: '$320.00', category: 'Accessories', image: 'category-6.jpg' },
  { brand: 'LORO', name: 'Ivory Silk Trouser', price: '$890.00', category: 'Bottoms', image: 'category-3.jpg' },
  { brand: 'ALDO', name: 'Petite Column Bag', price: '$540.00', category: 'Leather', image: 'category-8.jpg' }
];

const categories = [
  ['Tops', 'category-1.jpg', '/search?category=tops'],
  ['Bottoms', 'category-3.jpg', '/search?category=bottoms'],
  ['Dresses', 'arrival-4.jpg', '/collections'],
  ['Shoes', 'category-6.jpg', '/search?category=shoes'],
  ['Accessories', 'category-8.jpg', '/wishlist'],
  ['Men', 'hero1.png', '/search?gender=men'],
  ['Sale', 'search-locked-preview.jpg', '/tokens']
];

function demoUser() {
  return {
    id: 'demo-user',
    name: 'Aarav Sharma',
    username: 'aaravsharma',
    email: 'aarav.sharma@gmail.com',
    tokens: 1200,
    genderPreference: 'other',
    joinedAt: '2024-05-01',
    bodyPhotoUrl: asset('hero2.png')
  };
}

function AtelierHeader({ active = 'Shop', compact = false, user }) {
  const links = [
    ['Shop', '/shop'],
    ['Categories', '/search'],
    ['Collections', '/collections'],
    ['Closet', '/closet'],
    ['AI Stylist', '/style-bot']
  ];

  return (
    <header className={`atelier-header ${compact ? 'compact' : ''}`}>
      <AppLink className="atelier-logo" href="/">FitLook</AppLink>
      <nav>
        {links.map(([label, href]) => (
          <AppLink className={active === label ? 'active' : ''} href={href} key={label}>{label}</AppLink>
        ))}
      </nav>
      <form className="atelier-search" onSubmit={(event) => { event.preventDefault(); routeTo('/search'); }}>
        <span>⌕</span>
        <input aria-label="Search products" placeholder="Search curated collections..." />
      </form>
      <div className="atelier-actions">
        <AppLink href="/wishlist" aria-label="Wishlist">♡</AppLink>
        <AppLink href="/tokens" aria-label="Credits">{user ? `${user.tokens} Credits` : 'Credits'}</AppLink>
        <AppLink href="/profile" aria-label="Profile">♙</AppLink>
      </div>
    </header>
  );
}

function AtelierFooter() {
  return (
    <footer className="atelier-footer">
      <div>
        <h2>FitLook</h2>
        <p>Elevating the digital fashion experience through AI-driven personalization and artisanal curation.</p>
      </div>
      <div>
        <h3>Maison</h3>
        <AppLink href="/collections">Journal</AppLink>
        <AppLink href="/custom-try-on">Virtual Atelier</AppLink>
        <AppLink href="/style-bot">AI Stylist</AppLink>
      </div>
      <div>
        <h3>Client Care</h3>
        <AppLink href="/profile">My Account</AppLink>
        <AppLink href="/tokens">Credits</AppLink>
        <AppLink href="/wishlist">Wishlist</AppLink>
      </div>
      <div>
        <h3>Subscribe</h3>
        <form onSubmit={(event) => event.preventDefault()}>
          <input placeholder="Email Address" />
          <button type="submit">Join</button>
        </form>
      </div>
      <small>© 2024 FitLook. All rights reserved.</small>
    </footer>
  );
}

function ProductTile({ product, small = false, onFavorite }) {
  return (
    <article className={`atelier-product ${small ? 'small' : ''}`}>
      <AppLink href="/product/archive-knit-dress">
        <img src={asset(product.image)} alt={product.name} />
      </AppLink>
      {onFavorite && <button className="heart-action" type="button" onClick={onFavorite}>♥</button>}
      <p>{product.category}</p>
      <h3>{product.name}</h3>
      <strong>{product.price}</strong>
    </article>
  );
}

export function AtelierPage({ path, user, setUser }) {
  const productMatch = path.match(/^\/product\/([^/]+)$/);
  if (path === '/') return <Splash />;
  if (path === '/signup') return <Signup setUser={setUser} />;
  if (path === '/login') return <Login setUser={setUser} />;
  if (path === '/shop' || path === '/search') return <Shop user={user} />;
  if (path === '/collections' || path === '/categories') return <Collections user={user} />;
  if (path === '/closet' || path === '/try-on' || path === '/closet/combo' || path === '/closet/items') return <Closet user={user} />;
  if (productMatch) return <ProductDetail user={user} />;
  if (path === '/style-bot') return <Stylist user={user} />;
  if (path === '/closet/add') return <ClosetAdd />;
  if (path === '/custom-try-on') return <CustomTryOn />;
  if (path === '/wishlist') return <Wishlist user={user} />;
  if (path === '/tokens') return <Credits user={user} />;
  if (path === '/profile') return <Profile user={user} setUser={setUser} />;
  return null;
}

function Splash() {
  return (
    <main className="splash-screen">
      <img src={asset('hero1.png')} alt="" />
      <div className="splash-overlay" />
      <section>
        <h1>FitLook</h1>
        <p>AI-powered fashion experience</p>
        <div className="splash-pills">
          {['Virtual AI Try-On', 'Smart Digital Closet', 'Personal AI Stylist'].map((item) => <span key={item}><b>✓</b>{item}</span>)}
        </div>
        <AppLink className="splash-cta" href="/signup">Get Started →</AppLink>
        <AppLink className="splash-explore" href="/shop">Explore FitLook</AppLink>
      </section>
      <span className="splash-count">01 / Splash</span>
    </main>
  );
}

function Signup({ setUser }) {
  const [photo, setPhoto] = useState('');
  const [gender, setGender] = useState('Woman');

  const submit = (event) => {
    event.preventDefault();
    setUser(demoUser());
    routeTo('/shop');
  };

  return (
    <main className="atelier-auth signup-view">
      <section className="auth-form-panel">
        <AppLink className="auth-brand" href="/">FitLook</AppLink>
        <h1>Create Your Account</h1>
        <p>Join FitLook and elevate your fashion game</p>
        <form onSubmit={submit}>
          <input required placeholder="Full Name" />
          <input required placeholder="Choose a Username" />
          <input required type="email" placeholder="Email Address" />
          <input required type="password" placeholder="Create Password" />
          <label>Gender preference</label>
          <div className="segmented">
            {['Woman', 'Man', 'Non-binary'].map((item) => <button className={gender === item ? 'active' : ''} type="button" key={item} onClick={() => setGender(item)}>{item}</button>)}
          </div>
          <div className="upload-row">
            <label className="outline-button"><input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] ? URL.createObjectURL(event.target.files[0]) : '')} />Upload a Photo</label>
            <button className="outline-button" type="button">Take a Photo</button>
          </div>
          {photo && <img className="tiny-preview" src={photo} alt="Uploaded preview" />}
          <label className="check-line"><input type="checkbox" /> Create Full Body AI Profile</label>
          <label className="check-line"><input required type="checkbox" /> I agree to the Terms & Conditions and Privacy Policy</label>
          <p className="auth-switch">Already have an account? <AppLink href="/login">Login</AppLink></p>
          <button className="black-button" type="submit">Sign Up →</button>
        </form>
      </section>
      <aside className="auth-visual">
        <img src={asset('hero2.png')} alt="" />
        <span>Curated</span>
        {['Personalized for you', 'Save your style', 'Try before you buy'].map((item) => (
          <article key={item}><b>{item}</b><p>AI-curated recommendations based on your profile and wardrobe.</p></article>
        ))}
      </aside>
    </main>
  );
}

function Login({ setUser }) {
  const submit = (event) => {
    event.preventDefault();
    setUser(demoUser());
    routeTo('/shop');
  };

  return (
    <main className="atelier-login">
      <aside>
        <img src={asset('hero1.png')} alt="" />
        <AppLink href="/">FITLOOK</AppLink>
        <h1>AI Fashion Try-On Experience</h1>
        <p>See it on you before you buy it. Experience the future of personal styling.</p>
        <dl>
          <div><dt>AI Try-On</dt><dd>Realistic virtual try-on technology.</dd></div>
          <div><dt>Smart Closet</dt><dd>Organize your style effortlessly.</dd></div>
          <div><dt>AI Stylist</dt><dd>Personalized recommendations for you.</dd></div>
        </dl>
      </aside>
      <section>
        <p className="top-switch">New to FitLook? <AppLink href="/signup">Sign up</AppLink></p>
        <form onSubmit={submit}>
          <h1>Welcome Back</h1>
          <p>Login to continue your fashion journey</p>
          <input required placeholder="Enter your email or User name" />
          <input required type="password" placeholder="Enter your password" />
          <div className="form-row"><label><input type="checkbox" /> Remember me</label><AppLink href="/signup">Forgot password?</AppLink></div>
          <button className="black-button" type="submit">Login →</button>
        </form>
      </section>
    </main>
  );
}

function Shop({ user }) {
  return (
    <main className="atelier-page">
      <AtelierHeader active="Shop" user={user} />
      <section className="shop-hero">
        <img src={asset('hero1.png')} alt="" />
        <div>
          <p>New Collection</p>
          <h1>Summer <em>Essentials</em></h1>
          <AppLink className="black-button" href="/collections">Shop Now →</AppLink>
        </div>
        <span>Up to <b>50%</b> off</span>
      </section>
      <CategoryStrip />
      <section className="service-strip">
        {['Trending Now', 'Best Sellers', 'New Arrivals', 'Fast Delivery'].map((item) => <article key={item}><b>{item}</b><span>Curated for today</span></article>)}
      </section>
      <ProductSection title="Seasonal Curations" subtitle="Essential pieces for the modern wardrobe." products={products.slice(0, 4)} />
      <section className="promo-grid">
        <AppLink href="/tokens"><span>Limited time offer</span><b>Up to 50% Off</b></AppLink>
        <AppLink href="/shop"><b>Free Shipping</b><span>On orders over $75</span></AppLink>
      </section>
      <LookSection />
      <Newsletter />
      <AtelierFooter />
    </main>
  );
}

function Collections({ user }) {
  return (
    <main className="atelier-page">
      <AtelierHeader active="Collections" user={user} />
      <section className="collection-hero">
        <img src={asset('hero2.png')} alt="" />
        <div>
          <p>New Collection</p>
          <h1>The Art of Summer</h1>
          <span>Lightness in layers. Timeless comfort. Made for wherever summer takes you.</span>
          <AppLink className="black-button" href="/product/archive-knit-dress">Shop Now →</AppLink>
          <AppLink className="outline-link" href="/style-bot">Explore Looks</AppLink>
        </div>
        <article><b>AI Try-On</b><p>See it on you. Before you buy.</p><AppLink href="/closet">Try Now</AppLink></article>
      </section>
      <CategoryStrip />
      <section className="promo-grid">
        <AppLink href="/tokens"><b>Sale</b><span>End of season savings</span></AppLink>
        <AppLink href="/shop"><b>Free Shipping</b><span>On all orders over $75</span></AppLink>
      </section>
      <ProductSection title="Curated New Arrivals" products={products.slice(4).concat(products.slice(0, 1))} />
      <LookSection editorial />
      <Newsletter />
      <AtelierFooter />
    </main>
  );
}

function CategoryStrip() {
  return (
    <section className="atelier-categories">
      <div className="section-title"><h2>Shop by Category</h2><AppLink href="/search">View all departments →</AppLink></div>
      <div>
        {categories.map(([label, image, href]) => <AppLink href={href} key={label}><img src={asset(image)} alt="" /><span>{label}</span></AppLink>)}
      </div>
    </section>
  );
}

function ProductSection({ title, subtitle, products: items }) {
  return (
    <section className="atelier-section">
      <div className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><AppLink href="/search">Explore all →</AppLink></div>
      <div className="atelier-product-grid">{items.map((product) => <ProductTile product={product} key={product.name} />)}</div>
    </section>
  );
}

function LookSection({ editorial = false }) {
  return (
    <section className={`look-section ${editorial ? 'editorial' : ''}`}>
      <p>{editorial ? 'Editorial' : ''}</p>
      <h2>Shop the Look</h2>
      <div>
        {['hero1.png', 'hero2.png', 'search-shirt-4.jpg'].map((image, index) => (
          <AppLink href="/style-bot" key={image}><img src={asset(image)} alt="" /><span>{index === 0 ? 'Modern Minimalist' : index === 1 ? 'Effortless Grace' : 'Weekend Classic'}</span></AppLink>
        ))}
      </div>
    </section>
  );
}

function Newsletter() {
  return (
    <section className="atelier-newsletter">
      <h2>Join the Atelier</h2>
      <p>Subscribe to receive early access to seasonal drops, private invitations, and high-fashion insights.</p>
      <form onSubmit={(event) => event.preventDefault()}><input placeholder="Your email address" /><button type="submit">Subscribe</button></form>
    </section>
  );
}

function Closet({ user }) {
  const wardrobe = {
    Tops: ['category-1.jpg', 'arrival-1.jpg', 'trending-2.jpg'],
    Bottoms: ['category-3.jpg', 'arrival-2.jpg', 'trending-3.jpg'],
    Outerwear: ['category-5.jpg', 'trending-4.jpg', 'arrival-3.jpg'],
    Shoes: ['category-6.jpg', 'trending-1.jpg', 'arrival-6.jpg']
  };
  const [selected, setSelected] = useState({ Tops: 0, Bottoms: 0, Outerwear: 1, Shoes: 0 });
  const [autoApply, setAutoApply] = useState(true);
  const score = 87 + Object.values(selected).reduce((sum, item) => sum + item, 0) % 7;

  return (
    <main className="closet-live">
      <AtelierHeader active="AI Try-On" user={user} compact />
      <aside className="wardrobe-panel">
        <h1>My Wardrobe</h1>
        {Object.entries(wardrobe).map(([group, images]) => (
          <section key={group}>
            <button type="button">{group}<span>⌄</span></button>
            <div>{images.map((image, index) => <button className={selected[group] === index ? 'active' : ''} type="button" key={image} onClick={() => setSelected({ ...selected, [group]: index })}><img src={asset(image)} alt="" /></button>)}</div>
          </section>
        ))}
        <AppLink className="black-button" href="/closet/add">+ Add New Item</AppLink>
      </aside>
      <section className="model-stage">
        <img src={asset('hero2.png')} alt="Model preview" />
        <div className="stage-tools left"><button>Model</button><button>Hair</button><button>Body</button></div>
        <div className="stage-tools right"><button>Undo</button><button>Clear</button></div>
        <label className="auto-toggle"><input type="checkbox" checked={autoApply} onChange={(event) => setAutoApply(event.target.checked)} /> Auto-apply</label>
        <button className="generate-look" type="button">Generate Look</button>
        <button className="save-look" type="button">♡</button>
      </section>
      <aside className="recommend-panel">
        <h2>Recommendations</h2>
        {[0, 1, 2].map((row) => (
          <article key={row}>
            <div>{Object.entries(wardrobe).slice(0, 3).map(([group, images]) => <><img src={asset(images[(selected[group] + row) % images.length])} alt="" /><span>+</span></>)}</div>
            <button type="button">Try This Look</button>
          </article>
        ))}
        <section className="style-score"><b>{score}</b><div><strong>Great Choice!</strong><p>This look suits you.</p></div></section>
      </aside>
    </main>
  );
}

function ProductDetail({ user }) {
  const [size, setSize] = useState('S');
  const [color, setColor] = useState('Charcoal');
  const [main, setMain] = useState('arrival-4.jpg');

  return (
    <main className="atelier-page detail-view">
      <AtelierHeader active="Collections" user={user} />
      <section className="product-live-detail">
        <div>
          <img className="main-product-image" src={asset(main)} alt="Archive Knit Dress" />
          <div className="thumbs">{['arrival-4.jpg', 'search-shirt-1.jpg', 'trending-5.jpg', 'hero2.png'].map((image) => <button className={main === image ? 'active' : ''} type="button" key={image} onClick={() => setMain(image)}><img src={asset(image)} alt="" /></button>)}</div>
        </div>
        <article>
          <p>FitLook Signature</p>
          <h1>Archive Knit Dress</h1>
          <strong>$485.00</strong>
          <label>Selection: {color}</label>
          <div className="swatch-row">{['Charcoal', 'Ivory', 'Black'].map((item) => <button className={color === item ? 'active' : ''} type="button" aria-label={item} key={item} onClick={() => setColor(item)} />)}</div>
          <div className="size-row">{['XS', 'S', 'M', 'L'].map((item) => <button className={size === item ? 'active' : ''} type="button" key={item} onClick={() => setSize(item)}>{item}</button>)}</div>
          <dl className="product-facts"><div><dt>Brand</dt><dd>FitLook Signature</dd></div><div><dt>Category</dt><dd>Knitwear</dd></div><div><dt>Fit</dt><dd>Regular Fit</dd></div><div><dt>For</dt><dd>Women</dd></div></dl>
          <div className="detail-actions"><button className="black-button" type="button">Shop</button><AppLink className="outline-link" href="/closet">Try On</AppLink><AppLink className="outline-link" href="/custom-try-on">Video</AppLink></div>
          {['Product Details', 'Fit & Care', 'Shipping & Returns'].map((item) => <details key={item}><summary>{item}</summary><p>Premium materials, precise construction, and modern styling for everyday elegance.</p></details>)}
        </article>
      </section>
      <section className="fabric-story"><div><h2>The Fabric of <em>Modernity</em></h2><p>Designed at the intersection of architectural form and tactile luxury, each piece is meticulously woven for contemporary elegance.</p></div><img src={asset('hero2.png')} alt="" /></section>
      <ProductSection title="Complete the Look" products={products.slice(5)} />
      <AtelierFooter />
    </main>
  );
}

function Stylist({ user }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Buongiorno. Based on your preference for structured silhouettes, I curated a selection that balances contemporary edge with classic craftsmanship.", cards: products.slice(6, 8) },
    { role: 'user', text: 'The blazer is stunning. Can we pair it with something more casual?' }
  ]);
  const [draft, setDraft] = useState('');

  const send = (event) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setMessages([...messages, { role: 'user', text: draft }, { role: 'assistant', text: 'Absolutely. I would ground it with denim, a soft knit, and a minimal sneaker for a refined casual line.', cards: products.slice(0, 2) }]);
    setDraft('');
  };

  return (
    <main className="stylist-live">
      <aside>
        <h2>Styling Sessions</h2>
        {['Milan Fashion Week Prep', 'Summer Garden Party', 'Minimalist Capsule'].map((item, index) => <button className={index === 0 ? 'active' : ''} type="button" key={item}><b>{item}</b><span>{index === 0 ? 'Today, 2:45 PM' : 'Yesterday'}</span></button>)}
        <button className="new-session" type="button">+ New Session</button>
      </aside>
      <section>
        <h1>FitLook Concierge</h1>
        <div className="chat-stream">
          {messages.map((message, index) => (
            <article className={message.role} key={`${message.role}-${index}`}>
              <p>{message.text}</p>
              {message.cards && <div className="chat-products">{message.cards.map((product) => <ProductTile product={product} small key={product.name} />)}</div>}
            </article>
          ))}
        </div>
        <form className="concierge-input" onSubmit={send}>
          <input value={draft} placeholder="Ask your stylist anything..." onChange={(event) => setDraft(event.target.value)} />
          <button type="submit">➤</button>
        </form>
        <div className="prompt-row">{['Evening Accessories', 'Try-on Virtuel', 'Size Guide'].map((item) => <button type="button" key={item} onClick={() => setDraft(item)}>{item}</button>)}</div>
      </section>
    </main>
  );
}

function ClosetAdd() {
  const [preview, setPreview] = useState('');
  const [tags, setTags] = useState(['#sustainable', '#vintage']);

  return (
    <main className="studio-live">
      <section className="studio-head"><h1>Curate Your Studio</h1><p>Add a new piece to your digital archive. High-quality imagery ensures accurate AI-generated outfit recommendations and virtual try-ons.</p></section>
      <section className="studio-grid">
        <div>
          <label className={`large-upload ${preview ? 'has-preview' : ''}`}>
            <input type="file" accept="image/*" onChange={(event) => setPreview(event.target.files?.[0] ? URL.createObjectURL(event.target.files[0]) : '')} />
            {preview ? <img src={preview} alt="Clothing preview" /> : <span>Upload Clothing Photo<small>Drag and drop or click to browse</small></span>}
          </label>
          <div className="mini-upload-row"><button type="button">Camera</button>{preview && <img src={preview} alt="" />}<button type="button">+</button></div>
        </div>
        <form className="spec-card" onSubmit={(event) => event.preventDefault()}>
          <p>Archive Entry: Dress</p><h2>Item Specifications</h2>
          {['Dress Name', 'Type', 'Color', 'Fabric', 'Pattern', 'Vibe', 'Occasion'].map((label) => <label key={label}>{label}<input placeholder={label === 'Dress Name' ? 'e.g. Moonlight Silk Slip' : ''} /></label>)}
          <div className="tag-row">{tags.map((tag) => <button type="button" key={tag} onClick={() => setTags(tags.filter((item) => item !== tag))}>{tag} x</button>)}</div>
          <div className="form-actions"><button className="outline-link" type="reset">Discard Draft</button><button className="black-button" type="submit">Save Clothing Item</button></div>
        </form>
      </section>
    </main>
  );
}

function CustomTryOn() {
  const [garment, setGarment] = useState('');
  const [ready, setReady] = useState(false);

  return (
    <main className="atelier-page custom-live">
      <section className="custom-head"><h1>Custom Try-On</h1><p>Transform your digital wardrobe. Upload a flat garment photo and our AI will render it onto a high-fashion model contextually.</p></section>
      <label className="wide-upload"><input type="file" accept="image/*" onChange={(event) => { setGarment(event.target.files?.[0] ? URL.createObjectURL(event.target.files[0]) : ''); setReady(false); }} />Upload Clothing Photo<span>Browse Files</span></label>
      <section className="tryon-preview">
        <article><p>Garment Preview</p>{garment ? <img src={garment} alt="Garment" /> : <img src={asset('arrival-5.jpg')} alt="" />}</article>
        <button type="button">✦</button>
        <article><p>Generated Try-On</p><img src={asset('hero2.png')} alt="" /><span>{ready ? 'Rendered preview ready' : 'Ready for rendering'}</span></article>
      </section>
      <button className="pill-button" type="button" onClick={() => setReady(true)}>Generate Custom Try-On</button>
      <ProductSection title="Style with Confidence" products={products.slice(5, 8)} />
      <AtelierFooter />
    </main>
  );
}

function Wishlist({ user }) {
  const [filter, setFilter] = useState('All Items');
  const [saved, setSaved] = useState(products.concat(products.slice(0, 4)));
  const visible = filter === 'All Items' ? saved : saved.filter((item) => item.category.toLowerCase().includes(filter.toLowerCase().replace('clothing', '')));

  return (
    <main className="atelier-page wishlist-live">
      <AtelierHeader active="Shop" user={user} />
      <section className="wishlist-head"><div><h1>My Wishlist ({saved.length})</h1><p>Your saved favorites</p></div><div><button type="button">+ Create Collection</button><button type="button">Share Wishlist</button></div></section>
      <div className="filter-row">{['All Items', 'Clothing', 'Footwear', 'Accessories'].map((item) => <button className={filter === item ? 'active' : ''} type="button" key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <div className="wishlist-grid">{visible.map((product, index) => <ProductTile product={product} key={`${product.name}-${index}`} onFavorite={() => setSaved(saved.filter((_, itemIndex) => itemIndex !== index))} />)}</div>
      <ProductSection title="You May Also Like" products={products.slice(0, 5)} />
      <section className="upgrade-banner"><div><h2>Upgrade to Pro</h2><p>Unlock unlimited try-ons, premium features and more.</p></div><AppLink className="black-button" href="/tokens">Upgrade Now</AppLink></section>
      <AtelierFooter />
    </main>
  );
}

function Credits({ user }) {
  const [plan, setPlan] = useState('Atelier');
  const plans = [
    ['Essentials', '500', '$29.00', ['50 AI Try-On Renders', 'Weekly Style Brief']],
    ['Atelier', '1500', '$75.00', ['180 AI Try-On Renders', 'Daily Style Forecasts', 'Priority Neural Rendering']],
    ['Master', '5000', '$220.00', ['600+ AI Try-On Renders', 'Full Portfolio Syncing', 'Bespoke AI Personal Shopper']]
  ];
  const selected = plans.find(([name]) => name === plan) || plans[1];

  return (
    <main className="credits-live">
      <section><p>Curation Power</p><h1>Credits</h1><span>Elevate your digital wardrobe experience. Credits empower high-fidelity virtual try-ons and personalized stylistic narratives.</span></section>
      <div className="credits-grid">
        <div className="plan-grid">{plans.map(([name, credits, price, perks]) => <button className={plan === name ? 'active' : ''} type="button" key={name} onClick={() => setPlan(name)}><span>{name}</span><b>{credits}</b><small>Credits</small><strong>{price}</strong>{perks.map((perk) => <p key={perk}>✓ {perk}</p>)}</button>)}</div>
        <aside className="order-summary"><h2>Order Summary</h2><p>{selected[0]} Package ({selected[1]} Credits)<b>{selected[2]}</b></p><p>Regional Tax (8%)<b>$6.00</b></p><p>Processing Fee<b>Free</b></p><strong>Total Amount <span>$81.00</span></strong><button className="black-button" type="button">Secure Checkout →</button><small>Encrypted 256-bit SSL connection</small></aside>
      </div>
      <section className="payment-methods"><h2>Payment Method</h2><button type="button" className="active">Visa Expires 12/26 ✓</button><button type="button">UPI One-tap checkout</button></section>
    </main>
  );
}

function Profile({ user, setUser }) {
  const activeUser = user || demoUser();
  const [photo, setPhoto] = useState(activeUser.bodyPhotoUrl);
  const logout = () => {
    setUser(null);
    routeTo('/');
  };

  return (
    <main className="profile-live">
      <AtelierHeader active="Shop" user={activeUser} compact />
      <section className="profile-title"><h1>My Profile</h1><p>Manage your account and preferences</p></section>
      <section className="profile-card-live"><div><h2>{activeUser.name}<span>Fashion Lover</span></h2><p>{activeUser.email}</p><p>Joined May 2024</p><p>Mumbai, India</p></div><button type="button">Edit Profile</button></section>
      <section className="credits-card"><h2>Remaining Credits</h2><b>{activeUser.tokens}<span> credits</span></b><meter value="72" min="0" max="100" /><AppLink className="black-button" href="/tokens">+ Buy More Credits</AppLink></section>
      <section className="portrait-card"><div><h2>Try-On Portraits</h2><p>Manage the photos used for your AI-driven virtual try-on sessions.</p></div><img src={photo} alt="Current portrait" /><label className="wide-upload"><input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0] ? URL.createObjectURL(event.target.files[0]) : photo)} />Upload New Photo<span>Browse Files</span></label></section>
      <section className="settings-card">{['Username', 'Email Address', 'Change Password', 'Terms & Conditions', 'Privacy Policy'].map((item) => <button type="button" key={item}>{item}<span>›</span></button>)}<button className="logout" type="button" onClick={logout}>Logout</button></section>
      <AtelierFooter />
    </main>
  );
}
