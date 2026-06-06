"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistance, formatDuration } from "@/lib/flightMath";
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

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
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

export function CesiumFlightViewer({ flight }: CesiumFlightViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const markerRef = useRef<Entity | null>(null);
  const shadowLineRef = useRef<Entity | null>(null);
  const activeSegmentRef = useRef<Entity | null>(null);
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
  const orbitRef = useRef({ heading: 0, pitch: -0.75, range: 4500 });

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentMs, setCurrentMs] = useState(0);
  const [currentPoint, setCurrentPoint] = useState<FlightPoint | null>(null);

  const altitudeColor = useCallback((Cesium: CesiumModule, altitude: number, flightData: ParsedFlight) => {
    const range = Math.max(1, flightData.maxAltitude - flightData.minAltitude);
    const t = Math.max(0, Math.min(1, (altitude - flightData.minAltitude) / range));

    if (t < 0.5) {
      return new Cesium.Color(t * 2, 0.92, 0.18, 1);
    }

    return new Cesium.Color(1, 0.92 - (t - 0.5) * 1.7, 0.18 - (t - 0.5) * 0.24, 1);
  }, []);

  const updateCamera = useCallback((point: FlightPoint) => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;

    if (!Cesium || !viewer) {
      return;
    }

    const target = Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude);
    const { heading, pitch, range } = orbitRef.current;
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, range));
  }, []);

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
        current.point.altitude,
      );
      const groundCartographic = Cesium.Cartographic.fromDegrees(current.point.longitude, current.point.latitude);
      const groundHeight = viewer.scene.globe.getHeight(groundCartographic) ?? 0;
      const groundCartesian = Cesium.Cartesian3.fromDegrees(
        current.point.longitude,
        current.point.latitude,
        groundHeight,
      );
      const previous = flightData.points[Math.max(0, current.index - 1)];

      currentPositionRef.current = currentCartesian;
      activeSegmentPositionsRef.current = [
        Cesium.Cartesian3.fromDegrees(previous.longitude, previous.latitude, previous.altitude),
        currentCartesian,
      ];
      activeSegmentColorRef.current = altitudeColor(Cesium, current.point.altitude, flightData);
      shadowPositionsRef.current = [groundCartesian, currentCartesian];
      updateCamera(current.point);
    },
    [altitudeColor, updateCamera],
  );

  useEffect(() => {
    let cancelled = false;

    async function setupCesium() {
      if (!containerRef.current) {
        return;
      }

      try {
        window.CESIUM_BASE_URL = "/cesium/";
        const Cesium = await import("cesium");

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
    activeSegmentPositionsRef.current = [];
    shadowPositionsRef.current = [];
    setCurrentMs(0);
    setIsPlaying(false);

    viewer.entities.removeAll();
    const firstPoint = flight.points[0];
    const firstPosition = Cesium.Cartesian3.fromDegrees(
      firstPoint.longitude,
      firstPoint.latitude,
      firstPoint.altitude,
    );
    const firstGroundCartographic = Cesium.Cartographic.fromDegrees(firstPoint.longitude, firstPoint.latitude);
    const firstGroundHeight = viewer.scene.globe.getHeight(firstGroundCartographic) ?? 0;

    currentPositionRef.current = firstPosition;
    activeSegmentPositionsRef.current = [firstPosition, firstPosition];
    activeSegmentColorRef.current = altitudeColor(Cesium, firstPoint.altitude, flight);
    shadowPositionsRef.current = [
      Cesium.Cartesian3.fromDegrees(firstPoint.longitude, firstPoint.latitude, firstGroundHeight),
      firstPosition,
    ];
    setCurrentPoint(firstPoint);

    for (let index = 1; index < flight.points.length; index += 1) {
      const previous = flight.points[index - 1];
      const point = flight.points[index];
      const averageAltitude = (previous.altitude + point.altitude) / 2;
      const segmentPositions = [
        Cesium.Cartesian3.fromDegrees(previous.longitude, previous.latitude, previous.altitude),
        Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude),
      ];

      viewer.entities.add({
        name: "Altitude colored flight track segment",
        polyline: {
          clampToGround: false,
          material: altitudeColor(Cesium, averageAltitude, flight),
          positions: new Cesium.CallbackProperty(
            () => (elapsedRef.current >= point.elapsedMs ? segmentPositions : []),
            false,
          ),
          width: 4,
        },
      });
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
        color: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        pixelSize: 14,
      },
    });

    updateCamera(firstPoint);
  }, [altitudeColor, flight, isReady, updateCamera]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const canvas = viewer?.canvas;

    if (!isReady || !canvas) {
      return;
    }

    let isDragging = false;
    let previousX = 0;
    let previousY = 0;

    function handlePointerDown(event: PointerEvent) {
      isDragging = true;
      previousX = event.clientX;
      previousY = event.clientY;
      canvas?.setPointerCapture(event.pointerId);
    }

    function handlePointerMove(event: PointerEvent) {
      if (!isDragging || !flightRef.current) {
        return;
      }

      const deltaX = event.clientX - previousX;
      const deltaY = event.clientY - previousY;
      previousX = event.clientX;
      previousY = event.clientY;

      orbitRef.current.heading -= deltaX * 0.006;
      orbitRef.current.pitch = Math.max(-1.45, Math.min(-0.15, orbitRef.current.pitch + deltaY * 0.004));

      const current = findPointAtElapsed(flightRef.current.points, elapsedRef.current).point;
      updateCamera(current);
    }

    function handlePointerUp(event: PointerEvent) {
      isDragging = false;
      canvas?.releasePointerCapture(event.pointerId);
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
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [isReady, updateCamera]);

  useEffect(() => {
    function tick(now: number) {
      const flightData = flightRef.current;

      if (flightData && isPlayingRef.current) {
        const previousFrame = lastFrameRef.current ?? now;
        const delta = now - previousFrame;
        elapsedRef.current = Math.min(flightData.durationMs, elapsedRef.current + delta * speedRef.current);

        const current = findPointAtElapsed(flightData.points, elapsedRef.current);
        updateTrack(current);
        setCurrentMs(elapsedRef.current);
        setCurrentPoint(current.point);

        if (elapsedRef.current >= flightData.durationMs) {
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
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

    setIsPlaying((playing) => !playing);
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
    setIsPlaying(false);
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
            <span>{flight.filename}</span>
            <strong>{currentPoint ? `${Math.round(currentPoint.altitude)} m` : "-- m"}</strong>
            <small>
              {formatDuration(flight.durationMs)} · {formatDistance(flight.distanceMeters)} · {Math.round(flight.minAltitude)}-
              {Math.round(flight.maxAltitude)} m
            </small>
          </div>
          <PlaybackControls
            currentMs={currentMs}
            durationMs={flight.durationMs}
            isPlaying={isPlaying}
            speed={speed}
            onPlayPause={handlePlayPause}
            onReset={handleReset}
            onSpeedChange={setSpeed}
          />
        </div>
      ) : null}
    </section>
  );
}
