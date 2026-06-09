"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FlightPoint, ParsedFlight } from "@/types/flight";
import { PlaybackControls } from "./PlaybackControls";

type CesiumModule = typeof import("cesium");
type Viewer = import("cesium").Viewer;
type Entity = import("cesium").Entity;
type Cartesian3 = import("cesium").Cartesian3;
type Color = import("cesium").Color;

type CesiumFlightViewerProps = {
  flight: ParsedFlight | null;
};

type InterpolatedPoint = {
  point: FlightPoint;
  index: number;
};

const VISUAL_TERRAIN_CLEARANCE_METERS = 8;
const VARIO_WINDOW_MS = 10_000;
const LANDING_SEGMENT_REFRESH_WINDOW_MS = 120_000;
const LANDING_SEGMENT_REFRESH_BATCH_SIZE = 8;

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

export function CesiumFlightViewer({ flight }: CesiumFlightViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const markerRef = useRef<Entity | null>(null);
  const shadowLineRef = useRef<Entity | null>(null);
  const activeSegmentRef = useRef<Entity | null>(null);
  const segmentEntitiesRef = useRef<Entity[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const currentPositionRef = useRef<Cartesian3 | undefined>(undefined);
  const activeSegmentPositionsRef = useRef<Cartesian3[]>([]);
  const activeSegmentColorRef = useRef<Color | undefined>(undefined);
  const shadowPositionsRef = useRef<Cartesian3[]>([]);
  const flightRef = useRef<ParsedFlight | null>(null);
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(1);
  const visibleSegmentCountRef = useRef(0);
  const landingSegmentRefreshIndexRef = useRef<number | null>(null);
  const orbitRef = useRef({ heading: 0, pitch: -0.75, range: 4500 });

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentMs, setCurrentMs] = useState(0);
  const [currentPoint, setCurrentPoint] = useState<FlightPoint | null>(null);
  const [currentAgl, setCurrentAgl] = useState<number | null>(null);
  const [verticalSpeed, setVerticalSpeed] = useState(0);

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

  const getRenderAltitude = useCallback((point: FlightPoint) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    if (!Cesium || !viewer) {
      return point.altitude;
    }

    const cartographic = Cesium.Cartographic.fromDegrees(point.longitude, point.latitude);
    const groundHeight = viewer.scene.globe.getHeight(cartographic);

    if (groundHeight === undefined) {
      return point.altitude;
    }

    const agl = Math.max(0, point.altitude - groundHeight);
    const visualClearance = Math.min(VISUAL_TERRAIN_CLEARANCE_METERS, agl);

    return groundHeight + agl + visualClearance;
  }, []);

  const updateVisibleSegments = useCallback(
    (completedSegmentCount: number) => {
      const nextVisibleCount = Math.max(0, Math.min(completedSegmentCount, segmentEntitiesRef.current.length));
      const previousVisibleCount = visibleSegmentCountRef.current;

      if (nextVisibleCount < previousVisibleCount) {
        for (let index = nextVisibleCount; index < previousVisibleCount; index += 1) {
          segmentEntitiesRef.current[index].show = false;
        }
      }

      for (let index = previousVisibleCount; index < nextVisibleCount; index += 1) {
        const entity = segmentEntitiesRef.current[index];

        entity.show = true;
      }

      visibleSegmentCountRef.current = nextVisibleCount;
    },
    [],
  );

  const updateCamera = useCallback((point: FlightPoint) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    if (!Cesium || !viewer) {
      return;
    }

    const target = Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, getRenderAltitude(point));
    const { heading, pitch, range } = orbitRef.current;
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, range));
  }, [getRenderAltitude]);

  const refreshLandingSegments = useCallback(() => {
    const Cesium = cesiumRef.current;
    const flightData = flightRef.current;

    if (!Cesium || !flightData) {
      return;
    }

    if (landingSegmentRefreshIndexRef.current === null) {
      const refreshStart = Math.max(0, flightData.durationMs - LANDING_SEGMENT_REFRESH_WINDOW_MS);
      landingSegmentRefreshIndexRef.current = Math.max(
        0,
        flightData.points.findIndex((point) => point.elapsedMs >= refreshStart) - 1,
      );
    }

    const endIndex = segmentEntitiesRef.current.length;
    const batchEnd = Math.min(endIndex, landingSegmentRefreshIndexRef.current + LANDING_SEGMENT_REFRESH_BATCH_SIZE);

    for (let index = landingSegmentRefreshIndexRef.current; index < batchEnd; index += 1) {
      const entity = segmentEntitiesRef.current[index];
      const previous = flightData.points[index];
      const point = flightData.points[index + 1];

      if (!entity?.polyline || !previous || !point) {
        continue;
      }

      entity.polyline.positions = new Cesium.ConstantProperty([
        Cesium.Cartesian3.fromDegrees(previous.longitude, previous.latitude, getRenderAltitude(previous)),
        Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, getRenderAltitude(point)),
      ]);
    }

    landingSegmentRefreshIndexRef.current = batchEnd >= endIndex ? endIndex : batchEnd;
  }, [getRenderAltitude]);

  const updateTrack = useCallback(
    (current: InterpolatedPoint) => {
      const Cesium = cesiumRef.current;
      const viewer = viewerRef.current;
      const flightData = flightRef.current;

      if (!Cesium || !viewer || !flightData) {
        return;
      }

      const currentCartesian = Cesium.Cartesian3.fromDegrees(
        current.point.longitude,
        current.point.latitude,
        getRenderAltitude(current.point),
      );
      const groundCartographic = Cesium.Cartographic.fromDegrees(current.point.longitude, current.point.latitude);
      const groundHeight = viewer.scene.globe.getHeight(groundCartographic);
      const groundAltitude = groundHeight ?? 0;
      const groundCartesian = Cesium.Cartesian3.fromDegrees(
        current.point.longitude,
        current.point.latitude,
        groundAltitude,
      );
      const previous = flightData.points[Math.max(0, current.index - 1)];
      const completedSegmentCount =
        current.point.elapsedMs >= flightData.durationMs ? flightData.points.length - 1 : Math.max(0, current.index - 1);
      const activeSegmentPositions = [
        Cesium.Cartesian3.fromDegrees(previous.longitude, previous.latitude, getRenderAltitude(previous)),
        currentCartesian,
      ];

      currentPositionRef.current = currentCartesian;
      activeSegmentPositionsRef.current = activeSegmentPositions;
      activeSegmentColorRef.current = altitudeColor(Cesium, current.point.altitude, flightData);
      shadowPositionsRef.current = [groundCartesian, currentCartesian];
      setCurrentAgl(groundHeight === undefined ? null : Math.max(0, current.point.altitude - groundHeight));
      updateVisibleSegments(completedSegmentCount);

      if (current.point.elapsedMs >= flightData.durationMs - LANDING_SEGMENT_REFRESH_WINDOW_MS) {
        refreshLandingSegments();
      }

      if (current.point.elapsedMs >= flightData.durationMs) {
        const finalSegment = segmentEntitiesRef.current.at(-1);

        if (finalSegment?.polyline) {
          finalSegment.polyline.positions = new Cesium.ConstantProperty(activeSegmentPositions);
        }
      }

      updateCamera(current.point);
    },
    [altitudeColor, getRenderAltitude, refreshLandingSegments, updateCamera, updateVisibleSegments],
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
              Cesium.createWorldImageryAsync({
                style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
              }),
            )
          : new Cesium.ImageryLayer(
              new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }),
            );

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
          terrain: token ? Cesium.Terrain.fromWorldTerrain() : undefined,
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
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    if (!isReady || !Cesium || !viewer || !flight) {
      return;
    }

    flightRef.current = flight;
    elapsedRef.current = 0;
    lastFrameRef.current = null;
    visibleSegmentCountRef.current = 0;
    landingSegmentRefreshIndexRef.current = null;
    segmentEntitiesRef.current = [];
    activeSegmentPositionsRef.current = [];
    shadowPositionsRef.current = [];
    setCurrentMs(0);
    setCurrentAgl(null);
    setVerticalSpeed(0);
    speedRef.current = 8;
    isPlayingRef.current = true;
    setSpeed(8);
    setIsPlaying(true);

    viewer.entities.removeAll();
    const firstPoint = flight.points[0];
    const firstPosition = Cesium.Cartesian3.fromDegrees(
      firstPoint.longitude,
      firstPoint.latitude,
      getRenderAltitude(firstPoint),
    );
    const firstGroundCartographic = Cesium.Cartographic.fromDegrees(firstPoint.longitude, firstPoint.latitude);
    const firstGroundHeight = viewer.scene.globe.getHeight(firstGroundCartographic);
    const firstGroundAltitude = firstGroundHeight ?? 0;

    currentPositionRef.current = firstPosition;
    activeSegmentPositionsRef.current = [firstPosition, firstPosition];
    activeSegmentColorRef.current = altitudeColor(Cesium, firstPoint.altitude, flight);
    shadowPositionsRef.current = [
      Cesium.Cartesian3.fromDegrees(firstPoint.longitude, firstPoint.latitude, firstGroundAltitude),
      firstPosition,
    ];
    setCurrentPoint(firstPoint);
    setCurrentAgl(firstGroundHeight === undefined ? null : Math.max(0, firstPoint.altitude - firstGroundHeight));

    for (let index = 1; index < flight.points.length; index += 1) {
      const previous = flight.points[index - 1];
      const point = flight.points[index];
      const averageAltitude = (previous.altitude + point.altitude) / 2;
      const segmentPositions = [
        Cesium.Cartesian3.fromDegrees(previous.longitude, previous.latitude, getRenderAltitude(previous)),
        Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, getRenderAltitude(point)),
      ];

      const segmentEntity = viewer.entities.add({
        name: "Altitude colored flight track segment",
        show: false,
        polyline: {
          clampToGround: false,
          material: altitudeColor(Cesium, averageAltitude, flight),
          positions: segmentPositions,
          width: 4,
        },
      });

      segmentEntitiesRef.current.push(segmentEntity);
    }

    activeSegmentRef.current = viewer.entities.add({
      name: "Active altitude colored flight track segment",
      polyline: {
        clampToGround: false,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => activeSegmentColorRef.current, false),
        ),
        positions: new Cesium.CallbackProperty(() => activeSegmentPositionsRef.current, false),
        width: 4,
      },
    });

    shadowLineRef.current = viewer.entities.add({
      name: "Paraglider vertical shadow line",
      polyline: {
        clampToGround: false,
        material: Cesium.Color.WHITE.withAlpha(0.62),
        positions: new Cesium.CallbackProperty(() => shadowPositionsRef.current, false),
        width: 2,
      },
    });

    markerRef.current = viewer.entities.add({
      name: "Paraglider",
      position: new Cesium.CallbackPositionProperty(() => currentPositionRef.current, false),
      point: {
        color: Cesium.Color.fromCssColorString("#00d9ff"),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        pixelSize: 10,
      },
    });

    updateCamera(firstPoint);
  }, [altitudeColor, flight, getRenderAltitude, isReady, updateCamera]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const canvas = viewer?.canvas;

    if (!isReady || !canvas) {
      return;
    }

    const activePointers = new Map<number, { x: number; y: number }>();
    let previousX = 0;
    let previousY = 0;
    let previousPinchDistance: number | null = null;

    canvas.style.touchAction = "none";

    function updateCameraFromCurrentPoint() {
      if (!flightRef.current) {
        return;
      }

      const current = findPointAtElapsed(flightRef.current.points, elapsedRef.current).point;
      updateCamera(current);
    }

    function getPinchDistance() {
      const pointers = [...activePointers.values()];

      if (pointers.length < 2) {
        return null;
      }

      const deltaX = pointers[0].x - pointers[1].x;
      const deltaY = pointers[0].y - pointers[1].y;

      return Math.hypot(deltaX, deltaY);
    }

    function handlePointerDown(event: PointerEvent) {
      event.preventDefault();
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      previousX = event.clientX;
      previousY = event.clientY;
      canvas?.setPointerCapture(event.pointerId);
      previousPinchDistance = getPinchDistance();
    }

    function handlePointerMove(event: PointerEvent) {
      if (!activePointers.has(event.pointerId) || !flightRef.current) {
        return;
      }

      event.preventDefault();
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (activePointers.size >= 2) {
        const pinchDistance = getPinchDistance();

        if (pinchDistance !== null && previousPinchDistance !== null && pinchDistance > 0) {
          const zoomFactor = Math.max(0.75, Math.min(1.25, previousPinchDistance / pinchDistance));
          orbitRef.current.range = Math.max(300, Math.min(35_000, orbitRef.current.range * zoomFactor));
          updateCameraFromCurrentPoint();
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
      updateCameraFromCurrentPoint();
    }

    function handlePointerUp(event: PointerEvent) {
      activePointers.delete(event.pointerId);
      previousPinchDistance = getPinchDistance();

      if (activePointers.size === 1) {
        const [remainingPointer] = activePointers.values();
        previousX = remainingPointer.x;
        previousY = remainingPointer.y;
      }

      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }

    function handleWheel(event: WheelEvent) {
      if (!flightRef.current) {
        return;
      }

      event.preventDefault();
      const zoomFactor = event.deltaY > 0 ? 1.12 : 0.88;
      orbitRef.current.range = Math.max(300, Math.min(35_000, orbitRef.current.range * zoomFactor));
      const current = findPointAtElapsed(flightRef.current.points, elapsedRef.current).point;
      updateCamera(current);
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.style.touchAction = "";
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [isReady, updateCamera]);

  useEffect(() => {
    function tick(now: number) {
      try {
        const flightData = flightRef.current;

        if (flightData && isPlayingRef.current) {
          const previousFrame = lastFrameRef.current ?? now;
          const delta = now - previousFrame;
          elapsedRef.current = Math.min(flightData.durationMs, elapsedRef.current + delta * speedRef.current);

          const current = findPointAtElapsed(flightData.points, elapsedRef.current);
          updateTrack(current);
          setCurrentMs(elapsedRef.current);
          setCurrentPoint(current.point);
          setVerticalSpeed(verticalSpeedAtElapsed(flightData.points, elapsedRef.current));

          if (elapsedRef.current >= flightData.durationMs) {
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
  }, [updateTrack]);

  function handlePlayPause() {
    if (!flightRef.current) {
      return;
    }

    if (elapsedRef.current >= flightRef.current.durationMs) {
      handleReset();
    }

    const nextPlaying = !isPlayingRef.current;
    isPlayingRef.current = nextPlaying;
    lastFrameRef.current = null;
    setIsPlaying(nextPlaying);
  }

  function handleReset() {
    const flightData = flightRef.current;

    if (!flightData) {
      return;
    }

    elapsedRef.current = 0;
    lastFrameRef.current = null;
    const first = { point: flightData.points[0], index: 0 };
    updateTrack(first);
    setCurrentMs(0);
    setCurrentPoint(first.point);
    setVerticalSpeed(0);
    isPlayingRef.current = false;
    setIsPlaying(false);
  }

  function handleSeek(elapsedMs: number) {
    const flightData = flightRef.current;

    if (!flightData) {
      return;
    }

    elapsedRef.current = Math.max(0, Math.min(flightData.durationMs, elapsedMs));
    lastFrameRef.current = null;
    const current = findPointAtElapsed(flightData.points, elapsedRef.current);
    updateTrack(current);
    setCurrentMs(elapsedRef.current);
    setCurrentPoint(current.point);
    setVerticalSpeed(verticalSpeedAtElapsed(flightData.points, elapsedRef.current));

    if (elapsedRef.current >= flightData.durationMs) {
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  }

  return (
    <section className="viewer-shell">
      <div ref={containerRef} className="cesium-container" />
      {!flight ? (
        <div className="viewer-empty">
          <p>Upload an IGC file to start a 3D replay.</p>
          <span>Drag to orbit the paraglider. Scroll to zoom.</span>
        </div>
      ) : null}
      {loadError ? <div className="viewer-error">{loadError}</div> : null}
      {flight ? (
        <div className="hud">
          <div className="flight-card">
            <div className="flight-live-stats">
              <div className="altitude-stack">
                <strong
                  className="altitude-value"
                  style={currentPoint ? { color: altitudeCssColor(currentPoint.altitude, flight) } : undefined}
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
            durationMs={flight.durationMs}
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
