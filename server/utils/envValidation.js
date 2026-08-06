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

  return { warnings };
}
