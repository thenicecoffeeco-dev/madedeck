# MadeDeck

Current application version: **0.6.1**

The v0.6 build includes the apparel mockup and premade-art libraries, a working inquiry capture path, and a platform-admin monetization console for plans, modular add-ons, credits and subscriber visibility.

Before deployment, import `db/migrations/003_monetization_control.sql` into an existing database. New installations can use `db/full_schema.sql`.

MadeDeck is a multi-tenant SaaS-lite direct-to-print, fulfillment, storefront, preorder, and bulk-purchase platform.

Current baseline goals:
- Platform admin, merchant, and customer roles
- Merchant-managed retail pricing above protected MadeDeck minimums
- Standard store offers, preorder bounties, and bulk purchase offers
- Merchant mockup/artwork uploads
- Direct ship, office distribution, or both
- Payment-gated offers and merchant payment portal hooks
- Subscription/entitlement foundations
- Auditability, account settings, and growth feature toggles
- Mobile-first customer ordering

Deployment target: GoDaddy managed Node.js app with hosted MySQL/Percona.
