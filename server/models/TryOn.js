import mongoose from 'mongoose';

const tryOnSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    provider: { type: String, default: 'fal' },
    model: { type: String, default: 'openai/gpt-image-2/edit' },
    quality: { type: String, default: 'low' },
    prompt: { type: String, trim: true },
    tokenCost: { type: Number, default: 1 },
    image: {
      filename: String,
      path: String,
      mimetype: String,
      size: Number
    }
  },
  { timestamps: true }
);

tryOnSchema.index({ user: 1, product: 1 }, { unique: true });

tryOnSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    productId: this.product.toString(),
    imageUrl: this.image?.path ? `/${this.image.path}` : null,
    provider: this.provider,
    model: this.model,
    quality: this.quality,
    tokenCost: this.tokenCost,
    createdAt: this.createdAt
  };
};

export default mongoose.model('TryOn', tryOnSchema);
