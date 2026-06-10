# Viewer Rendering Notes

This project keeps most of the complicated rendering logic in `src/components/CesiumFlightViewer.tsx`. This note explains the non-obvious parts so future changes do not have to rediscover the Cesium and terrain details.

## Data Flow

An IGC file is parsed into a `ParsedFlight` object by `src/lib/igcParser.ts`. The important field for rendering is `points`, where each `FlightPoint` has:

- `timestamp`: absolute UTC timestamp in milliseconds.
- `elapsedMs`: milliseconds since the first valid fix.
- `latitude` and `longitude`: decimal degrees.
- `altitude`: GPS altitude when available, otherwise pressure altitude.
- `gpsAltitude` and `pressureAltitude`: original altitude fields from the IGC fix.

`FlightApp` owns the current `ParsedFlight` and passes it to `CesiumFlightViewer`. Uploaded files and shared links use the same parser. Shared links pass an `initialFlight` during hydration, so the viewer can receive a flight before the user interacts with the page.

## Why Cesium State Lives In Refs

Cesium is imperative. The viewer, entities, camera, and callback-driven geometry are not a natural fit for React state updates on every animation frame.

`CesiumFlightViewer` stores frequently changing rendering state in refs:

- `currentPositionRef`: current paraglider position.
- `activeSegmentPositionsRef`: the current in-progress track segment.
- `shadowPositionsRef`: ground-to-paraglider projection beam endpoints.
- `projectionGroundPositionRef`: center of the ground target ring.
- `groundHeightsRef`: sampled terrain heights for flight fixes.
- `renderPositionsRef`: precomputed Cesium Cartesian positions for the flight fixes.

Cesium entities read those refs through `CallbackProperty` or `CallbackPositionProperty`. React state is only used for UI values such as play/pause, the HUD altitude, AGL, vertical speed, and elapsed time.

This avoids rerendering React for every visual entity update while still keeping the HUD reactive.

## Loading Cesium

Cesium static assets are copied to `public/cesium/` by `npm run copy:cesium-assets`. The viewer sets `window.CESIUM_BASE_URL = "/cesium/"` and then loads `/cesium/Cesium.js` at runtime.

This is why `CesiumFlightViewer` is a client component. File parsing and WebGL rendering both happen in the browser.

## Terrain Readiness And AGL

When `NEXT_PUBLIC_CESIUM_ION_TOKEN` exists, the viewer uses Cesium ion satellite imagery and world terrain. The world terrain provider is created with `Cesium.createWorldTerrainAsync()` before the viewer is marked ready.

That ordering matters. Shared-link flights are available immediately during hydration, so flight setup can start as soon as Cesium reports ready. If the app used `Terrain.fromWorldTerrain()` and marked the viewer ready before the terrain provider finished resolving, `prepareRenderPositions` could cache fallback ground heights near `0`. The HUD would then show AGL almost equal to MSL altitude.

The current setup waits for the terrain provider first, then calls `setIsReady(true)`. If world terrain creation fails, the app still opens and falls back to map/globe heights.

## Precomputing The Render Path

`prepareRenderPositions` converts every flight fix into a Cesium `Cartographic`, samples terrain with `sampleTerrainMostDetailed`, and then stores:

- `groundHeightsRef`: one ground height per fix.
- `renderPositionsRef`: one rendered Cartesian position per fix.

The rendered altitude is not just `point.altitude`. It is calculated with `getRenderAltitude`:

```text
render altitude = terrain height + AGL + small visual clearance
```

The small clearance keeps the marker and track from visually clipping into terrain when the glider is very low. It does not change the HUD altitude or AGL math.

Precomputing these positions has two benefits:

- Playback does not need to resample terrain or recompute every track vertex on each frame.
- The track and marker use the same terrain-adjusted positions, so they stay aligned.

## How The Track Is Drawn

The full trail is made of many short Cesium polyline entities, one for each pair of adjacent fixes. Each segment gets a fixed color based on the average altitude of its two endpoints.

On flight setup:

- All completed-track segment entities are created with `show: false`.
- `segmentEntitiesRef` stores those entities.
- `activeSegmentRef` is created separately and uses callback positions.

During playback, `updateVisibleSegments` reveals completed segments by flipping `show` from `false` to `true`. This is the main trick that makes the path draw progressively without rebuilding the entire polyline every frame.

The currently active segment is handled separately. `findPointAtElapsed` finds the current interpolated point between two IGC fixes, and `getCurrentRenderPosition` lerps between the two precomputed Cartesian positions. `activeSegmentPositionsRef` then contains:

```text
[previous fix render position, current interpolated render position]
```

Because Cesium reads that ref through `CallbackProperty`, the visible active segment grows smoothly as playback advances.

At the end of the flight, the last completed segment is assigned the final active segment positions so the displayed route remains complete.

## Interpolation

`findPointAtElapsed` does a binary search over `points` to find the next fix for the current playback time. It interpolates latitude, longitude, altitude, and timestamp between the previous and next fixes.

For marker rendering, `getCurrentRenderPosition` does not convert the interpolated latitude/longitude directly for normal in-flight points. Instead, it lerps between the precomputed Cartesian endpoints. This keeps the marker on the same terrain-adjusted path used by the visible track.

## Projection Beam And Ground Target

The altitude projection is made of two Cesium entities:

- A glowing polyline from terrain to the current paraglider position.
- A translucent ellipse centered at the ground contact point.

`updateTrack` updates `shadowPositionsRef` and `projectionGroundPositionRef` each frame. The Cesium entities read those refs through callback properties, so the beam and target follow playback without React rerendering.

The beam is graphical only. AGL still comes from:

```text
current altitude - interpolated sampled ground height
```

## Camera Control

Cesium's default mouse controls are disabled. The app implements its own orbit behavior so the camera follows the paraglider while still allowing drag orbit and wheel zoom.

`orbitRef` stores heading, pitch, and range. Pointer drag changes heading/pitch, wheel and pinch change range, and `updateCamera` calls:

```text
viewer.camera.lookAt(current position, HeadingPitchRange)
```

This keeps the camera centered on the current glider position after playback updates, seeking, reset, and user camera input.

## Fallback Behavior Without Cesium Ion

Without `NEXT_PUBLIC_CESIUM_ION_TOKEN`, the viewer uses OpenStreetMap imagery and no Cesium world terrain. Terrain sampling is skipped because the ellipsoid provider has no detailed availability. Ground height falls back to the currently loaded globe height or `0`.

That means the app still works locally without a token, but AGL is only meaningful when detailed terrain is available.
