import mongoose from 'mongoose';

function signupTokens() {
  const value = Number(process.env.SIGNUP_FREE_TOKENS || 4);
  return Number.isFinite(value) && value >= 0 ? value : 4;
}

function devMode() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.DEV_MODE || '').toLowerCase());
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, unique: true, required: true },
    passwordHash: { type: String, required: true },
    tokens: { type: Number, default: signupTokens },
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
    tokens: this.tokens,
    devMode: devMode(),
    bodyPhotoUrl: this.bodyPhoto?.path ? `/${this.bodyPhoto.path}` : null
  };
};

export default mongoose.model('User', userSchema);
