# Stripe setup map

## Dashboard objects

Create test-mode Products and Prices first. Record both `prod_...` and `price_...` IDs against these internal offer codes:

| Offer code | Mode | Access effect |
|---|---|---|
| `pro_monthly` | subscription | PRO tier + `made_deck_pro` entitlement |
| `advanced_monthly` | subscription | ADVANCED tier + `made_deck_advanced` entitlement |
| `print_credits_50` | payment | +50 entries in the print credit ledger |
| `premium_template_pack` | payment | `premium_template_pack` entitlement |

Do not enable a paid offer until its Product and Price IDs are stored and verified in test mode.

## Server contract

- Checkout receives authenticated user context and an internal `offer_code` only.
- Server resolves mode and Stripe Price ID from `billing_offers`.
- Checkout creation uses an idempotency key tied to the local checkout attempt.
- Subscription metadata is written to both the Checkout Session and underlying Subscription metadata.
- Frontend success URLs display status only; they never grant access or credits.
- Verified webhooks update subscriptions, purchases, entitlements and the credit ledger.
- `webhook_events` prevents duplicate Stripe event processing.
- `purchase_log.stripe_checkout_session_id` and `credit_ledger` source uniqueness prevent duplicate grants.
- Portal sessions are short-lived and created only for the authenticated user's stored Stripe Customer ID.

## Required test events

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- Refund and dispute events for one-time purchases

Use the Stripe CLI against the test endpoint before enabling live mode.
