import mongoose from 'mongoose';

const tryOnImageSchema = {
  filename: String,
  path: String,
  url: String,
  storage: { type: String, trim: true },
  mimetype: String,
  size: Number
};

const imageProcessingSchema = {
  sourceImageUrl: String,
  transparentImageUrl: String,
  processingStatus: { type: String, enum: ['idle', 'queued', 'processing', 'completed', 'failed'], default: 'idle' },
  processingProvider: String,
  processingVersion: String,
  processedAt: Date,
  sourceWidth: Number,
  sourceHeight: Number,
  transparentWidth: Number,
  transparentHeight: Number,
  processingError: String,
  segmentationModel: String,
  segmentationModelsUsed: [String],
  failedSegmentationModels: [mongoose.Schema.Types.Mixed],
  inferenceResolution: String,
  maskSettings: mongoose.Schema.Types.Mixed,
  repairedPixels: Number,
  foregroundAreaRatio: Number,
  connectedComponents: Number,
  torsoCoverage: Number,
  footCoverage: Number,
  headCoverage: Number,
  armCoverage: Number,
  legCoverage: Number,
  internalHoleRatio: Number,
  largestInternalHoleRatio: Number,
  edgeNoiseRatio: Number,
  qualityScore: Number,
  qualityPassed: Boolean,
  qualityReasons: [String],
  retryModelUsed: String,
  debugMaskPreview: mongoose.Schema.Types.Mixed,
  cached: Boolean
};

const tryOnSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    provider: { type: String, default: 'fal' },
    model: { type: String, default: 'openai/gpt-image-2/edit' },
    quality: { type: String, default: 'low' },
    prompt: { type: String, trim: true },
    tokenCost: { type: Number, default: 1 },
    image: tryOnImageSchema,
    transparentImage: tryOnImageSchema,
    imageProcessing: imageProcessingSchema,
    video: {
      filename: String,
      path: String,
      url: String,
      storage: { type: String, trim: true },
      mimetype: String,
      size: Number,
      model: String,
      prompt: String,
      tokenCost: Number,
      generatedAt: Date
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
    imageUrl: tryOn.image?.url || (tryOn.image?.path ? `/${tryOn.image.path}` : null),
    transparentImageUrl: tryOn.transparentImage?.url || (tryOn.transparentImage?.path ? `/${tryOn.transparentImage.path}` : (tryOn.imageProcessing?.transparentImageUrl || null)),
    imageProcessing: tryOn.imageProcessing || null,
    videoUrl: tryOn.video?.url || (tryOn.video?.path ? `/${tryOn.video.path}` : null),
    videoModel: tryOn.video?.model || '',
    videoTokenCost: tryOn.video?.tokenCost || 0,
    videoGeneratedAt: tryOn.video?.generatedAt || null,
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
