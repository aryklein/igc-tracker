# IGC Tracker

3D IGC flight replay viewer for paraglider tracks with Cesium terrain, satellite imagery, altitude-colored trails, and playback controls.

## Features

- Upload an `.igc` file directly in the browser.
- Parse IGC `B` fixes locally; no backend upload is required.
- Replay the flight progressively with a follow camera.
- Autoplay loaded flights at `8x` speed.
- Drag the map to orbit around the paraglider; scroll to zoom.
- Seek through the flight with the progress slider.
- Color the completed track from green to red based on altitude across the whole flight.
- Show current altitude and vertical speed in `m/s`.
- Draw a vertical projection line from the paraglider to the terrain/map surface.

## Tech Stack

- Next.js `16.2.7`
- React `19.2.4`
- TypeScript
- CesiumJS

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000` and upload an `.igc` file.

## Cesium Ion Token

The app works without a Cesium ion token, but it falls back to OpenStreetMap imagery and no Cesium world terrain.

For satellite imagery and terrain, create `.env.local`:

```bash
NEXT_PUBLIC_CESIUM_ION_TOKEN=your_token_here
```

Then restart the dev server.

Do not commit `.env.local`; `.env*` files are ignored.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

Cesium static assets are copied into `public/cesium/` by:

```bash
npm run copy:cesium-assets
```

This also runs automatically after `npm install`. The generated `public/cesium/` directory is ignored and should not be committed.

## Project Structure

```text
src/app/page.tsx                    App entry, renders FlightApp
src/components/FlightApp.tsx         Owns loaded flight state
src/components/FileUpload.tsx        Reads and parses local IGC files
src/components/CesiumFlightViewer.tsx 3D replay, camera, track, marker, terrain projection
src/components/PlaybackControls.tsx  Play, reset, speed, and seek controls
src/lib/igcParser.ts                 IGC parser and flight stats
src/lib/flightMath.ts                Distance and formatting helpers
src/types/flight.ts                  Flight data types
```

## Verification

Before handing off changes, run:

```bash
npm run lint
npm run build
```

There is no test script yet.
