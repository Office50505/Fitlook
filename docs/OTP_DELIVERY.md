# OTP Delivery Configuration

Production OTP delivery is server-to-server only. The frontend receives an opaque `otpSession`, the normalized phone number, and a generic status message. It must never receive the raw OTP.

## Production Required Variables

- `OTP_DELIVERY_PROVIDER=webhook`
- `OTP_DELIVERY_WEBHOOK_URL=https://...`
- `OTP_DELIVERY_WEBHOOK_TOKEN=...` when required by the SMS/OTP provider
- `OTP_DELIVERY_TIMEOUT_MS=5000` or another bounded timeout in milliseconds

The webhook receives:

```json
{
  "phone": "+919876543210",
  "otp": "123456",
  "purpose": "signup"
}
```

The webhook URL and token are server environment values only. Do not expose them through Vite variables or client-rendered config.

## Failure Behavior

If delivery is not configured, times out, returns a non-2xx status, or returns a malformed response, the API fails safely with a generic user-facing error and removes the temporary OTP challenge. The OTP is not logged.

## Local Automation

`OTP_DELIVERY_PROVIDER=mock` is available only outside production for automated browser/API tests. It requires `OTP_MOCK_STORE_PATH` and writes delivered OTP records to that server-local file. This is not a production provider and is rejected when `NODE_ENV=production`.
