# Agent Notes

## Commands
- Use npm; `package-lock.json` is the source of truth.
- Dev server: `npm run dev`.
- Verification before handoff: `npm run lint` and `npm run build`.
- There is no test script yet; do not invent one.

## Next/Cesium Setup
- This is a Next `16.2.7` app with React `19.2.4`; verify APIs against installed packages instead of relying on older Next assumptions.
- Cesium static assets are generated into `public/cesium/` by `npm run copy:cesium-assets`, run automatically on `postinstall`.
- `public/cesium/` is ignored and should not be committed; ESLint also ignores it as vendor output.
- `NEXT_PUBLIC_CESIUM_ION_TOKEN` in `.env.local` enables Cesium ion satellite imagery and world terrain; `.env*` is ignored and must stay uncommitted.
- Without the token, the viewer falls back to OpenStreetMap imagery and no Cesium world terrain.

## App Wiring
- `src/app/page.tsx` only renders `FlightApp`; the app is intentionally client-side because file parsing and Cesium WebGL run in the browser.
- Main UI flow: `FlightApp` owns the parsed flight state, `FileUpload` parses `.igc`, `CesiumFlightViewer` renders and replays it, `PlaybackControls` controls replay speed/state.
- IGC parsing lives in `src/lib/igcParser.ts`; it supports `B` fixes, GPS altitude with pressure-altitude fallback, midnight rollover, and cached max lift/sink from 10-second rolling vario windows. Shared vario math lives in `src/lib/flightMath.ts`.
- `FlightApp` supports animated panel collapse. On collapsed mobile fullscreen mode, the measured HUD overlap is reserved from Cesium's viewport so the replay centers in the unobstructed map area.
- Cesium rendering is imperative in `src/components/CesiumFlightViewer.tsx`; camera, marker, active segment, projection line, and viewport-reservation state are stored in refs to avoid React re-render loops.
- The track is colored green-to-red by altitude over the whole flight; the vertical projection line uses `viewer.scene.globe.getHeight` so it lands on terrain/map surface.
