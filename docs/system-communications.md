# System Communications Suite

MadeDeck web and Windows clients consume the same `/api/system-messages/feed` response. Vinny publishes once and targets delivery by channel, user, role or subscription tier.

Supported presentations are persistent banners, blocking modals/fullscreen notices, temporary toasts and inbox-only messages. Messages can be drafted, scheduled, published, paused, expired or canceled. They support severity, priority, action links, maintenance countdowns, delivery windows, dismissibility and required acknowledgment.

The status layer tracks website, API, customizer, payments, fulfillment, Swarm and desktop components. Incidents maintain investigation, identification, monitoring and resolution updates. Release notes are versioned separately so a message can link to a complete change history.

Critical messages must remain server-controlled. Clients may cache the last successful feed for offline display, but cannot invent, elevate or suppress a server-required acknowledgment. Physical destructive actions and account access changes are not performed from message links without their normal authorization flow.

