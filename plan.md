# Demo Ecommerce Mode Plan

## Goal

Add an admin-controlled demo ecommerce mode that can switch the deployed Lookmefy storefront between:

- Affiliate mode: product CTAs send users to Amazon or another affiliate URL.
- Demo ecommerce mode: product CTAs send users to an internal checkout form and `Pay now` completes a simulated successful checkout popup without sending the user to PhonePe.

This plan was created before implementation. Current implementation status: backend models/routes, admin toggle, storefront checkout/status screens, demo policy overrides, and focused tests have been added. New planning change: demo mode should no longer redirect to PhonePe; it should show an in-site checkout success popup.

## Current State

- The customer storefront is the root Vite React app in `src/App.jsx`.
- The admin dashboard is the Vite admin app in `admin/src/AdminApp.jsx`.
- The backend is Express in `server/index.js`.
- Product order creation exists for demo checkout.
- PhonePe integration exists for credit/token purchases through `TokenOrder`, but demo product checkout should not redirect to PhonePe.
- Cart exists in `src/utils/cart.js`, but it is localStorage-only.
- Product buttons currently rely on `product.affiliateLink`.
- Cart checkout is currently disabled with "Checkout coming soon".
- Legal/policy pages currently describe affiliate marketplace behavior, not direct ecommerce fulfillment.

## Non-Goals For First Version

- Do not replace the existing affiliate flow.
- Do not remove credit/token payments.
- Do not merge `TokenOrder` and product ecommerce orders.
- Do not build cash on delivery.
- Do not build inventory reservation beyond basic product availability checks.
- Do not support international checkout.
- Do not save full address books unless added in a later phase.

## Feature Flag Design

Create a backend-controlled storefront setting:

```js
{
  demoEcommerceMode: true,
  updatedBy: adminId,
  updatedAt: date
}
```

When `demoEcommerceMode` is false:

- Product cards and product pages keep affiliate behavior.
- CTAs say "Shop" or "Shop now".
- External affiliate links remain active.
- Policy pages use affiliate/discovery wording.

When `demoEcommerceMode` is true:

- Product cards and product pages use internal ecommerce behavior.
- CTAs say "Buy" or "Buy now".
- Product detail checkout goes to `/checkout?productId=:id`.
- Cart checkout is enabled.
- Wishlist "Move to Bag" adds to internal cart.
- Policy pages use direct ecommerce wording.

## Backend Models

### StorefrontSetting

Purpose: Stores global storefront mode flags.

Fields:

- `demoEcommerceMode`: Boolean, default false
- `updatedBy`: AdminUser ObjectId
- `updatedAt`: Date
- timestamps

Index:

- Single-record pattern, either fixed key or singleton document.

### ProductOrder

Purpose: Stores real product checkout orders separately from credit/token orders.

Fields:

- `user`: optional User ObjectId
- `items`: array of purchased product snapshots
- `contact`: full name and mobile number; do not show or require email in the demo checkout UI
- `address`: house/street, area, landmark, city, state, pincode, country
- `subtotal`: Number
- `deliveryFee`: Number
- `total`: Number
- `currency`: default `INR`
- `paymentStatus`: `created`, `pending`, `paid`, `failed`, `cancelled`, `refunded`
- `paymentMode`: recommended addition with values like `demo` or `phonepe`
- `fulfillmentStatus`: `new`, `confirmed`, `packed`, `shipped`, `delivered`, `cancelled`
- `merchantOrderId`: unique internal PhonePe merchant order id
- `phonePeOrderId`: provider order id
- `idempotencyKey`: optional browser idempotency key
- `providerState`: PhonePe state for real payment mode, or `DEMO_COMPLETED` for simulated demo checkout
- `redirectUrl`: PhonePe redirect URL only for real payment mode
- `paidAt`: Date
- `providerResponse`: Mixed
- timestamps

Important rule:

- Product prices must be read from MongoDB on the backend when creating an order.
- Never trust subtotal, total, product name, or price from the browser.

## API Plan

### Storefront Config

```txt
GET /api/storefront/config
```

Returns:

```json
{
  "demoEcommerceMode": true
}
```

Used by frontend on app startup and policy pages.

### Admin Settings

```txt
GET /api/admin/storefront-settings
PATCH /api/admin/storefront-settings/demo-mode
```

Patch body:

```json
{
  "enabled": true
}
```

Required admin access:

- Prefer `system-management` or `user-operations`.
- If the toggle affects production checkout, `system-management` is safer.

### Pincode Lookup

```txt
GET /api/orders/pincode/:pincode
```

Rules:

- Pincode must be exactly 6 digits.
- Delivery is India-only.
- Backend should return city, district, state, and serviceability.
- Cache pincode responses if an external provider is used.

Example response:

```json
{
  "pincode": "400001",
  "serviceable": true,
  "city": "Mumbai",
  "district": "Mumbai",
  "state": "Maharashtra",
  "country": "India"
}
```

