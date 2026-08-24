# MadeDeck v0.6 test-launch checklist

## Safety and deployment

- Export and download a complete GoDaddy MySQL backup.
- Record current production commit and application version.
- Apply `003_swarm_power_console.sql` after the backup is verified.
- Configure `VINNY_OWNER_EMAIL=info@webupdates.net`.
- Deploy the integration branch without merging `main`.
- Verify `/health`, normal login/logout and durable session behavior.
- Verify every Power Console denial path before enabling owner access.

## Visual product assets

- Upload every asset required by `public/mockups/manifest.json`.
- Run `npm run assets:check`; zero missing files is required.
- Verify transparent canvas, consistent crop, product scale and lighting.
- Verify every product color visibly changes the product—not merely the selector label.
- Verify front and back images are distinct.
- Verify left- and right-sleeve views are distinct and correctly oriented.
- Verify polo chest placements use the front view and neck placement uses the back view.
- Verify every print zone remains aligned when changing color or view.
- Verify uploaded and premade artwork persists independently for every location.
- Verify sticker and label assets show the correct aspect ratio and safe area.

## Customizer and production

- Verify text, image, premade and vector-object editing.
- Verify layers, ordering, lock/hide, duplicate, undo and redo.
- Verify saved design JSON restores every view exactly.
- Verify physical print dimensions produce the required 300-DPI pixel dimensions.
- Verify low-resolution, transparency, font and out-of-bounds warnings.
- Verify cart pricing matches enabled decoration locations and quantities.
- Verify source files and generated production assets remain attached to the order.

## Swarm and operator tools

- Verify `info@webupdates.net` is the only Swarm Power owner.
- Verify required bots cannot be disabled.
- Verify optional bot changes create audit records.
- Verify standalone Lead Search, Digester, Ranking, Qualification and CRM paths.
- Verify Taskmaster calls the same service workers as standalone tools.
- Verify premade action pills create previews before launching work.
- Verify FAQ and hover guidance appears on controls, scores and authority gates.
