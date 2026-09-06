# High-Integrity Rebuild Inventory — Foundation Pass

Baseline: `main@6455b1ef329f5d9b7456c209f8b2ea3e1a3af4c4`

This pass is additive and deliberately avoids the large member UI, mockup assets, pricing, and live payment behavior.

| Subsystem | Class | Current finding | Safe direction |
|---|---|---|---|
| Product/mockup assets | KEEP | Real catalog assets and manifests exist | Validate mappings; do not regenerate |
| Maker/member interface | REWIRE | Valuable feature-rich UI; browser-local state remains | Move persistence behind tenant API incrementally |
| Account records | KEEP + REWIRE | `accounts` and memberships exist | Add immutable tenant UUID and ownership contract |
| Email identity | REWIRE | User email is unique login identity | Separate changeable email from ownership |
| Sessions | REWIRE | Durable rows exist, runtime Map remains authoritative for some routes | Resolve every protected request asynchronously from durable session |
| Authorization | MERGE | Role checks and per-router checks are scattered | Route through one deny-by-default middleware |
| Entitlements | MERGE | JSON snapshots and plan tables overlap | Normalize tenant entitlements; keep snapshots during migration |
| Storefront/offers | REWIRE | Working commerce records exist | Add tenant scope to reads/writes before feature expansion |
| Stripe webhook | KEEP + REWIRE | Signature verification and event dedupe exist | Require tenant/payment attribution before order mutation |
| Connection backbone | KEEP | Adapter/event structure is compatible | Add tenant-aware worker identities and truthful status |
| Super controls | MOVE | Operations are distributed | Consolidate diagnostics/setup/state/repair in Gear of Doom |
| Legacy duplicate widgets | REMOVE LATER | Must be proven unused first | Instrument before deletion; never delete in foundation pass |

## Cutover gates

1. Apply migration 012 in staging and verify counts/checksums.
2. Run `node --test tests/access-control.test.js`.
3. Wire one low-risk read endpoint through the new resolver.
4. Add two-tenant negative tests before any write endpoint cutover.
5. Convert endpoint groups vertically: Maker → storefront → cart → checkout → order.
6. Keep the old path behind a rollback flag until each vertical slice passes.
7. Do not deploy or merge automatically.
