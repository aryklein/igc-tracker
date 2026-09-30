"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { verticalSpeedAtElapsed } from "@/lib/flightMath";
import type { ComparedFlight, FlightPoint, FlightSyncMode, ParsedFlight } from "@/types/flight";
import { PlaybackControls } from "./PlaybackControls";

type CesiumModule = typeof import("cesium");
type Viewer = import("cesium").Viewer;
type Entity = import("cesium").Entity;
type Cartesian3 = import("cesium").Cartesian3;
type Color = import("cesium").Color;
type TerrainProvider = import("cesium").TerrainProvider;

type CesiumFlightViewerProps = {
  flights: ComparedFlight[];
  followedFlightId: string | null;
  isPanelCollapsed: boolean;
  syncMode?: FlightSyncMode;
};

type InterpolatedPoint = {
  point: FlightPoint;
  index: number;
};

type FlightRenderData = {
  flight: ComparedFlight;
  positions: Cartesian3[];
  groundHeights: number[];
  segmentEntities: Entity[];
  activeSegment: Entity;
  marker: Entity;
  label: Entity;
  beam: Entity;
  curtain: Entity;
  curtainPositions: Cartesian3[];
  curtainMinimumHeights: number[];
  curtainMaximumHeights: number[];
  curtainElapsed: number;
  beamPositions: Cartesian3[];
  activeSegmentPositions: Cartesian3[];
  activeSegmentColor: Color;
  labelText: string;
  labelPosition: Cartesian3 | undefined;
  isFollowed: boolean;
  visibleSegmentCount: number;
};

const VISUAL_TERRAIN_CLEARANCE_METERS = 8;
const CURTAIN_DURATION_MS = 30_000;

// Fade through the middle, then strengthen the ground edge; older track stays transparent.
function createCurtainTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const age = context.createLinearGradient(0, 0, 128, 0);
  age.addColorStop(0, "rgba(255,255,255,0)");
  age.addColorStop(1, "rgba(255,255,255,1)");
  context.fillStyle = age;
  context.fillRect(0, 0, 128, 128);
  context.globalCompositeOperation = "destination-in";
  const height = context.createLinearGradient(0, 0, 0, 128);
  height.addColorStop(0, "rgba(255,255,255,0.6)");
  height.addColorStop(0.55, "rgba(255,255,255,0.08)");
  height.addColorStop(0.85, "rgba(255,255,255,0.12)");
  height.addColorStop(1, "rgba(255,255,255,1)");
  context.fillStyle = height;
  context.fillRect(0, 0, 128, 128);
  return canvas;
}
declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
    Cesium?: CesiumModule;
  }
}

function loadCesium() {
  if (window.Cesium) {
    return Promise.resolve(window.Cesium);
  }

  return new Promise<CesiumModule>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="/cesium/Cesium.js"]');

    if (existingScript) {
      existingScript.addEventListener("load", () => (window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium did not initialize."))), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Could not load Cesium.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "/cesium/Cesium.js";
    script.async = true;
    script.addEventListener("load", () => (window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium did not initialize."))), { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load Cesium.")), { once: true });
    document.head.append(script);
  });
}

