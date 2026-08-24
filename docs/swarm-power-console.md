# Swarm Power Console foundation

The Swarm Power Console is a Vinny-only MadeDeck module. MadeDeck owns identity, durable state, entitlements, audit records and future billing. The desktop application will authenticate against the same server and operate local workers through bounded mission contracts.

## Initial access contract

Access requires all of the following:

1. An authenticated MadeDeck session.
2. `platform_admin` role.
3. An exact email match with `VINNY_OWNER_EMAIL`.
4. An active `swarm_super_admin` row in `user_entitlements`.

The server fails closed when `VINNY_OWNER_EMAIL` is missing.

## Canonical layers

- `swarm_bots`: operator-facing named bot loadouts.
- `swarm_employees`: bounded specialist workers from the workbook.
- `swarm_bot_employees`: required, conditional and backup membership.
- `swarm_missions`: durable mission contracts and state.
- `swarm_mission_bots`: per-mission bot selections and outputs.
- `swarm_approvals`: exact A3/A4/A5 authority envelopes.
- `swarm_evidence`: attributable facts, inference, conflicts, limitations and unknowns.
- `audit_log`: immutable operator and system action history.

## Release boundary

The first release creates drafts and internal mission state only. External communication, publication, spending, pricing promises, destructive changes and permanent rule changes remain blocked until their exact approval paths are implemented and tested.