Provider options:

- First choice: local India pincode dataset imported into MongoDB or JSON.
- Second choice: backend-only external pincode API with Redis/local cache.

### Product Orders

```txt
POST /api/orders
GET /api/orders/:id
POST /api/orders/:id/payment
POST /api/orders/:id/demo-success
GET /api/orders/:id/payment-status
```

`POST /api/orders` request:

```json
{
  "items": [
    {
      "productId": "mongo-product-id",
      "quantity": 1,
      "variant": "M / Black"
    }
  ],
  "contact": {
    "fullName": "Customer Name",
    "mobile": "9876543210",
    "email": "optional@example.com"
  },
  "address": {
    "houseStreet": "House / flat and street",
    "area": "Area or locality",
    "landmark": "Optional landmark",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001"
  }
}
```

`POST /api/orders/:id/payment`:

- Keep this for future real product payments only.
- Do not call it from demo checkout.
- Creates a PhonePe checkout session for the product order when real product payments are enabled.
- Sets payment status to `pending`.
- Returns PhonePe redirect URL.

`POST /api/orders/:id/demo-success`:

- Only works when `demoEcommerceMode` is true.
- Does not call PhonePe.
- Marks the product order as `paid`.
- Sets `paymentMode` to `demo`.
- Sets `providerState` to `DEMO_COMPLETED`.
- Sets `paidAt`.
- Returns the completed order.
- Must be idempotent: calling it again for the same order should return the same successful order without duplicating anything.

`GET /api/orders/:id/payment-status`:

- Reconciles with PhonePe.
- Marks order `paid` only after backend status verification.
- Must be idempotent.

### PhonePe Callback

Current token checkout callback should be extended carefully.

Options:

1. Add a separate product callback route:

```txt
POST /api/payments/phonepe/product-callback
```

2. Or make the existing callback route detect whether the merchant order id belongs to `TokenOrder` or `ProductOrder`.

Recommended first version:

- Separate route is clearer and safer.
- Shared PhonePe client helpers can still be reused.

## Checkout UI Plan

Add new route:

```txt
/checkout
```

Supported entry points:

- `/checkout?productId=:id`
- `/checkout` using local cart items

Page layout:

- Left column: contact, delivery address, payment
- Right column: order summary
- Mobile: summary collapses below or above form

Fields:

Contact:

- Full name
- Mobile number
Delivery address:

- House / flat and street
- Area / locality optional
- Landmark optional
- City
- State dropdown
- Pincode

Payment:

- Demo prepaid checkout
- Copy must explain that this demo confirms the order inside Lookmefy without opening PhonePe
- Pay now button

Pay now behavior:

- Create the product order with `POST /api/orders`.
- Call `POST /api/orders/:id/demo-success`.
- Do not redirect to PhonePe.
- Show an in-site success popup/modal.
- Popup should include order id, amount, customer mobile number, and a continue shopping button.
- Optionally include a view order/status button.

Pincode behavior:

- Accept only digits.
- Trigger lookup once 6 digits are entered.
- Auto-fill city and state from backend response.
- Show serviceability error if not deliverable.
- Keep state dropdown available, but prefer pincode-derived value.

India states/UT dropdown:

- Andaman and Nicobar Islands
- Andhra Pradesh
- Arunachal Pradesh
- Assam
- Bihar
- Chandigarh
- Chhattisgarh
- Dadra and Nagar Haveli and Daman and Diu
- Delhi
- Goa
- Gujarat
- Haryana
- Himachal Pradesh
- Jammu and Kashmir
- Jharkhand
- Karnataka
- Kerala
- Ladakh
- Lakshadweep
- Madhya Pradesh
- Maharashtra
- Manipur
- Meghalaya
- Mizoram
- Nagaland
- Odisha
- Puducherry
- Punjab
- Rajasthan
- Sikkim
- Tamil Nadu
- Telangana
- Tripura
- Uttar Pradesh
- Uttarakhand
- West Bengal

## Frontend Behavior Changes

Create a frontend hook/helper:

```js
useStorefrontConfig()
```

It calls `/api/storefront/config` and exposes `demoEcommerceMode`.

Product page:

- Affiliate mode: show `Shop now` link to `affiliateLink`.
- Demo mode: show `Buy now` button/link to `/checkout?productId=:id`.

Product cards:

- Affiliate mode: `Shop` opens affiliate link.
- Demo mode: `Buy` goes to checkout.

Cart:

- Affiliate mode: keep checkout disabled or discovery-oriented.
- Demo mode: enable checkout.

Wishlist:

- Affiliate mode: existing external behavior.
- Demo mode: `Buy now` goes to checkout.

Policy pages:

- Read storefront config.
- Render affiliate policy copy or demo ecommerce policy copy.

## Legal And Policy Pages