function findPointAtElapsed(points: FlightPoint[], elapsedMs: number): InterpolatedPoint {
  if (elapsedMs <= 0) {
    return { point: points[0], index: 0 };
  }

  const lastPoint = points[points.length - 1];

  if (elapsedMs >= lastPoint.elapsedMs) {
    return { point: lastPoint, index: points.length - 1 };
  }

  let low = 0;
  let high = points.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (points[mid].elapsedMs < elapsedMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const next = points[low];
  const previous = points[Math.max(0, low - 1)];
  const segmentDuration = Math.max(1, next.elapsedMs - previous.elapsedMs);
  const t = (elapsedMs - previous.elapsedMs) / segmentDuration;

  return {
    point: {
      timestamp: previous.timestamp + (next.timestamp - previous.timestamp) * t,
      elapsedMs,
      latitude: previous.latitude + (next.latitude - previous.latitude) * t,
      longitude: previous.longitude + (next.longitude - previous.longitude) * t,
      altitude: previous.altitude + (next.altitude - previous.altitude) * t,
      gpsAltitude: previous.gpsAltitude,
      pressureAltitude: previous.pressureAltitude,
    },
    index: low,
  };
}

function interpolateRenderPosition(
  Cesium: CesiumModule,
  flight: ParsedFlight,
  positions: Cartesian3[],
  current: InterpolatedPoint,
) {
  if (current.index <= 0) {
    return positions[0];
  }

  if (current.point.elapsedMs >= flight.durationMs) {
    return positions.at(-1);
  }

  const previous = flight.points[current.index - 1];
  const next = flight.points[current.index];
  const segmentDuration = Math.max(1, next.elapsedMs - previous.elapsedMs);
  const t = Math.max(0, Math.min(1, (current.point.elapsedMs - previous.elapsedMs) / segmentDuration));

  return Cesium.Cartesian3.lerp(positions[current.index - 1], positions[current.index], t, new Cesium.Cartesian3());
}

function getFlightElapsedMs(flight: ParsedFlight, timelineMs: number, syncMode: FlightSyncMode, timelineStart: number) {
  if (syncMode === "launch") {
    return Math.min(timelineMs, flight.durationMs);
  }

  return timelineStart + timelineMs - flight.startTime;
}

export function CesiumFlightViewer({ flights, followedFlightId, isPanelCollapsed, syncMode = "launch" }: CesiumFlightViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerShellRef = useRef<HTMLElement | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const renderDataRef = useRef(new Map<string, FlightRenderData>());
  const animationFrameRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(8);
  const followedFlightIdRef = useRef<string | null>(followedFlightId);
  const syncModeRef = useRef<FlightSyncMode>(syncMode);
  const orbitRef = useRef({ heading: 0, pitch: -0.75, range: 2200 });
  const chaseRef = useRef({ enabled: false, heading: 0, pitch: -0.75 });
  const orbitalRef = useRef({ enabled: true, speed: 0 });
  const cameraInteractionRef = useRef(false);
  const curtainTextureRef = useRef<HTMLCanvasElement | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [currentMs, setCurrentMs] = useState(0);
  const [currentPoint, setCurrentPoint] = useState<FlightPoint | null>(null);
  const [currentAgl, setCurrentAgl] = useState<number | null>(null);
  const [verticalSpeed, setVerticalSpeed] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [followDirection, setFollowDirection] = useState(false);
  const [orbitalView, setOrbitalView] = useState(true);
  const [hudElement, setHudElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const viewerShell = viewerShellRef.current;

    if (!viewerShell) {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 880px)");
    const updateReservedSpace = () => {
      if (!isPanelCollapsed || !hudElement || !mediaQuery.matches) {
        viewerShell.style.removeProperty("--fullscreen-hud-reserved");
        return;
      }

      const viewerRect = viewerShell.getBoundingClientRect();
      const hudRect = hudElement.getBoundingClientRect();
      const reservedSpace = Math.max(0, viewerRect.bottom - hudRect.top);
      viewerShell.style.setProperty("--fullscreen-hud-reserved", `${Math.ceil(reservedSpace)}px`);
    };
    const resizeObserver = new ResizeObserver(updateReservedSpace);

    resizeObserver.observe(viewerShell);

    if (hudElement) {
      resizeObserver.observe(hudElement);
    }

    updateReservedSpace();
    mediaQuery.addEventListener("change", updateReservedSpace);

    return () => {
      resizeObserver.disconnect();
      mediaQuery.removeEventListener("change", updateReservedSpace);
      viewerShell.style.removeProperty("--fullscreen-hud-reserved");
    };
  }, [hudElement, isPanelCollapsed]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || !isReady) {
      return;
    }

    let animationFrame: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }

      animationFrame = requestAnimationFrame(() => {
        viewerRef.current?.resize();
        viewerRef.current?.scene.requestRender();
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();

      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isReady]);

  const followedFlight = flights.find((entry) => entry.id === followedFlightId) ?? flights[0] ?? null;
  const timelineStart = syncMode === "actual" && flights.length > 0 ? Math.min(...flights.map((entry) => entry.flight.startTime)) : 0;
  const timelineDuration =
    syncMode === "actual" && flights.length > 0
      ? Math.max(...flights.map((entry) => entry.flight.endTime)) - timelineStart
      : Math.max(0, ...flights.map((entry) => entry.flight.durationMs));
  const isSingleFlight = flights.length === 1;

  const altitudeColor = useCallback((Cesium: CesiumModule, altitude: number, flightData: ParsedFlight) => {
    const range = Math.max(1, flightData.maxAltitude - flightData.minAltitude);
    const t = Math.max(0, Math.min(1, (altitude - flightData.minAltitude) / range));

    if (t < 0.5) {
      return new Cesium.Color(t * 2, 0.92, 0.18, 1);
    }

    return new Cesium.Color(1, 0.92 - (t - 0.5) * 1.7, 0.18 - (t - 0.5) * 0.24, 1);
  }, []);

  const altitudeCssColor = useCallback((altitude: number, flightData: ParsedFlight) => {
    const range = Math.max(1, flightData.maxAltitude - flightData.minAltitude);
    const t = Math.max(0, Math.min(1, (altitude - flightData.minAltitude) / range));

    if (t < 0.5) {
      return `rgb(${Math.round(t * 2 * 255)}, 235, 46)`;
    }

    return `rgb(255, ${Math.max(0, Math.round(235 - (t - 0.5) * 434))}, 0)`;
  }, []);

  const getRenderAltitude = useCallback((point: FlightPoint, sampledGroundHeight?: number) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    let groundHeight = sampledGroundHeight;

    if (groundHeight === undefined) {
      if (!Cesium || !viewer) {
        return point.altitude;
      }

      groundHeight = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(point.longitude, point.latitude));
    }

    if (groundHeight === undefined) {
      return point.altitude;
    }

    const agl = Math.max(0, point.altitude - groundHeight);
    const visualClearance = Math.min(VISUAL_TERRAIN_CLEARANCE_METERS, agl);

    return groundHeight + agl + visualClearance;
  }, []);

  const updateCamera = useCallback((target: Cartesian3 | undefined) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    if (!Cesium || !viewer || !target) {
      return;
    }

    const { heading, pitch, range } = orbitRef.current;
    const chase = chaseRef.current;
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(chase.enabled ? chase.heading : heading, chase.enabled ? chase.pitch : pitch, range));
  }, []);

  const prepareFlightRenderData = useCallback(
    async (Cesium: CesiumModule, viewer: Viewer, comparedFlight: ComparedFlight) => {
      const cartographics = comparedFlight.flight.points.map((point) =>
        Cesium.Cartographic.fromDegrees(point.longitude, point.latitude),
      );
      let sampledTerrain = false;

      try {
        if (viewer.terrainProvider.availability) {
          await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics);
          sampledTerrain = true;
        }
      } catch {
        // Fall back to currently loaded terrain heights below.
      }

      const groundHeights = cartographics.map((cartographic) =>
        sampledTerrain && Number.isFinite(cartographic.height)
          ? cartographic.height
          : viewer.scene.globe.getHeight(cartographic) ?? (Number.isFinite(cartographic.height) ? cartographic.height : 0),
      );
      const positions = comparedFlight.flight.points.map((point, index) =>
        Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, getRenderAltitude(point, groundHeights[index])),
      );

      return { groundHeights, positions };
    },
    [getRenderAltitude],
  );

  const getCurrentFlightPosition = useCallback(
    (renderData: FlightRenderData, timelineMs: number, mode: FlightSyncMode, start: number) => {
      const flightElapsed = getFlightElapsedMs(renderData.flight.flight, timelineMs, mode, start);

      if (flightElapsed < 0) {
        return null;
      }

      const current = findPointAtElapsed(renderData.flight.flight.points, flightElapsed);

      return { current, flightElapsed, position: interpolateRenderPosition(cesiumRef.current!, renderData.flight.flight, renderData.positions, current) };
    },
    [],
  );

  const updateFlightEntities = useCallback(
    (timelineMs: number) => {
      const Cesium = cesiumRef.current;
      const viewer = viewerRef.current;

      if (!Cesium || !viewer) {
        return;
      }

      const followedId = followedFlightIdRef.current;
      const mode = syncModeRef.current;
      const start = mode === "actual" ? Math.min(...flights.map((entry) => entry.flight.startTime)) : 0;

      for (const renderData of renderDataRef.current.values()) {
        const result = getCurrentFlightPosition(renderData, timelineMs, mode, start);
        const isFollowed = renderData.flight.id === followedId;
        if (!isFollowed || !result) {
          renderData.curtain.show = false;
          renderData.curtainElapsed = Number.NaN;
        }

        if (!result) {
          renderData.marker.show = false;
          renderData.label.show = false;
          renderData.beam.show = false;
          renderData.activeSegment.show = false;
          renderData.beamPositions.length = 0;
          renderData.activeSegmentPositions.length = 0;
          renderData.labelPosition = undefined;

          for (const segment of renderData.segmentEntities) {
            segment.show = false;
          }

          renderData.visibleSegmentCount = 0;

          if (isFollowed) {
            setCurrentPoint(null);
            setCurrentAgl(null);
            setVerticalSpeed(0);
          }

          continue;
        }

        const nextVisibleCount =
          result.flightElapsed >= renderData.flight.flight.durationMs
            ? renderData.segmentEntities.length
            : Math.max(0, result.current.index - 1);

        if (nextVisibleCount < renderData.visibleSegmentCount) {
          for (let index = nextVisibleCount; index < renderData.visibleSegmentCount; index += 1) {
            renderData.segmentEntities[index].show = false;
          }
        }

        for (let index = renderData.visibleSegmentCount; index < nextVisibleCount; index += 1) {
          renderData.segmentEntities[index].show = true;
        }

        renderData.visibleSegmentCount = nextVisibleCount;
        renderData.marker.show = true;
        renderData.label.show = showLabels;
        renderData.beam.show = !isFollowed;
        renderData.activeSegment.show = true;

        renderData.activeSegmentColor =
          flights.length === 1
            ? altitudeColor(Cesium, result.current.point.altitude, renderData.flight.flight)
            : Cesium.Color.fromCssColorString(renderData.flight.color);

        if (renderData.beam.polyline && renderData.isFollowed !== isFollowed) {
          renderData.isFollowed = isFollowed;
          renderData.beam.polyline.width = new Cesium.ConstantProperty(isFollowed ? 4 : 2);
          renderData.beam.polyline.material = new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString(renderData.flight.color).withAlpha(isFollowed ? 0.42 : 0.3),
            glowPower: isFollowed ? 0.28 : 0.2,
            taperPower: isFollowed ? 0.65 : 0.7,
          });
        }

        const previousIndex = Math.max(0, result.current.index - 1);
        const nextIndex = Math.min(result.current.index, renderData.groundHeights.length - 1);
        const previous = renderData.flight.flight.points[previousIndex];
        const next = renderData.flight.flight.points[nextIndex];
        const segmentDuration = Math.max(1, next.elapsedMs - previous.elapsedMs);
        const t = Math.max(0, Math.min(1, (result.current.point.elapsedMs - previous.elapsedMs) / segmentDuration));
        const groundHeight =
          renderData.groundHeights[previousIndex] +
          (renderData.groundHeights[nextIndex] - renderData.groundHeights[previousIndex]) * t;
        const groundPosition = Cesium.Cartesian3.fromDegrees(result.current.point.longitude, result.current.point.latitude, groundHeight);

        if (!result.position) {
          renderData.beamPositions.length = 0;
          continue;
        }

        renderData.marker.position = new Cesium.ConstantPositionProperty(result.position);
        renderData.labelPosition = result.position;
        renderData.labelText = `${renderData.flight.flight.pilotName ?? renderData.flight.flight.filename}\n${Math.round(result.current.point.altitude)} m`;
        renderData.beamPositions.splice(0, renderData.beamPositions.length, groundPosition, result.position);
        renderData.activeSegmentPositions.splice(
          0,
          renderData.activeSegmentPositions.length,
          renderData.positions[Math.max(0, result.current.index - 1)],
          result.position,
        );

        if (isFollowed && renderData.curtain.wall) {
          const elapsed = result.current.point.elapsedMs;
          // Dynamic wall geometry updates synchronously, avoiding async replacement gaps.
          // Keep its front edge attached to the marker, with at most 31 samples.
          if (elapsed !== renderData.curtainElapsed) {
            const positions: Cartesian3[] = [];
            const minimumHeights: number[] = [];
            const maximumHeights: number[] = [];
            let previousLongitude: number | undefined;
            let previousLatitude: number | undefined;
            const begin = Math.max(0, elapsed - CURTAIN_DURATION_MS);
            const samples = Math.min(30, Math.ceil((elapsed - begin) / 1000));
            for (let sample = 0; sample <= samples && samples > 0; sample += 1) {
              const fix = findPointAtElapsed(renderData.flight.flight.points, begin + (elapsed - begin) * sample / samples);
              const top = interpolateRenderPosition(Cesium, renderData.flight.flight, renderData.positions, fix);
              if (!top) continue;
              const right = fix.index;
              const left = Math.max(0, right - 1);
              const points = renderData.flight.flight.points;
              const fraction = Math.max(0, Math.min(1, (fix.point.elapsedMs - points[left].elapsedMs) / Math.max(1, points[right].elapsedMs - points[left].elapsedMs)));
              const ground = renderData.groundHeights[left] + (renderData.groundHeights[right] - renderData.groundHeights[left]) * fraction;
              const cartographic = Cesium.Cartographic.fromCartesian(top);
              // WallGeometry discards repeated horizontal positions, even if altitude changes.
              if (previousLongitude !== undefined && previousLatitude !== undefined &&
                Math.abs(cartographic.longitude - previousLongitude) < 1e-8 &&
                Math.abs(cartographic.latitude - previousLatitude) < 1e-8) continue;
              previousLongitude = cartographic.longitude;
              previousLatitude = cartographic.latitude;
              positions.push(top);
              minimumHeights.push(ground);
              maximumHeights.push(Math.max(ground, cartographic.height));
            }
            renderData.curtainPositions.splice(0, renderData.curtainPositions.length, ...positions);
            renderData.curtainMinimumHeights.splice(0, renderData.curtainMinimumHeights.length, ...minimumHeights);
            renderData.curtainMaximumHeights.splice(0, renderData.curtainMaximumHeights.length, ...maximumHeights);
            renderData.curtain.show = positions.length >= 2 && maximumHeights.some((height, index) => height > minimumHeights[index]);
            renderData.curtainElapsed = elapsed;
          }
          // Retain the original altitude cue until a non-degenerate curtain can form.
          renderData.beam.show = !renderData.curtain.show;
        }

        if (isFollowed) {
          updateCamera(result.position);
          setCurrentPoint(result.current.point);
          setCurrentAgl(Math.max(0, result.current.point.altitude - groundHeight));
          setVerticalSpeed(
            result.flightElapsed > renderData.flight.flight.durationMs
              ? 0
              : verticalSpeedAtElapsed(renderData.flight.flight.points, result.current.point.elapsedMs),
          );
        }
      }
    },
    [altitudeColor, flights, getCurrentFlightPosition, updateCamera, showLabels],
  );

  const createFlightEntities = useCallback(
    async (Cesium: CesiumModule, viewer: Viewer, comparedFlight: ComparedFlight, isCancelled: () => boolean) => {
      const prepared = await prepareFlightRenderData(Cesium, viewer, comparedFlight);

      if (isCancelled()) {
        return null;
      }

      const segmentEntities: Entity[] = [];

      for (let index = 1; index < prepared.positions.length; index += 1) {
        segmentEntities.push(
          viewer.entities.add({
            name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} flight track segment`,
            show: false,
            polyline: {
              clampToGround: false,
              material:
                flights.length === 1
                  ? new Cesium.ColorMaterialProperty(
                      altitudeColor(
                        Cesium,
                        (comparedFlight.flight.points[index - 1].altitude + comparedFlight.flight.points[index].altitude) / 2,
                        comparedFlight.flight,
                      ),
                    )
                  : new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(comparedFlight.color)),
              positions: [prepared.positions[index - 1], prepared.positions[index]],
              width: 3,
            },
          }),
        );
      }

      const marker = viewer.entities.add({
        name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} marker`,
        point: {
          color: Cesium.Color.fromCssColorString(comparedFlight.color),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          pixelSize: 10,
        },
      });
      let labelText = "";
      let labelPosition: Cartesian3 | undefined;
      const label = viewer.entities.add({
        name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} pilot label`,
        position: new Cesium.CallbackPositionProperty(() => labelPosition, false),
        label: {
          text: new Cesium.CallbackProperty(() => labelText, false),
          font: "bold 15px sans-serif",
          fillColor: Cesium.Color.fromCssColorString(comparedFlight.color),
          style: Cesium.LabelStyle.FILL,
          showBackground: false,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(500, 1, 15_000, 0.55),
          translucencyByDistance: new Cesium.NearFarScalar(12_000, 1, 25_000, 0),
        },
      });
      const activeSegmentPositions: Cartesian3[] = [];
      let activeSegmentColor: Color = Cesium.Color.fromCssColorString(comparedFlight.color);
      const activeSegment = viewer.entities.add({
        name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} active flight track segment`,
        show: false,
        polyline: {
          clampToGround: false,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => activeSegmentColor, false),
          ),
          positions: new Cesium.CallbackProperty(() => activeSegmentPositions, false),
          width: 3,
        },
      });
      const beamPositions: Cartesian3[] = [];
      curtainTextureRef.current ??= createCurtainTexture();
      const curtainPositions: Cartesian3[] = [];
      const curtainMinimumHeights: number[] = [];
      const curtainMaximumHeights: number[] = [];
      const curtain = viewer.entities.add({
        name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} fading altitude curtain`,
        show: false,
        wall: {
          positions: new Cesium.CallbackProperty(() => curtainPositions, false),
          minimumHeights: new Cesium.CallbackProperty(() => curtainMinimumHeights, false),
          maximumHeights: new Cesium.CallbackProperty(() => curtainMaximumHeights, false),
          outline: false,
          material: new Cesium.ImageMaterialProperty({
            image: curtainTextureRef.current,
            transparent: true,
            color: Cesium.Color.fromCssColorString(comparedFlight.color).withAlpha(0.5),
          }),
        },
      });
      let beamIsFollowed = false;
      const beam = viewer.entities.add({
        name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} altitude projection beam`,
        polyline: {
          clampToGround: false,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString(comparedFlight.color).withAlpha(0.3),
            glowPower: 0.2,
            taperPower: 0.7,
          }),
          positions: new Cesium.CallbackProperty(() => beamPositions, false),
          width: 2,
        },
      });

      return {
        flight: comparedFlight,
        ...prepared,
        segmentEntities,
        activeSegment,
        activeSegmentPositions,
        marker,
        label,
        beam,
        curtain,
        curtainPositions,
        curtainMinimumHeights,
        curtainMaximumHeights,
        curtainElapsed: Number.NaN,
        beamPositions,
        get activeSegmentColor() {
          return activeSegmentColor;
        },
        set activeSegmentColor(color: Color) {
          activeSegmentColor = color;
        },
        get labelText() {
          return labelText;
        },
        set labelText(text: string) {
          labelText = text;
        },
        get labelPosition() {
          return labelPosition;
        },
        set labelPosition(position: Cartesian3 | undefined) {
          labelPosition = position;
        },
        get isFollowed() {
          return beamIsFollowed;
        },
        set isFollowed(value: boolean) {
          beamIsFollowed = value;
        },
        visibleSegmentCount: 0,
      };
    },
    [altitudeColor, flights.length, prepareFlightRenderData],
  );

  useEffect(() => {
    let cancelled = false;

    async function setupCesium() {
      if (!containerRef.current) {
        return;
      }

      try {
        window.CESIUM_BASE_URL = "/cesium/";
        const Cesium = await loadCesium();

        if (cancelled || !containerRef.current) {
          return;
        }

        cesiumRef.current = Cesium;
        const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;

        if (token) {
          Cesium.Ion.defaultAccessToken = token;
        }

        const baseLayer = token
          ? Cesium.ImageryLayer.fromProviderAsync(
              Cesium.createWorldImageryAsync({ style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS }),
            )
          : new Cesium.ImageryLayer(
              new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }),
            );
        let terrainProvider: TerrainProvider | undefined;

        if (token) {
          try {
            terrainProvider = await Cesium.createWorldTerrainAsync();
          } catch {
            terrainProvider = undefined;
          }
        }

        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          baseLayer,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          terrainProvider,
        });

        viewer.scene.globe.depthTestAgainstTerrain = false;
        viewer.scene.screenSpaceCameraController.enableRotate = false;
        viewer.scene.screenSpaceCameraController.enableTranslate = false;
        viewer.scene.screenSpaceCameraController.enableTilt = false;
        viewer.scene.screenSpaceCameraController.enableLook = false;
        viewer.scene.screenSpaceCameraController.enableZoom = false;
        viewerRef.current = viewer;
        setIsReady(true);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not start the 3D map.");
      }
    }

    setupCesium();

    return () => {
      cancelled = true;

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    lastFrameRef.current = null;
  }, [isPlaying]);

  useEffect(() => {
    followedFlightIdRef.current = followedFlightId;
    syncModeRef.current = syncMode;
      elapsedRef.current = Math.min(elapsedRef.current, timelineDuration);

      if (followedFlightId && !renderDataRef.current.has(followedFlightId)) {
        setCurrentPoint(null);
        setCurrentAgl(null);
        setVerticalSpeed(0);
      }

      updateFlightEntities(elapsedRef.current);
    setCurrentMs(elapsedRef.current);
  }, [followedFlightId, syncMode, timelineDuration, updateFlightEntities]);

  useEffect(() => {
    const Cesium = cesiumRef.current;

    if (!Cesium) {
      return;
    }

    for (const renderData of renderDataRef.current.values()) {
      for (let index = 0; index < renderData.segmentEntities.length; index += 1) {
        const segment = renderData.segmentEntities[index];
        const from = renderData.flight.flight.points[index];
        const to = renderData.flight.flight.points[index + 1];

        if (segment.polyline) {
          segment.polyline.material =
            flights.length === 1
              ? new Cesium.ColorMaterialProperty(altitudeColor(Cesium, (from.altitude + to.altitude) / 2, renderData.flight.flight))
              : new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(renderData.flight.color));
        }
      }
    }
  }, [altitudeColor, flights.length]);

  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    let cancelled = false;

    if (!isReady || !Cesium || !viewer) {
      return;
    }

    const cesiumInstance = Cesium;
    const viewerInstance = viewer;

    async function synchronizeFlights() {
      const nextIds = new Set(flights.map((flight) => flight.id));

      for (const [id, renderData] of renderDataRef.current) {
        if (!nextIds.has(id)) {
          for (const segment of renderData.segmentEntities) {
            viewerInstance.entities.remove(segment);
          }

          viewerInstance.entities.remove(renderData.marker);
          viewerInstance.entities.remove(renderData.label);
          viewerInstance.entities.remove(renderData.activeSegment);
          viewerInstance.entities.remove(renderData.beam);
          viewerInstance.entities.remove(renderData.curtain);
          renderDataRef.current.delete(id);
        }
      }

      const additions = flights.filter((flight) => !renderDataRef.current.has(flight.id));
      const isInitialLoad = renderDataRef.current.size === 0 && additions.length > 0;

      await Promise.all(
        additions.map(async (flight) => {
          const renderData = await createFlightEntities(cesiumInstance, viewerInstance, flight, () => cancelled);

          if (renderData && !cancelled) {
            renderDataRef.current.set(flight.id, renderData);
          }
        }),
      );

      if (cancelled) {
        return;
      }

      updateFlightEntities(elapsedRef.current);

      if (isInitialLoad && !isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsPlaying(true);
      }
    }

    synchronizeFlights().catch((error) => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setLoadError(error instanceof Error ? error.message : "Could not prepare the 3D replay.");
    });

    return () => {
      cancelled = true;
    };
  }, [createFlightEntities, flights, isReady, updateFlightEntities]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const canvas = viewer?.canvas;

    if (!isReady || !canvas) {
      return;
    }

    const canvasElement = canvas;

    const activePointers = new Map<number, { x: number; y: number }>();
    let previousX = 0;
    let previousY = 0;
    let previousPinchDistance: number | null = null;

    function updateCameraFromFollowedFlight() {
      const renderData = renderDataRef.current.get(followedFlightIdRef.current ?? "");

      if (!renderData) {
        return;
      }

      const start =
        syncModeRef.current === "actual"
          ? Math.min(...flights.map((entry) => entry.flight.startTime))
          : 0;
      const result = getCurrentFlightPosition(renderData, elapsedRef.current, syncModeRef.current, start);

      updateCamera(result?.position);
    }

    function getPinchDistance() {
      const pointers = [...activePointers.values()];

      if (pointers.length < 2) {
        return null;
      }

      return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
    }

    function handlePointerDown(event: PointerEvent) {
      event.preventDefault();
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      cameraInteractionRef.current = true;
      orbitalRef.current.speed = 0;
      previousX = event.clientX;
      previousY = event.clientY;
      canvasElement.setPointerCapture(event.pointerId);
      previousPinchDistance = getPinchDistance();
    }

    function handlePointerMove(event: PointerEvent) {
      if (!activePointers.has(event.pointerId)) {
        return;
      }

      event.preventDefault();
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (activePointers.size >= 2) {
        const pinchDistance = getPinchDistance();

        if (pinchDistance !== null && previousPinchDistance !== null && pinchDistance > 0) {
          const zoomFactor = Math.max(0.75, Math.min(1.25, previousPinchDistance / pinchDistance));
          orbitRef.current.range = Math.max(300, Math.min(35_000, orbitRef.current.range * zoomFactor));
          updateCameraFromFollowedFlight();
        }

        previousPinchDistance = pinchDistance;
        return;
      }

      const deltaX = event.clientX - previousX;
      const deltaY = event.clientY - previousY;
      previousX = event.clientX;
      previousY = event.clientY;
      if (chaseRef.current.enabled) {
        return;
      }

      orbitRef.current.heading -= deltaX * 0.006;
      orbitRef.current.pitch = Math.max(-1.45, Math.min(-0.15, orbitRef.current.pitch + deltaY * 0.004));
      updateCameraFromFollowedFlight();
    }

    function handlePointerUp(event: PointerEvent) {
      activePointers.delete(event.pointerId);
      cameraInteractionRef.current = activePointers.size > 0;
      previousPinchDistance = getPinchDistance();
      const remainingPointer = activePointers.values().next().value;
      if (remainingPointer) {
        previousX = remainingPointer.x;
        previousY = remainingPointer.y;
      }

      if (canvasElement.hasPointerCapture(event.pointerId)) {
        canvasElement.releasePointerCapture(event.pointerId);
      }
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const zoomFactor = event.deltaY > 0 ? 1.12 : 0.88;
      orbitRef.current.range = Math.max(300, Math.min(35_000, orbitRef.current.range * zoomFactor));
      updateCameraFromFollowedFlight();
    }

    canvasElement.addEventListener("pointerdown", handlePointerDown);
    canvasElement.addEventListener("pointermove", handlePointerMove);
    canvasElement.addEventListener("pointerup", handlePointerUp);
    canvasElement.addEventListener("pointercancel", handlePointerUp);
    canvasElement.addEventListener("lostpointercapture", handlePointerUp);
    canvasElement.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      cameraInteractionRef.current = false;
      activePointers.clear();
      canvasElement.removeEventListener("pointerdown", handlePointerDown);
      canvasElement.removeEventListener("pointermove", handlePointerMove);
      canvasElement.removeEventListener("pointerup", handlePointerUp);
      canvasElement.removeEventListener("pointercancel", handlePointerUp);
      canvasElement.removeEventListener("lostpointercapture", handlePointerUp);
      canvasElement.removeEventListener("wheel", handleWheel);
    };
  }, [flights, getCurrentFlightPosition, isReady, updateCamera]);

  useEffect(() => {
    function tick(now: number) {
      try {
        const orbital = orbitalRef.current;
        if (orbital.enabled && followedFlight && !cameraInteractionRef.current) {
          const seconds = Math.min(0.1, Math.max(0, now - (lastFrameRef.current ?? now)) / 1000);
          // Ease into a 90-second revolution, independent of replay speed.
          orbital.speed += (Math.PI / 45 - orbital.speed) * (1 - Math.exp(-seconds / 0.8));
          orbitRef.current.heading = (orbitRef.current.heading + orbital.speed * seconds) % (Math.PI * 2);
          const data = renderDataRef.current.get(followedFlight.id);
          if (data) {
            updateCamera(getCurrentFlightPosition(data, elapsedRef.current, syncModeRef.current, timelineStart)?.position);
          }
        }
        const chase = chaseRef.current;
        if (chase.enabled && followedFlight) {
          const flight = followedFlight.flight;
          const elapsed = Math.max(0, Math.min(flight.durationMs, getFlightElapsedMs(flight, elapsedRef.current, syncModeRef.current, timelineStart)));
          // A short centered window filters GPS jitter without cutting across whole thermals.
          const from = findPointAtElapsed(flight.points, Math.max(0, elapsed - 2000)).point;
          const to = findPointAtElapsed(flight.points, Math.min(flight.durationMs, elapsed + 2000)).point;
          const lat1 = from.latitude * Math.PI / 180;
          const lat2 = to.latitude * Math.PI / 180;
          const deltaLon = (to.longitude - from.longitude) * Math.PI / 180;
          const east = Math.sin(deltaLon) * Math.cos(lat2);
          const north = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
          const seconds = Math.min(0.1, Math.max(0, now - (lastFrameRef.current ?? now)) / 1000);
          const alpha = 1 - Math.exp(-seconds / 0.65);
          // Retain heading when movement is too small to distinguish from GPS noise (~3 m).
          if (Math.hypot(east, north) * 6371000 > 3) {
            const desired = Math.atan2(east, north);
            const difference = Math.atan2(Math.sin(desired - chase.heading), Math.cos(desired - chase.heading));
            chase.heading += difference * alpha;
          }
          chase.pitch += (-0.4 - chase.pitch) * alpha;
          const data = renderDataRef.current.get(followedFlight.id);
          if (data) {
            updateCamera(getCurrentFlightPosition(data, elapsedRef.current, syncModeRef.current, timelineStart)?.position);
          }
        }
        if (followedFlight && isPlayingRef.current) {
          const previousFrame = lastFrameRef.current ?? now;
          const delta = now - previousFrame;
          elapsedRef.current = Math.min(timelineDuration, elapsedRef.current + delta * speedRef.current);
          updateFlightEntities(elapsedRef.current);
          setCurrentMs(elapsedRef.current);

          if (elapsedRef.current >= timelineDuration) {
            isPlayingRef.current = false;
            setIsPlaying(false);
          }
        }
      } catch (error) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        setLoadError(error instanceof Error ? error.message : "Could not update the 3D replay.");
      }

      lastFrameRef.current = now;
      animationFrameRef.current = requestAnimationFrame(tick);
    }

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [followedFlight, timelineDuration, timelineStart, getCurrentFlightPosition, updateCamera, updateFlightEntities]);

  function handleFollowDirectionChange(enabled: boolean) {
    const chase = chaseRef.current;
    if (enabled) {
      orbitalRef.current.enabled = false;
      orbitalRef.current.speed = 0;
      setOrbitalView(false);
      chase.heading = orbitRef.current.heading;
      chase.pitch = orbitRef.current.pitch;
    } else {
      // Resume manual orbit from the current view rather than snapping back.
      orbitRef.current.heading = chase.heading;
      orbitRef.current.pitch = chase.pitch;
    }
    chase.enabled = enabled;
    setFollowDirection(enabled);
  }

  function handleOrbitalViewChange(enabled: boolean) {
    if (enabled && chaseRef.current.enabled) {
      handleFollowDirectionChange(false);
    }
    orbitalRef.current.enabled = enabled;
    orbitalRef.current.speed = 0;
    setOrbitalView(enabled);
  }

  function handlePlayPause() {
    if (!followedFlight) {
      return;
    }

    if (elapsedRef.current >= timelineDuration) {
      elapsedRef.current = 0;
      updateFlightEntities(0);
      setCurrentMs(0);
    }

    const nextPlaying = !isPlayingRef.current;
    isPlayingRef.current = nextPlaying;
    lastFrameRef.current = null;
    setIsPlaying(nextPlaying);
  }

  function handleReset() {
    elapsedRef.current = 0;
    lastFrameRef.current = null;
    updateFlightEntities(0);
    setCurrentMs(0);
    isPlayingRef.current = false;
    setIsPlaying(false);
  }

  function handleSeek(elapsedMs: number) {
    for (const data of renderDataRef.current.values()) {
      data.curtainElapsed = Number.NaN;
    }
    elapsedRef.current = Math.max(0, Math.min(timelineDuration, elapsedMs));
    lastFrameRef.current = null;
    updateFlightEntities(elapsedRef.current);
    setCurrentMs(elapsedRef.current);

    if (elapsedRef.current >= timelineDuration) {
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  }

  return (
    <section ref={viewerShellRef} className="viewer-shell">
      <div ref={containerRef} className="cesium-container" />
      {flights.length === 0 ? (
        <div className="viewer-empty">
          <p>Upload an IGC file to start a 3D replay.</p>
          <span>Drag to orbit the paraglider. Scroll to zoom.</span>
        </div>
      ) : null}
      {loadError ? <div className="viewer-error">{loadError}</div> : null}
      {followedFlight ? (
        <div ref={setHudElement} className="hud">
          <div className="flight-card">
            <div className="flight-live-stats">
              <div className="altitude-stack">
                <strong
                  className="altitude-value"
                  style={currentPoint ? { color: isSingleFlight ? altitudeCssColor(currentPoint.altitude, followedFlight.flight) : followedFlight.color } : undefined}
                >
                  {currentPoint ? `${Math.round(currentPoint.altitude)} m` : "-- m"}
                </strong>
                <span className="agl-value">AGL {currentAgl === null ? "--" : Math.round(currentAgl)} m</span>
              </div>
              <em className={verticalSpeed >= 0 ? "climb" : "sink"}>{verticalSpeed.toFixed(1)} m/s</em>
            </div>
          </div>
          <PlaybackControls
            currentMs={currentMs}
            currentTimestamp={currentPoint?.timestamp ?? null}
            durationMs={timelineDuration}
            isPlaying={isPlaying}
            showLabels={showLabels}
            followDirection={followDirection}
            onFollowDirectionChange={handleFollowDirectionChange}
            orbitalView={orbitalView}
            onOrbitalViewChange={handleOrbitalViewChange}
            speed={speed}
            onPlayPause={handlePlayPause}
            onReset={handleReset}
            onSeek={handleSeek}
            onShowLabelsChange={setShowLabels}
            onSpeedChange={setSpeed}
          />
        </div>
      ) : null}
    </section>
  );
}
