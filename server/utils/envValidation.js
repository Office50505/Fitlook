import { isProductionEnv, validateConfiguredHttpsUrl } from './urlValidation.js';
import { passwordHashingConfig } from './passwordHashing.js';

const REQUIRED_SERVER_ENV = ['MONGODB_URI', 'JWT_SECRET'];

const FEATURE_ENV_GROUPS = [
  {
    name: 'PhonePe payments',
    keys: ['PHONEPE_CLIENT_ID', 'PHONEPE_CLIENT_SECRET', 'PHONEPE_CLIENT_VERSION', 'PHONEPE_CALLBACK_USERNAME', 'PHONEPE_CALLBACK_PASSWORD']
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

const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

function featureEnabled(env, key, defaultValue = true) {
  const value = String(env[key] ?? '').trim().toLowerCase();
  if (!value) return defaultValue;
  return !FALSE_ENV_VALUES.has(value);
}

function validateProductionAiConfiguration(env, errors) {
  if (!isProductionEnv(env) || !featureEnabled(env, 'AI_FEATURES_ENABLED', true)) return;
  const imageProvider = String(env.AI_PROVIDER || 'pruna').trim().toLowerCase();
  const videoProvider = String(env.TRYON_VIDEO_PROVIDER || 'pixverse').trim().toLowerCase();
  const required = new Map();
  const requireKey = (key, feature) => {
    if (!required.has(key)) required.set(key, []);
    required.get(key).push(feature);
  };

  if (!['pruna', 'fitroom'].includes(imageProvider)) {
    errors.push(`Unsupported AI_PROVIDER "${imageProvider}" in production.`);
  } else if (imageProvider === 'pruna') requireKey('PRUNA_API_KEY', 'Pruna image try-on');
  else requireKey('FITROOM_API_KEY', 'FitRoom image try-on');

  if (!['pruna', 'pixverse', 'fal'].includes(videoProvider)) {
    errors.push(`Unsupported TRYON_VIDEO_PROVIDER "${videoProvider}" in production.`);
  } else if (videoProvider === 'pruna') requireKey('PRUNA_API_KEY', 'Pruna video generation');
  else requireKey('FAL_KEY', 'PixVerse video generation');

  if (featureEnabled(env, 'PROFILE_FULL_BODY_GENERATION', true)) {
    requireKey('FAL_KEY', 'full-body profile generation');
  }
  if (featureEnabled(env, 'CLOSET_GENERATION_ENABLED', true)) {
    requireKey('FITROOM_API_KEY', 'closet outfit generation');
  }

  for (const [key, features] of required) {
    if (!String(env[key] || '').trim()) {
      errors.push(`${key} is required in production for ${features.join(' and ')}.`);
    }
  }
}

export function phonePeEnabled(env = process.env) {
  const value = String(env.PHONEPE_ENABLED || '').trim().toLowerCase();
  return value ? !FALSE_ENV_VALUES.has(value) : true;
}

function fixedOtpAllowedInProduction(env = process.env) {
  return TRUE_ENV_VALUES.has(String(env.ALLOW_FIXED_OTP_IN_PRODUCTION || '').trim().toLowerCase());
}

export function validateServerEnv(env = process.env) {
  const errors = [];
  const missing = REQUIRED_SERVER_ENV.filter((key) => !String(env[key] || '').trim());
  if (missing.length) errors.push(`Missing required server environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);

  const production = isProductionEnv(env);
  validateProductionAiConfiguration(env, errors);
  try {
    passwordHashingConfig(env);
  } catch (error) {
    errors.push(error.message);
  }
  const assertUrl = (key, options = {}) => {
    const value = String(env[key] || '').trim();
    if (!value) return;
    try {
      validateConfiguredHttpsUrl(value, { name: key, env, ...options });
    } catch (error) {
      errors.push(error.message);
    }
  };

  const otpProvider = String(env.OTP_DELIVERY_PROVIDER || '').trim().toLowerCase();
  const allowProductionFixedOtp = fixedOtpAllowedInProduction(env);
  const paymentsEnabled = phonePeEnabled(env);
  if (production && !['msg91', 'webhook', 'disabled'].includes(otpProvider)) {
    errors.push('Production requires OTP_DELIVERY_PROVIDER=msg91, webhook, or disabled.');
  }

  const warnings = FEATURE_ENV_GROUPS.flatMap((group) => {
    if (group.name === 'PhonePe payments' && !paymentsEnabled) return [];
    const present = group.keys.filter((key) => String(env[key] || '').trim());
    if (!present.length || present.length === group.keys.length) return [];
    const missingFeatureKeys = group.keys.filter((key) => !String(env[key] || '').trim());
    return [`${group.name} is partially configured. Missing: ${missingFeatureKeys.join(', ')}`];
  });
  if (otpProvider && !['disabled', 'mock', 'msg91', 'webhook'].includes(otpProvider)) {
    warnings.push(`OTP delivery provider "${otpProvider}" is unsupported.`);
  }
  if (otpProvider === 'msg91') {
    const missingMsg91Keys = ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID'].filter((key) => !String(env[key] || '').trim());
    if (missingMsg91Keys.length) {
      const message = `MSG91 OTP delivery is partially configured. Missing: ${missingMsg91Keys.join(', ')}`;
      if (production) errors.push(message);
      else warnings.push(message);
    }
    if (String(env.MSG91_BASE_URL || '').trim()) assertUrl('MSG91_BASE_URL');
  }
  if (otpProvider === 'webhook' && !String(env.OTP_DELIVERY_WEBHOOK_URL || '').trim()) {
    const message = 'OTP delivery webhook is configured but OTP_DELIVERY_WEBHOOK_URL is missing.';
    if (production) errors.push(message);
    else warnings.push(message);
  }
  if (otpProvider === 'webhook') {
    assertUrl('OTP_DELIVERY_WEBHOOK_URL');
  }
  if (otpProvider === 'mock' && String(env.NODE_ENV || '').toLowerCase() === 'production') {
    const message = 'Mock OTP delivery is not allowed in production.';
    if (production) errors.push(message);
    else warnings.push(message);
  }
  if (String(env.OTP_FIXED_CODE || '').trim()) {
    const validFixedCode = /^\d{6}$/.test(String(env.OTP_FIXED_CODE || '').trim());
    if (!validFixedCode) {
      errors.push('OTP_FIXED_CODE must be exactly 6 digits.');
    } else if (production && !allowProductionFixedOtp) {
      errors.push('OTP_FIXED_CODE is not allowed in production.');
    } else if (otpProvider && otpProvider !== 'mock' && otpProvider !== 'disabled') {
      warnings.push('OTP_FIXED_CODE only applies when OTP_DELIVERY_PROVIDER=mock or disabled.');
    }
  }
  if (otpProvider === 'mock' && !String(env.OTP_MOCK_STORE_PATH || '').trim()) {
    warnings.push('Mock OTP delivery is configured but OTP_MOCK_STORE_PATH is missing.');
  }

  if (paymentsEnabled) assertUrl('PHONEPE_REDIRECT_URL');
  assertUrl('CLIENT_ORIGIN');
  const phonePeKeys = FEATURE_ENV_GROUPS.find((group) => group.name === 'PhonePe payments').keys;
  const presentPhonePeKeys = phonePeKeys.filter((key) => String(env[key] || '').trim());
  if (production && paymentsEnabled && presentPhonePeKeys.length && presentPhonePeKeys.length !== phonePeKeys.length) {
    const missingPhonePeKeys = phonePeKeys.filter((key) => !String(env[key] || '').trim());
    errors.push(`PhonePe payments are partially configured. Missing: ${missingPhonePeKeys.join(', ')}`);
  }

  if (errors.length) throw new Error(errors.join(' '));
  return { warnings };
}

export function configurationReadiness(env = process.env) {
  const otpProvider = String(env.OTP_DELIVERY_PROVIDER || '').trim().toLowerCase();
  const paymentsEnabled = phonePeEnabled(env);
  const phonePeKeys = ['PHONEPE_CLIENT_ID', 'PHONEPE_CLIENT_SECRET', 'PHONEPE_CLIENT_VERSION', 'PHONEPE_CALLBACK_USERNAME', 'PHONEPE_CALLBACK_PASSWORD'];
  const phonePeConfigured = phonePeKeys.every((key) => Boolean(String(env[key] || '').trim()));
  const fixedOtpConfigured = isProductionEnv(env)
    && fixedOtpAllowedInProduction(env)
    && /^\d{6}$/.test(String(env.OTP_FIXED_CODE || '').trim())
    && (!otpProvider || otpProvider === 'disabled' || otpProvider === 'mock');
  const msg91Configured = ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID']
    .every((key) => Boolean(String(env[key] || '').trim()));
  const otpConfigured = otpProvider === 'msg91'
    ? msg91Configured
    : otpProvider === 'webhook'
    ? Boolean(String(env.OTP_DELIVERY_WEBHOOK_URL || '').trim())
    : otpProvider === 'mock'
      ? !isProductionEnv(env) && Boolean(String(env.OTP_MOCK_STORE_PATH || '').trim())
      : fixedOtpConfigured;

  return {
    otpProvider: fixedOtpConfigured ? 'configured' : otpProvider === 'disabled' ? 'disabled' : otpConfigured ? 'configured' : 'not_configured',
    otpProviderType: fixedOtpConfigured ? 'fixed' : otpProvider || 'disabled',
    phonePe: !paymentsEnabled ? 'disabled' : phonePeConfigured ? 'configured' : 'not_configured'
  };
}
