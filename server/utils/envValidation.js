const REQUIRED_SERVER_ENV = ['MONGODB_URI', 'JWT_SECRET'];

const FEATURE_ENV_GROUPS = [
  {
    name: 'PhonePe payments',
    keys: ['PHONEPE_CLIENT_ID', 'PHONEPE_CLIENT_SECRET', 'PHONEPE_CLIENT_VERSION', 'PHONEPE_MERCHANT_ID']
  },
  {
    name: 'FAL AI generation',
    keys: ['FAL_KEY']
  },
  {
    name: 'FitRoom try-on',
    keys: ['FITROOM_API_KEY']
  }
];

export function validateServerEnv(env = process.env) {
  const missing = REQUIRED_SERVER_ENV.filter((key) => !String(env[key] || '').trim());
  if (missing.length) {
    throw new Error(`Missing required server environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }

  const warnings = FEATURE_ENV_GROUPS.flatMap((group) => {
    const present = group.keys.filter((key) => String(env[key] || '').trim());
    if (!present.length || present.length === group.keys.length) return [];
    const missingFeatureKeys = group.keys.filter((key) => !String(env[key] || '').trim());
    return [`${group.name} is partially configured. Missing: ${missingFeatureKeys.join(', ')}`];
  });
  const otpProvider = String(env.OTP_DELIVERY_PROVIDER || '').trim().toLowerCase();
  if (otpProvider && !['disabled', 'mock', 'webhook'].includes(otpProvider)) {
    warnings.push(`OTP delivery provider "${otpProvider}" is unsupported.`);
  }
  if (otpProvider === 'webhook' && !String(env.OTP_DELIVERY_WEBHOOK_URL || '').trim()) {
    warnings.push('OTP delivery webhook is configured but OTP_DELIVERY_WEBHOOK_URL is missing.');
  }
  if (otpProvider === 'mock' && String(env.NODE_ENV || '').toLowerCase() === 'production') {
    warnings.push('Mock OTP delivery is not allowed in production.');
  }
  if (otpProvider === 'mock' && !String(env.OTP_MOCK_STORE_PATH || '').trim()) {
    warnings.push('Mock OTP delivery is configured but OTP_MOCK_STORE_PATH is missing.');
  }

  return { warnings };
}
