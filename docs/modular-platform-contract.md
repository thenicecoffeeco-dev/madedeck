# MadeDeck Modular Platform Contract

MadeDeck exposes features as installable modules rather than hard-coded menu pages. The web app and Windows client obtain the same module and action manifests from the server.

## Module boundary

Every module declares:

- stable `module_key`, semantic version and lifecycle status;
- human-facing name, description, help content and icon key;
- navigation placements and required tier/entitlement;
- actions it provides and workers that execute them;
- input schema, output contract and evidence contract;
- standalone and Swarm invocation support;
- connector and secret requirements;
- health/readiness checks;
- migration dependencies and feature flags.

Disabling a module removes its operator entry points but never deletes its historical jobs, evidence, purchases or audit records.

## Shared action catalog

An action is the smallest billable and executable capability. The server owns its price, unit, preview allowance, confirmation policy, compatible bots and output contract. Clients submit `action_code` and inputs; they never submit a trusted price.

The execution flow is:

1. Validate session, entitlement, module readiness and input schema.
2. Produce a server-side preflight estimate.
3. Resolve included plan usage, purchased bundle allowances and credit balance.
4. Reserve the maximum approved credits.
5. Queue the standalone job or Swarm mission.
6. Settle actual usage on success or release the reservation on failure/cancellation.
7. Append immutable credit, job, evidence and audit records.

## Product customizer adapter

Product modules use the shared `fabric-object-canvas` editor adapter while supplying their own views, printable areas, mockup assets, color variants and production rules.

- Apparel: front/back/chest/sleeves and embroidery placements.
- Stickers/labels: trim boundary, 0.125-inch bleed, safe area and vector cutline.
- Promotional products: product-specific views and decoration methods.

## Send product to customer

Subscribers can dispatch a saved or newly customized product directly to a customer. The flow requires a final mockup review, recipient confirmation, live fulfillment quote, payment approval and production-file validation before submission.

Credits or plan access may include use of the dispatch workflow. Physical product cost, tax and shipping remain separately payable and are never silently absorbed by a subscription allowance. Recipient addresses are encrypted at rest, access is audited, and the UI exposes only the minimum address detail after approval. Dispatches retain provider status, tracking and delivery exceptions.

The editable design JSON, preview image and production assets are separate artifacts. Production files remain full resolution and retain vector text/shapes when the selected output supports them.

## Adding a future feature

A new feature should require one module manifest, action seeds, worker registration, optional database migration and UI contribution. It must not require editing the billing client, desktop navigation shell or Swarm Taskmaster core.
