import fs from 'node:fs/promises';

function otpDeliveryProvider(env = process.env) {
  return String(env.OTP_DELIVERY_PROVIDER || '').trim().toLowerCase();
}

function otpDeliveryFailure(message = 'OTP delivery is not configured') {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

async function deliverOtp({ phone, otp, purpose }, env = process.env) {
  const provider = otpDeliveryProvider(env);
  if (!provider || provider === 'disabled') {
    throw otpDeliveryFailure('OTP delivery is not configured');
  }

  if (provider === 'mock') {
    if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
      throw otpDeliveryFailure('Mock OTP delivery is not allowed in production');
    }
    const storePath = String(env.OTP_MOCK_STORE_PATH || '').trim();
    if (!storePath) throw otpDeliveryFailure('Mock OTP delivery store is not configured');
    await fs.appendFile(storePath, `${JSON.stringify({ phone, otp, purpose, createdAt: new Date().toISOString() })}\n`, 'utf8');
    return;
  }

  if (provider !== 'webhook') {
    throw otpDeliveryFailure(`Unsupported OTP delivery provider: ${provider}`);
  }

  const url = String(env.OTP_DELIVERY_WEBHOOK_URL || '').trim();
  if (!url) throw otpDeliveryFailure('OTP delivery webhook URL is not configured');
  const timeoutMs = Math.max(1000, Number(env.OTP_DELIVERY_TIMEOUT_MS || 5000));

  const headers = { 'Content-Type': 'application/json' };
  const bearer = String(env.OTP_DELIVERY_WEBHOOK_TOKEN || '').trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ phone, otp, purpose })
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw otpDeliveryFailure('OTP delivery timed out. Please try again.');
    throw otpDeliveryFailure('OTP delivery failed. Please try again.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response || typeof response.ok !== 'boolean' || !Number.isFinite(Number(response.status))) {
    throw otpDeliveryFailure('OTP delivery provider returned an invalid response');
  }

  if (!response.ok) {
    throw otpDeliveryFailure('OTP delivery provider rejected the request');
  }
}

export { deliverOtp, otpDeliveryProvider };
