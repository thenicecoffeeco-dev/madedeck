# MadeDeck Revenue Dialer contract

This is the final feature-expansion boundary. Subsequent catalog work is limited to premade assets, product mockups, and compatible product asset sets unless a separate change is approved.

## Customer experience

- The dialer can remain embedded in the command dashboard or float as a resizable workspace.
- CRM queue, lead context, provider selection, timer, notes, scripts, objections, callbacks, dispositions, and KPIs remain in one workspace.
- CSV imports enter Native CRM first, making them available to Lead Digester, ranking, segmentation, Research Bot, Swarm missions, campaigns, and the dialer.
- Storefront modules use customer-safe names; technical command IDs appear only in help, preflight, and audit views.

## Revenue model

MadeDeck platform subscriptions and general credits remain independent of the calling add-on. Dialer plans are Starter ($99/month, 500 calls), Growth ($299/month, 2,000 calls), and Enterprise ($799/month, 10,000 calls). Telephony, lookup, SMS, recording, and carrier charges are provider usage and must be disclosed separately. All offers remain inactive until verified Stripe price IDs and webhook handling are configured.

## Safety and truthful readiness

- `calls/prepare` checks the authenticated account, subscription, monthly allowance, CRM ownership, active suppression, and provider connection before returning a handoff.
- The foundation does not claim that a call was placed. API providers require a server adapter and encrypted secret reference; browser-assist providers require an operator handoff.
- `DO_NOT_CALL`, wrong number, bad number, and hostile outcomes create permanent suppression. Other governed dispositions create cooldowns.
- Call recording stays off unless the plan allows it and a jurisdiction-aware consent workflow is configured.
- Webhook/provider events—not a browser timer—must become the source of truth for final duration, state, and provider cost.

## Connector boundary

Credentials never enter checked-in JSON or browser storage. `secret_reference` points to the deployment secret manager. Twilio is the first supported API adapter. Google Voice has no public calling API and remains browser-assist. OpenPhone, RingCentral, Viber, Pinger, and device/SIM routes require their own verified adapters or explicit handoff modes.

## Next deployment gates

Apply migration 007 in staging, configure inactive Stripe prices, create a test dialer account, seed at least one provider connection, install the Twilio adapter only if Twilio is selected, verify webhook signatures, test suppression/cooldowns, then run the launch checklist. No live outreach occurs during foundation testing.