Pages that need mode-aware content:

- Terms and Conditions
- Privacy Policy
- Shipping Policy
- Cancellation Policy
- Refund Policy
- Contact and Support
- About or How It Works, if they mention Amazon checkout

Affiliate mode wording:

- Lookmefy is a product discovery and affiliate platform.
- Checkout, delivery, cancellation, returns, refunds, and warranty happen through Amazon or the seller.

Demo ecommerce mode wording:

- Lookmefy collects product orders through internal checkout.
- Checkout success is simulated for demo mode and does not process a real PhonePe payment.
- Delivery is currently within India.
- Customer contact and address are collected for delivery and payment updates.
- Cancellation/refund rules should match actual fulfillment rules.

Important:

- If real money is charged and products are really fulfilled, policies must be production-grade.
- If it is only a demonstration, checkout and policy text must clearly say demo/test where required.

## Admin UI Plan

Add setting control:

- Location: Admin Settings or System Management.
- Toggle label: Demo ecommerce mode.
- Description: Switch public product CTAs from affiliate links to internal checkout.
- Show current status.
- Require confirmation before turning ON in production.

Add ecommerce orders page:

- List product orders.
- Search by order id, phone, and name.
- Filter by payment status.
- Filter by fulfillment status.
- View order detail.
- Update fulfillment status.
- See demo payment state and amount.

Potential admin route placement:

- User Operations: Orders for day-to-day order handling.
- System Management: Toggle for mode control.

## Demo Payment Design

Demo product checkout should not use PhonePe. Keep PhonePe HTTP/client helpers available for future real product payment mode, but do not call them from demo mode.

Rules:

- Browser sends only product IDs, quantities, variants, contact, and address.
- Backend computes all prices.
- Backend creates `ProductOrder`.
- Backend marks demo product order as paid through a dedicated demo-success endpoint.
- Payment success must be clearly marked as simulated/demo in stored metadata.
- Duplicate demo-success calls must not mark paid twice or mutate totals.
- Token payments stay real PhonePe payments and remain independent.

Future real product payment mode:

- Re-enable the existing `POST /api/orders/:id/payment` route from the UI only when product payments should be real.
- PhonePe amount uses `ProductOrder.total`.
- Payment success requires backend reconciliation with PhonePe.
- Callback only triggers reconciliation.

## Security Requirements

- Validate all ObjectIds.
- Validate quantity range.
- Validate product `isActive` and availability.
- Validate pincode exactly 6 digits.
- Validate India state against allowlist.
- Normalize phone number.
- Rate-limit order creation and payment creation.
- Use idempotency key for payment creation.
- Do not log full address/payment provider payloads.
- Keep PhonePe secrets server-side only.
- Do not trust frontend totals.
- Rotate any secrets that were pasted into chat, screenshots, tickets, or shared documents.

## Testing Plan

Unit tests:

- Storefront config defaults to affiliate mode.
- Admin toggle requires proper permission.
- Pincode rejects invalid values.
- Pincode returns city/state for valid serviceable pincode.
- Product order rejects tampered totals.
- Product order rejects inactive products.
- Product order computes subtotal and total server-side.
- Demo success endpoint marks order paid without PhonePe.
- Demo success endpoint is idempotent.
- Real PhonePe product payment tests can stay as future-mode coverage.
- Product order payment status does not credit AI tokens.

Frontend tests:

- Affiliate mode product CTA opens affiliate link.
- Demo mode product CTA goes to checkout.
- Cart checkout is disabled in affiliate mode.
- Cart checkout is enabled in demo mode.
- Checkout validates required fields.
- Pincode autofills city/state.
- Pay now shows checkout successful popup in demo mode.
- Policy page copy switches with mode.

Browser tests:

- Use a dedicated test MongoDB URI.
- Do not run browser tests against production `.env`.

## Deployment Plan

1. Add backend models and routes.
2. Add admin toggle but keep default OFF.
3. Deploy with mode OFF.
4. Verify existing affiliate site is unchanged.
5. Turn mode ON in staging or controlled production test.
6. Verify checkout success popup, order status, admin order view, and policy text.
7. Turn mode OFF if any issue appears.

## Rollback Plan

Because this is feature-flagged:

- Immediate rollback is toggling `demoEcommerceMode` OFF in admin.
- Code rollback should only be needed if the new endpoints affect existing flows.
- Existing affiliate links and token payments should remain independent.

## Suggested Implementation Order

1. `StorefrontSetting` model and `/api/storefront/config`.
2. Admin toggle endpoint and admin UI.
3. `ProductOrder` model.
4. Pincode lookup endpoint.
5. Product order create/read endpoints.
6. Demo success endpoint.
7. Checkout page.
8. Product/cart/wishlist CTA switching.
9. Mode-aware policy pages.
10. Admin ecommerce orders page.
11. Full tests and staging validation.
