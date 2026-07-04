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
tryOnSchema.index({ user: 1, createdAt: -1 });

function tryOnToClient(tryOn) {
  return {
    id: tryOn._id.toString(),
    productId: tryOn.product.toString(),
    imageUrl: tryOn.image?.path ? `/${tryOn.image.path}` : null,
    provider: tryOn.provider,
    model: tryOn.model,
    quality: tryOn.quality,
    tokenCost: tryOn.tokenCost,
    createdAt: tryOn.createdAt
  };
}

tryOnSchema.methods.toClient = function toClient() {
  return tryOnToClient(this);
};

export default mongoose.model('TryOn', tryOnSchema);
export { tryOnToClient };
