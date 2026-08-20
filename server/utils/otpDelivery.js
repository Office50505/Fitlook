import { MockOtpProvider, WebhookOtpProvider, otpDeliveryFailure } from './otpProviders.js';
import { isProductionEnv } from './urlValidation.js';

function otpDeliveryProvider(env = process.env) {
  const provider = String(env.OTP_DELIVERY_PROVIDER || '').trim().toLowerCase();
  if (provider) return provider;
  return isProductionEnv(env) ? '' : 'mock';
}

function createOtpProvider(env = process.env) {
  const provider = otpDeliveryProvider(env);
  if (!provider || provider === 'disabled') {
    throw otpDeliveryFailure('OTP delivery is not configured');
  }
  if (provider === 'mock') return new MockOtpProvider(env);
  if (provider === 'webhook') return new WebhookOtpProvider(env);
  throw otpDeliveryFailure(`Unsupported OTP delivery provider: ${provider}`);
}

async function deliverOtp(message, env = process.env) {
  return createOtpProvider(env).deliver(message);
}

export { createOtpProvider, deliverOtp, otpDeliveryProvider };
