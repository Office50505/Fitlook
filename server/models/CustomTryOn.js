import mongoose from 'mongoose';

const tryOnImageSchema = {
  filename: String,
  path: String,
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
    image: tryOnImageSchema,
    transparentImage: tryOnImageSchema,
    imageProcessing: imageProcessingSchema
  },
  { timestamps: true }
);

customTryOnSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    imageUrl: this.image?.path ? `/${this.image.path}` : null,
    transparentImageUrl: this.transparentImage?.path ? `/${this.transparentImage.path}` : (this.imageProcessing?.transparentImageUrl || null),
    imageProcessing: this.imageProcessing || null,
    garmentUrl: this.garment?.path ? `/${this.garment.path}` : null,
    provider: this.provider,
    model: this.model,
    quality: this.quality,
    tokenCost: this.tokenCost,
    createdAt: this.createdAt
  };
};

export default mongoose.model('CustomTryOn', customTryOnSchema);
