# MadeDeck 72-hour implementation and handshake audit

Audit date: 2026-08-25. Scope: Draft PR #2 and promises introduced during the preceding 72 hours. Status terms are deliberately strict.

## Status definitions

- **Automated**: a server worker performs the action and records its result without an operator moving data manually.
- **Human-triggered**: software performs the action after a user deliberately launches it.
- **Human-reviewed**: software prepares a draft; a person must approve before an external effect.
- **Connector-dependent**: application logic exists but a verified external account/adapter/webhook is still required.
- **Manual handoff**: the application prepares or records work, but a person completes it in another tool.
- **Foundation only**: schema, catalog, contract, or UI exists without the worker that produces the promised output.

## Executive finding

The PR is a credible control-plane and commerce foundation, not yet a fully autonomous Swarm. Authentication, governed mission drafts, bot selection, catalogs, estimates, scoped feature/price controls, communications, CRM calling records, suppression, callbacks, and KPI queries have real server/database paths. Most research, scraping, generation, campaign, fulfillment, subscription, calendar, training, and production-export promises still stop at a catalog entry, draft queue, contract, or external connector boundary.

Migration 009 closes a critical fresh-install defect: runtime code referenced `power_functions`, `power_jobs`, `swarm_bots.operator_enabled`, and `swarm_bots.system_required`, but migrations 003-008 did not create them.

## Function boundary ledger

| Area | Current status | Human handshake | What is still required |
|---|---|---|---|
| Vinny-only Power Console | Human-triggered, functional after migrations | Vinny signs in and operates controls | Apply migrations and configure owner credentials |
| Bot enable/disable | Human-triggered, automated database update | Vinny flips switch | Worker runtime must actually honor bot state |
| Mission creation | Human-triggered, functional draft | Operator writes/selects request; Run creates draft only | Preflight, scheduler, worker dispatcher, retry and completion runner |
| Bot selection | Human-triggered, functional | Operator selects eligible bots | Runtime dispatcher must consume selections |
| Approval records | Human-reviewed foundation | A3-A5 actions require a decision | Approve/reject UI and execution consumption path |
| Action catalog and estimates | Automated calculation | User previews and confirms | Settlement after real worker completion |
| Per-user/platform visibility and price controls | Human-triggered, enforced in catalog resolution | Vinny chooses scope and override | Apply migration 008; all future surfaces must use effective catalog API |
| Lead CSV import into Native CRM | Human-triggered, functional | User selects a file and reviews rejected rows | Lead Digester worker for mapping, dedupe, validation and outliers |
| CRM queue, detail, history, callback records | Human-triggered, functional | Operator selects leads and records outcomes | Full CRM editing, ownership/team assignment and sync adapters |
| Dialer suppression and plan preflight | Automated server check | Operator selects lead/provider | Provider credentials and adapter |
| Actual outbound call | Connector-dependent/manual handoff | Operator completes provider/device handoff | Twilio/OpenPhone/RingCentral adapter plus signed status webhooks |
| Call timer/cost truth | Foundation only | Browser currently shows operator timer | Provider webhook must own duration, state and cost |
| SMS/missed-call text-back | Foundation only | None implemented | Inbound voice/SMS webhooks, templates, consent and routing worker |
| Lead ranking/enrichment/research/scraping | Foundation only | Mission can be drafted | Real workers, sources, rate limits, evidence storage and QA |
| Email/call scripts, proposals and content | Foundation only | Mission can be drafted and later reviewed | Model/provider worker, prompt/version registry, output storage and approval UI |
| SitePulse/ReviewRescue/CompetitorX-Ray/etc. | Cataloged products only | User can see/price them once surfaced | Fifteen individual workers, input forms, outputs, retries and billing settlement |
| Stripe order webhook | Connector-dependent, partially implemented | Stripe sends verified event | Test IDs; subscription/credit/dialer entitlement events are not yet processed |
| Subscriptions, credit packs and bundles | Foundation only/inactive | Vinny must configure offers | Checkout-session API, portal, webhook entitlement grants and idempotent credit settlement |
| Product editor basic placement | Human-triggered browser behavior | User uploads/positions art | Persist designs server-side and render actual production files |
| Fonts, arch/circle, bold/italic/underline | Human-triggered preview/metadata | User edits text | Merge into Fabric object model and verified SVG/PDF export |
| Mockup color/view switching | Connector-dependent on assets | User chooses product/color/view | Required mockup PNG inventory and visual QA |
| High-resolution/CMYK/vector export | Contract only | Human production review required | Render service, fonts, bleed, DPI validation, CMYK/ICC pipeline |
| Fulfillment/send product to customer | Schema and catalog only | Human approval anticipated | Quote, address encryption, payment, printer/provider dispatch and tracking APIs |
| System banners/toasts/modals/inbox | Automated delivery after human publish | Vinny authors/publishes message | Apply migration 006 and inject client on every web/desktop surface |
| Incidents/status/releases | Server APIs exist; partial admin UI | Vinny controls status/messages | Incident/release authoring UI is not yet exposed |
| Holiday/payment reminders/ABU relationship flows | Concept only | Human currently performs follow-up | Calendar, rule engine, templates, scheduler, delivery adapters and opt-out state |
| Free Flow Builder/Email Gauntlet/tutorials | Sales promise only | None | Builder UI, persistence, runner, tutorial content and exports |
| Windows EXE | Not packaged | Manual web use only | Desktop shell, secure local storage, updater, signing, installer and QA |

## Dead-click and misleading-language findings

### Repaired in this audit batch

- Power Console Run now creates a real governed draft mission instead of only echoing “captured.”
- Quick actions now load explicit draft templates; Help renders instructions; Decisions queries pending approvals.
- Dialer queue filters now filter; Open CRM loads the owned record; History loads calls; Script and Objections explain their true blocked boundary instead of presenting empty panels.
- Editor bold, italic, and underline controls now change preview state and export metadata.
- Missing Power runtime tables/columns are supplied by migration 009.

### Still blocked and must not be described as automated

- No Swarm worker dispatcher consumes `power_jobs` or executes missions.
- No provider adapter places dialer calls.
- No 15-product storefront worker produces its advertised PDF/CSV/dashboard.
- No subscription checkout or entitlement webhook activates paid plans.
- No production renderer or fulfillment dispatcher sends printer-ready orders.
- No calendar/reminder, training studio, relationship revival, or email-gauntlet runner exists.

## Release gate

Do not remove `foundation`, `partial`, `blocked`, or connector labels until an acceptance test proves the worker, external effect, audit record, failure path, and output. A visible control must either perform a real action, create an explicitly labeled draft, open a working view, or be disabled with a reason.
