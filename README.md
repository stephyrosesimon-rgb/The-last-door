# Publish The Last Door

## Publish without commands

1. Extract netlify-ready-game.zip into a folder.
2. Sign in to Netlify and open https://app.netlify.com/drop.
3. Drag the WHOLE extracted project folder into the drop area. It must contain netlify.toml, package.json, index.html, src, and netlify.
4. Wait for Netlify to build the frontend and deploy the game function. Open the site URL it provides.
5. Create a room and share that URL and room code. Players can join from different networks before the host starts.

No GitHub, terminal commands, custom environment variables, API keys, or manual database setup are required. Netlify supplies Blobs access automatically. A signed-in Netlify account with Functions and Blobs available within its usage limits is required.

Use signed-in source-project Drop. Netlify's documented workflow asks you to unzip first. Anonymous Drop or dropping only dist publishes static files and cannot set up this multiplayer backend. Documentation: https://docs.netlify.com/deploy/create-deploys/#drag-and-drop

## Architecture

netlify/functions/game.ts is the only function entry. Helpers live in src/server. The frontend posts directly to /.netlify/functions/game. There are no path overrides, API redirects, persistent production servers, WebSockets, or SSE connections. Polling runs about every 1.2 seconds (2 seconds while paused); actions return an immediate snapshot.

Each room is one JSON record in a site-wide Netlify Blobs store. Reads use strong consistency. Creation uses onlyIfNew; every update uses onlyIfMatch with the last ETag. Conflicts trigger a fresh read and retry. Recent request receipts prevent duplicate scoring on retries. Server-side rules control answers, scoring, deadlines, cooldowns, and winners.

The three scoring rounds are the original Library, Conservatory, and Workshop rooms. The Foyer and final Vault remain. Mansion artwork, clickable doors, chat, private seals, scoring, and pause/resume are preserved.

Sessions survive refresh and function cold starts. Invitations become unusable after 24 hours; expired records remain in Blobs (no deletion job is installed). Leaving retains the player slot, as in the original prototype.

## Contents

The root includes netlify.toml, package.json, package-lock.json, index.html, .nvmrc, and tsconfig.json. Frontend source is in src and public/assets; production output is in dist. Netlify rebuilds from source. Tests and scripts are for reproducible verification, not user setup. They are outside netlify/functions and outside the published dist directory.

## Verified

Two players completed all three rooms:

| Round | Ada | Ben |
|---|---:|---:|
| Library | 125 | 110 |
| Conservatory | 250 | 220 |
| Workshop | 375 | 330 |

Ben opened the Vault first and correctly won despite fewer points. Pause/resume, duplicate submissions, simultaneous joins, capacity, private data, stale writes, competing final answers, and timeout were also checked.

Vite production build and TypeScript checks passed. Netlify's official zip-it-and-ship-it packaged exactly one function. The actual packaged default export ran the full game through the real Blobs SDK against a local atomic HTTP contract fixture. The installed official local Blobs emulator omits GET ETags, so the test fixture explicitly enforces them. This verifies SDK behavior locally; it is not a live hosted Netlify deployment test.

Browser smoke testing confirmed production create-room, second-player polling, starting a match, and the unchanged mansion interface. Detailed results are in verification/results.json.

The validation Lambda ZIP is recreated by scripts/package-function.mjs and omitted from this delivery archive: Netlify builds the function from source, and Lambda archives contain their own runtime dependencies. No installed node_modules, caches, logs, credentials, or local game state are included in the project ZIP.
