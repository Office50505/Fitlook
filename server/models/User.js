import mongoose from 'mongoose';

function signupTokens() {
  const value = Number(process.env.SIGNUP_FREE_TOKENS || 20);
  return Number.isFinite(value) && value >= 0 ? value : 20;
}

function defaultDevMode() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.SIGNUP_DEV_MODE_DEFAULT || '').toLowerCase());
}

function storedPhotoUrl(photo, user) {
  if (photo?.url) return photo.url;
  const path = photo?.path;
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const updatedAt = photo?.generatedAt || user.updatedAt || user.createdAt;
  const version = updatedAt ? new Date(updatedAt).getTime() : 0;
  return `/${path}${version ? `?v=${version}` : ''}`;
}

function bodyPhotoUrl(user) {
  return storedPhotoUrl(user.bodyPhoto, user);
}

function bodyPhotoOriginalUrl(user) {
  return storedPhotoUrl(user.bodyPhoto?.original, user);
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, unique: true, required: true },
    phone: { type: String, trim: true, unique: true, sparse: true },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true
    },
    passwordHash: { type: String, required: true },
    genderPreference: {
      type: String,
      enum: ['male', 'female', 'other'],
      default: 'other'
    },
    tokens: { type: Number, default: signupTokens },
    devMode: { type: Boolean, default: defaultDevMode },
    wishlistProducts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    }],
    subscription: {
      planId: { type: String, trim: true },
      status: { type: String, trim: true, default: 'none' },
      tokensPerMonth: { type: Number, default: 0 },
      currentPeriodStart: Date,
      currentPeriodEnd: Date,
      lastOrderId: { type: String, trim: true }
    },
    bodyPhoto: {
      filename: String,
      path: String,
      url: String,
      storage: { type: String, trim: true },
      mimetype: String,
      size: Number,
      status: { type: String, enum: ['uploaded', 'generating', 'ready', 'failed'], default: 'uploaded' },
      source: { type: String, trim: true },
      generatedAt: Date,
      error: String,
      original: {
        filename: String,
        path: String,
        url: String,
        storage: { type: String, trim: true },
        mimetype: String,
        size: Number
      }
    },
    onboardingSeenAt: Date
  },
  { timestamps: true }
);

userSchema.index({ createdAt: -1 });

userSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone,
    username: this.username,
    genderPreference: this.genderPreference || 'other',
    tokens: this.tokens,
    subscription: {
      planId: this.subscription?.planId || null,
      status: this.subscription?.status || 'none',
      tokensPerMonth: this.subscription?.tokensPerMonth || 0,
      currentPeriodStart: this.subscription?.currentPeriodStart || null,
      currentPeriodEnd: this.subscription?.currentPeriodEnd || null
    },
    devMode: Boolean(this.devMode),
    hasCompletedOnboarding: Boolean(this.onboardingSeenAt),
    onboardingSeenAt: this.onboardingSeenAt || null,
    wishlistCount: this.wishlistProducts?.length || 0,
    joinedAt: this.createdAt,
    bodyPhotoUrl: bodyPhotoUrl(this),
    bodyPhotoOriginalUrl: bodyPhotoOriginalUrl(this),
    bodyPhotoStatus: this.bodyPhoto?.status || 'uploaded',
    bodyPhotoSource: this.bodyPhoto?.source || 'upload',
    bodyPhotoGeneratedAt: this.bodyPhoto?.generatedAt || null
  };
};

export default mongoose.model('User', userSchema);
