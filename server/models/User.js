import mongoose from 'mongoose';

function signupTokens() {
  const value = Number(process.env.SIGNUP_FREE_TOKENS || 20);
  return Number.isFinite(value) && value >= 0 ? value : 20;
}

function defaultDevMode() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.SIGNUP_DEV_MODE_DEFAULT || '').toLowerCase());
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, unique: true, required: true },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true
    },
    passwordHash: { type: String, required: true },
    tokens: { type: Number, default: signupTokens },
    devMode: { type: Boolean, default: defaultDevMode },
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
      mimetype: String,
      size: Number
    }
  },
  { timestamps: true }
);

userSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    username: this.username,
    tokens: this.tokens,
    subscription: {
      planId: this.subscription?.planId || null,
      status: this.subscription?.status || 'none',
      tokensPerMonth: this.subscription?.tokensPerMonth || 0,
      currentPeriodStart: this.subscription?.currentPeriodStart || null,
      currentPeriodEnd: this.subscription?.currentPeriodEnd || null
    },
    devMode: Boolean(this.devMode),
    joinedAt: this.createdAt,
    bodyPhotoUrl: this.bodyPhoto?.path ? `/${this.bodyPhoto.path}` : null
  };
};

export default mongoose.model('User', userSchema);
