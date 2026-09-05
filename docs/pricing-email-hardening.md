# MadeDeck pricing and email-hook completion

## Pricing authority

MadeDeck's database is authoritative. Browsers may display estimates, but checkout accepts an internal offer code and the server resolves its verified Stripe Price ID.

Current working plan map:

| Plan | Monthly | Annual | Included credits |
|---|---:|---:|---:|
| Launch | $0 | — | 0 |
| Creator | $19 | $190 | 25/month |
| Pro | $39 | $390 | 75/month |
| Studio | $79 | $790 | 200/month |
| Enterprise | Custom | Custom | Contract |

Subscription credits may roll over for up to three months. Purchased credit packs do not expire. These commercial values remain editable before activation. Each paid offer stays inactive until its test-mode Stripe Product and Price IDs are recorded and verified.

Physical product canon: tee $18/$20/$22/$24/$26 (S–XL/2XL/3XL/4XL/5XL), hoodie $26/$28/$30 (S–XL/2XL/3XL), polo $29/$31/$33 (S–XL/2XL/3XL).

## Payment flow

- Customized physical products use server-calculated inline Checkout Session prices based on an immutable order snapshot.
- Plans and credit packs use fixed Stripe Prices.
- Managed services can use fixed price, invoice, credits, or quote according to their offer configuration.
- Stripe webhook signatures must be verified before processing.
- Webhook grants and order transitions must be idempotent.
- The success page reports status; it never grants credits or access.
- Live mode remains blocked until the complete test checklist passes.

## Email identity isolation

Login identity and authorization come from user ID plus account membership. Notification addresses are separate records, grouped by purpose:

- owner alerts
- orders
- billing
- support
- marketing
- recovery

Changing one route never changes `users.email`, account ownership, store ownership, roles, memberships, or active sessions. New addresses remain pending until verified. Only verified routes can receive queued operational messages. Every delivery uses an idempotency key and retains attempts for retry/dead-letter review.

## Activation checklist

1. Apply migration 012.
2. Create separate Stripe Products per plan and Price variants per monthly/annual interval in test mode.
3. Store Product/Price IDs, then activate one offer at a time.
4. Configure a restricted Stripe API key and webhook signing secret outside the repository.
5. Verify checkout, asynchronous payment, subscription lifecycle, refund, dispute, replay, and failure recovery events.
6. Verify each email purpose independently, including bounce/retry behavior.
7. Confirm no email-settings endpoint can mutate identity or ownership tables.
8. Only then repeat the checklist in live mode.

Stripe Tax must be configured only after the appropriate registrations are active; merely turning on automatic tax does not collect tax without registration.
