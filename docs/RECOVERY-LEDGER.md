# MadeDeck Recovery Ledger

Updated: 2026-09-07  
Source baseline: `MADEDECK TO DO.pdf`, the high-integrity rebuild contract, current GoDaddy/MySQL runtime, and confirmed working live-version behavior.

## Recovery rules

- Preserve working behavior and contracts; do not restore broken monoliths.
- One canonical catalog and pricing authority feeds every storefront, maker, cart, account type, and fulfillment worker.
- One shared Maker is mounted in the public catalog, member workspace, merchant workspace, and authorized owner views.
- Do not use CSS garment recoloring, duplicate fake color files, embedded image fallbacks, or generic polygon/silhouette substitutes as production mockups.
- Browser storage is only for drafts, preferences, and temporary recovery. Durable designs, carts, orders, assets, receipts, events, and jobs belong to the backend.
- Stripe redirects never grant products, credits, or entitlements. Verified idempotent webhooks are final authority.
- Status labels mean exactly: SIMULATED, PRE-WIRED, or FULLY SET UP.

## Current recovery checkpoint

| Area | Current state | Next gate |
| --- | --- | --- |
| Tenant IAM and owner assignment | Fully set up in current MySQL runtime | Continue negative tenant-isolation tests |
| Shared public catalog/editor composition | Recovered in 0.11.4 | Browser verification after deployment |
| Public Stripe Checkout redirect | Implemented in 0.11.3 | Authenticated sandbox checkout and return test |
| Stripe webhook processing | Implemented | Confirm signed event changes one canonical record exactly once |
| Public product prices | Server-aligned for starter catalog | Move remaining browser catalog into canonical catalog API |
| Realistic mockups | Missing; current 76 variants derive from gray masters | Import validated real assets and bind through one resolver |
| Member/private Studio | Recovered and booting | Bind to same catalog, pricing, asset, draft, and cart services |
| Merchant product persistence | Backend routes present | Full create/save/reload/publish/revision test |
| Durable carts/designs/orders | Partial | Replace remaining browser-owned cart/design truth |
| Production packets | Contracts/routes present | End-to-end immutable packet and file test |
| Fulfillment/Drive | Pre-wired | OAuth/token vault and delivery worker |
| Reporting/statistics authority | Partial | One account-scoped reader for dashboards, alerts, receipts, and diagrams |
| Marketing Arsenal | Historical module exists | Reconnect only after catalog/events authority is stable |
| Guided Operating System | Foundation exists | Route each warning to the exact repair action and recheck |

## Canonical build order

1. Shared catalog, pricing, mockup resolver, and Maker contract.
2. Durable drafts, carts, designs, artwork, and product revisions.
3. Canonical order, receipt, event, outbox, retry, and audit records.
4. Stripe sandbox checkout, signed webhooks, refunds, subscriptions, credits, and Connect onboarding.
5. Production-file validation, approvals, immutable packets, and fulfillment routing.
6. Shipping, taxes, addresses, email, and customer notifications.
7. Customer service, returns, replacements, reprints, and disputes.
8. Reporting, profitability, reconciliation, and wiring-diagram drilldowns.
9. Guided Operating System, Marketing Arsenal, external storefronts, and game/NPC feeds.

## Starter catalog truth

- Unisex Standard Tee: $18 S-XL; 2X $20; 3X $22; 4X $24; 5X $26.
- Pullover Hoodie: $26 S-XL; 2X $28; 3X $30.
- Performance Polo: $29 S-XL; 2X $31; 3X $33.
- Premium Snapback: $27 starter price.
- Foam Koozie: $5.50 starter price.
- Golf Towel: $30 starter price.
- 2x2 stickers, 200: $45.
- 3x3 stickers, 200: $55.
- 5x4 labels, 200: $70.

## Definition of done for the current visible path

A product card selects the right canonical product, mounts the same Maker, loads a validated mockup or says **Real mockup unavailable**, preserves surface-specific artwork, saves a durable draft, creates a server-priced cart snapshot, opens Stripe-hosted sandbox Checkout, records the verified webhook once, produces a receipt/order, and retains the correct tenant/account/store ownership throughout.
