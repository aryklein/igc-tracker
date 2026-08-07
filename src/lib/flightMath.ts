import type { FlightPoint, VarioPeak } from "@/types/flight";

const EARTH_RADIUS_METERS = 6_371_000;
export const VARIO_WINDOW_MS = 10_000;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceMeters(a: FlightPoint, b: FlightPoint) {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}

export function formatProgressTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minutesAndSeconds = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  return hours > 0 ? `${hours.toString().padStart(2, "0")}:${minutesAndSeconds}` : minutesAndSeconds;
}

function altitudeAtElapsed(points: FlightPoint[], elapsedMs: number) {
  if (elapsedMs <= 0) {
    return points[0].altitude;
  }

  const last = points.at(-1)!;
  if (elapsedMs >= last.elapsedMs) {
    return last.altitude;
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
  const duration = Math.max(1, next.elapsedMs - previous.elapsedMs);
  const t = (elapsedMs - previous.elapsedMs) / duration;

  return previous.altitude + (next.altitude - previous.altitude) * t;
}

export function verticalSpeedAtElapsed(points: FlightPoint[], elapsedMs: number, windowMs = VARIO_WINDOW_MS) {
  const windowStart = Math.max(0, elapsedMs - windowMs);
  const elapsedSeconds = Math.max(1, (elapsedMs - windowStart) / 1000);

  return (altitudeAtElapsed(points, elapsedMs) - altitudeAtElapsed(points, windowStart)) / elapsedSeconds;
}

export function varioPeaks(points: FlightPoint[], durationMs: number) {
  const candidates = new Set<number>([0, durationMs]);

  for (const point of points) {
    candidates.add(point.elapsedMs);

    if (point.elapsedMs + VARIO_WINDOW_MS <= durationMs) {
      candidates.add(point.elapsedMs + VARIO_WINDOW_MS);
    }
  }

  let maxLift: VarioPeak | null = null;
  let maxSink: VarioPeak | null = null;

  for (const elapsedMs of candidates) {
    const value = verticalSpeedAtElapsed(points, elapsedMs);

    if (value > 0 && (!maxLift || value > maxLift.value)) {
      maxLift = { value, elapsedMs };
    }

    if (value < 0 && (!maxSink || value < maxSink.value)) {
      maxSink = { value, elapsedMs };
    }
  }

  return { maxLift, maxSink };
}

export function formatDistance(meters: number) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}
