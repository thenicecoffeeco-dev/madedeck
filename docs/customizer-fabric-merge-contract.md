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

## Production export contract

- The garment photo is never part of the print export. Only objects inside the placement clip path are exported.
- Trim size and bleed come from `public/mockups/print-areas.json`; they are not inferred from the visible mockup.
- Target pixels are calculated as `(trim inches + 2 × bleed inches) × target DPI` for each dimension.
- Fabric/Konva multipliers or pixel ratios are derived from required target pixels divided by logical canvas pixels. A fixed multiplier is not treated as a DPI guarantee.
- Width and height ratios must agree; an aspect mismatch blocks export instead of stretching the design.
- Browser canvas limits and memory are checked before raster export; oversized work routes to the backend renderer.
- Editable Fabric JSON, Fabric SVG, flattened transparent PNG and source assets are stored as separate artifacts.
- Fabric SVG preserves vector text/shapes/paths, but embedded bitmap uploads remain bitmap data.
- PDF generation preserves vector objects where the renderer supports them and embeds raster objects at their verified effective DPI.
- The browser remains sRGB. Production color conversion runs on the backend against the printer's required CMYK/ICC profile.
- Generic CMYK conversion is not presented as printer-accurate proofing. Printer/profile identity is recorded in the production packet.
- Output preflight verifies pixel dimensions, physical dimensions, bleed, color profile, transparency, bounds, fonts, source resolution and artifact creation.

## Typography and text paths

- The editor exposes a categorized font library with modern, condensed, serif, script, display, athletic and monospace families.
- Every production font must be licensed for the intended use and installed or embedded in the backend renderer; a browser fallback font cannot silently reach production.
- Text supports straight, upward arch, downward arch and full-circle formations with adjustable curvature and letter spacing.
- Curved text remains editable in the design document and exports as SVG/PDF text-on-path or outlined vector geometry according to the printer contract.
- Production preflight blocks an export when its exact font revision cannot be resolved or embedded.
