# MadeDeck customizer: Fabric merge contract

## Decision

Keep MadeDeck's product, placement, pricing, production-payload, cart and fulfillment model. Replace the manual DOM image-layer editor with a true object-canvas adapter. Do not introduce React only for the editor; the current MadeDeck client is vanilla JavaScript and the editor must remain independently mountable.

## Capabilities retained from MadeDeck

- Product-specific colors, sizes, views and placement rules.
- Front, back, chest, left/right chest, neck and sleeve locations.
- Placement-specific prices and live totals.
- Separate full-resolution source assets for each decoration location.
- Uploaded art, premade art and text decorations.
- Product mockup switching.
- Production payload, cart, merchant/owner economics and fulfillment routing.

## Capabilities adopted from the Fabric comparison

- Object selection and selected-object inspector.
- Text and image objects on the same canvas.
- Layer ordering and preserved object stacking.
- Move, scale, rotate, opacity, fill and deletion controls.
- Serializable editable design JSON.
- High-resolution flattened preview generation.
- Independent view state per decoration location.

## Production requirements missing from the comparison skeleton

- Logical canvas size must match displayed aspect ratio; CSS must not distort a differently sized backing canvas.
- Export resolution is calculated from physical print dimensions and target DPI, not an arbitrary multiplier.
- Every placement has a clip path, safe area, bleed and maximum production dimensions.
- Each front/back/sleeve/chest view preserves its own objects and JSON state.
- Uploaded originals remain separate from low-resolution preview objects.
- Font files, licenses and text metrics must be available to the production renderer.
- Cross-origin images must not taint export canvases.
- SVG/PDF/vector input requires validation and a production-safe conversion path.
- Undo/redo, duplicate, align, snap, lock, hide and layer ordering are required.
- Resolution, transparency, printable-color and out-of-bounds warnings block production when material.
- Server-side output verification is required before an order is production-ready.
- Mobile pointer controls and keyboard-accessible property controls are required.

## Shared service path

The editor writes a versioned `design_document` containing products, views, objects, source assets, print geometry and pricing inputs. Web MadeDeck and the Windows Power Console use the same API and document schema.

Lead/scraping functions follow the same rule: direct operator routes and Taskmaster missions call the same service workers and persistence contracts. No duplicated scraper, ranker, CRM or export logic.
