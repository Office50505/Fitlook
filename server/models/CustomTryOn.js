import mongoose from 'mongoose';

const customTryOnSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, default: 'fal' },
    model: { type: String, default: 'openai/gpt-image-2/edit' },
    quality: { type: String, default: 'low' },
    prompt: { type: String, trim: true },
    tokenCost: { type: Number, default: 1 },
    garment: {
      filename: String,
      path: String,
      mimetype: String,
      size: Number
    },
    image: {
      filename: String,
      path: String,
      mimetype: String,
      size: Number
    }
  },
  { timestamps: true }
);

customTryOnSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    imageUrl: this.image?.path ? `/${this.image.path}` : null,
    garmentUrl: this.garment?.path ? `/${this.garment.path}` : null,
    provider: this.provider,
    model: this.model,
    quality: this.quality,
    tokenCost: this.tokenCost,
    createdAt: this.createdAt
  };
};

export default mongoose.model('CustomTryOn', customTryOnSchema);
