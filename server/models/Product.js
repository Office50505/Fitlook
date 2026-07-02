import mongoose from 'mongoose';

function decodeHtml(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

const productSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    brand: { type: String, trim: true, required: true },
    category: { type: String, trim: true, required: true },
    gender: { type: String, trim: true, default: 'unisex' },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0 },
    currency: { type: String, trim: true, uppercase: true, default: 'USD' },
    rating: { type: Number, min: 0, max: 5, default: 4.5 },
    ratingCount: { type: Number, min: 0, default: 0 },
    badge: { type: String, trim: true },
    affiliateLink: { type: String, trim: true },
    description: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    colors: [{ type: String, trim: true }],
    tryOnModel: {
      type: String,
      enum: ['gpt-image-2', 'vto-unrestricted'],
      default: 'gpt-image-2'
    },
    image: {
      filename: String,
      path: String,
      remoteUrl: String,
      mimetype: String,
      size: Number
    },
    sourceUrl: { type: String, trim: true },
    isFeatured: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

productSchema.index({
  name: 'text',
  brand: 'text',
  category: 'text',
  gender: 'text',
  description: 'text',
  tags: 'text'
});

productSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    name: decodeHtml(this.name),
    brand: decodeHtml(this.brand),
    category: decodeHtml(this.category),
    gender: this.gender,
    price: this.price,
    compareAtPrice: this.compareAtPrice,
    currency: this.currency || 'USD',
    rating: this.rating,
    ratingCount: this.ratingCount,
    badge: this.badge,
    affiliateLink: this.affiliateLink,
    sourceUrl: this.sourceUrl,
    description: decodeHtml(this.description),
    tags: this.tags?.map(decodeHtml),
    colors: this.colors,
    tryOnModel: this.tryOnModel || 'gpt-image-2',
    imageUrl: this.image?.path ? `/${this.image.path}` : this.image?.remoteUrl || null,
    isFeatured: this.isFeatured,
    isNewArrival: this.isNewArrival,
    createdAt: this.createdAt
  };
};

export default mongoose.model('Product', productSchema);
