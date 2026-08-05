"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComparedFlight, FlightPoint, FlightSyncMode, ParsedFlight } from "@/types/flight";
import { PlaybackControls } from "./PlaybackControls";

type CesiumModule = typeof import("cesium");
type Viewer = import("cesium").Viewer;
type Entity = import("cesium").Entity;
type Cartesian3 = import("cesium").Cartesian3;
type TerrainProvider = import("cesium").TerrainProvider;

type CesiumFlightViewerProps = {
  flights: ComparedFlight[];
  followedFlightId: string | null;
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
  beam: Entity;
  groundTarget: Entity;
  beamPositions: Cartesian3[];
  activeSegmentPositions: Cartesian3[];
  groundTargetPosition: Cartesian3 | undefined;
  visibleSegmentCount: number;
};

const VISUAL_TERRAIN_CLEARANCE_METERS = 8;
const VARIO_WINDOW_MS = 10_000;

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

function verticalSpeedAtElapsed(points: FlightPoint[], elapsedMs: number) {
  const windowStart = Math.max(0, elapsedMs - VARIO_WINDOW_MS);
  const from = findPointAtElapsed(points, windowStart).point;
  const to = findPointAtElapsed(points, elapsedMs).point;
  const elapsedSeconds = Math.max(1, (to.elapsedMs - from.elapsedMs) / 1000);

  return (to.altitude - from.altitude) / elapsedSeconds;
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

export function CesiumFlightViewer({ flights, followedFlightId, syncMode = "launch" }: CesiumFlightViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [currentMs, setCurrentMs] = useState(0);
  const [currentPoint, setCurrentPoint] = useState<FlightPoint | null>(null);
  const [currentAgl, setCurrentAgl] = useState<number | null>(null);
  const [verticalSpeed, setVerticalSpeed] = useState(0);

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
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, range));
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

        if (!result) {
          renderData.marker.show = false;
          renderData.beam.show = false;
          renderData.groundTarget.show = false;
          renderData.activeSegment.show = false;
          renderData.beamPositions.length = 0;
          renderData.activeSegmentPositions.length = 0;
          renderData.groundTargetPosition = undefined;

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
        renderData.beam.show = true;
        renderData.groundTarget.show = isFollowed;
        renderData.activeSegment.show = true;

        if (renderData.beam.polyline) {
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
        renderData.beamPositions.splice(0, renderData.beamPositions.length, groundPosition, result.position);
        renderData.groundTargetPosition = groundPosition;
        renderData.activeSegmentPositions.splice(
          0,
          renderData.activeSegmentPositions.length,
          renderData.positions[Math.max(0, result.current.index - 1)],
          result.position,
        );

        if (isFollowed) {
          updateCamera(result.position);
          setCurrentPoint(result.current.point);
          setCurrentAgl(Math.max(0, result.current.point.altitude - groundHeight));
          setVerticalSpeed(verticalSpeedAtElapsed(renderData.flight.flight.points, result.flightElapsed));
        }
      }
    },
    [flights, getCurrentFlightPosition, updateCamera],
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
                  : new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(comparedFlight.color).withAlpha(0.72)),
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
      const activeSegmentPositions: Cartesian3[] = [];
      const activeSegment = viewer.entities.add({
        name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} active flight track segment`,
        show: false,
        polyline: {
          clampToGround: false,
          material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(comparedFlight.color)),
          positions: new Cesium.CallbackProperty(() => activeSegmentPositions, false),
          width: 3,
        },
      });
      const beamPositions: Cartesian3[] = [];
      const beam = viewer.entities.add({
        name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} altitude projection beam`,
        polyline: {
          clampToGround: false,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString(comparedFlight.color).withAlpha(0.34),
            glowPower: 0.22,
            taperPower: 0.7,
          }),
          positions: new Cesium.CallbackProperty(() => beamPositions, false),
          width: 2,
        },
      });
      let groundTargetPosition: Cartesian3 | undefined;
      const groundTarget = viewer.entities.add({
        name: `${comparedFlight.flight.pilotName ?? comparedFlight.flight.filename} ground projection target`,
        show: false,
        position: new Cesium.CallbackPositionProperty(() => groundTargetPosition, false),
        ellipse: {
          semiMajorAxis: 38,
          semiMinorAxis: 38,
          material: Cesium.Color.fromCssColorString(comparedFlight.color).withAlpha(0.16),
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.7),
          outlineWidth: 2,
        },
      });

      return {
        flight: comparedFlight,
        ...prepared,
        segmentEntities,
        activeSegment,
        activeSegmentPositions,
        marker,
        beam,
        groundTarget,
        beamPositions,
        get groundTargetPosition() {
          return groundTargetPosition;
        },
        set groundTargetPosition(position: Cartesian3 | undefined) {
          groundTargetPosition = position;
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
              : new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(renderData.flight.color).withAlpha(0.72));
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
          viewerInstance.entities.remove(renderData.activeSegment);
          viewerInstance.entities.remove(renderData.beam);
          viewerInstance.entities.remove(renderData.groundTarget);
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
      orbitRef.current.heading -= deltaX * 0.006;
      orbitRef.current.pitch = Math.max(-1.45, Math.min(-0.15, orbitRef.current.pitch + deltaY * 0.004));
      updateCameraFromFollowedFlight();
    }

    function handlePointerUp(event: PointerEvent) {
      activePointers.delete(event.pointerId);
      previousPinchDistance = getPinchDistance();

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
    canvasElement.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvasElement.removeEventListener("pointerdown", handlePointerDown);
      canvasElement.removeEventListener("pointermove", handlePointerMove);
      canvasElement.removeEventListener("pointerup", handlePointerUp);
      canvasElement.removeEventListener("pointercancel", handlePointerUp);
      canvasElement.removeEventListener("wheel", handleWheel);
    };
  }, [flights, getCurrentFlightPosition, isReady, updateCamera]);

  useEffect(() => {
    function tick(now: number) {
      try {
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
  }, [followedFlight, timelineDuration, updateFlightEntities]);

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
    <section className="viewer-shell">
      <div ref={containerRef} className="cesium-container" />
      {flights.length === 0 ? (
        <div className="viewer-empty">
          <p>Upload an IGC file to start a 3D replay.</p>
          <span>Drag to orbit the paraglider. Scroll to zoom.</span>
        </div>
      ) : null}
      {loadError ? <div className="viewer-error">{loadError}</div> : null}
      {followedFlight ? (
        <div className="hud">
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
            speed={speed}
            onPlayPause={handlePlayPause}
            onReset={handleReset}
            onSeek={handleSeek}
            onSpeedChange={setSpeed}
          />
        </div>
      ) : null}
    </section>
  );
}
