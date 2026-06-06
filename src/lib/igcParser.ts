import { distanceMeters } from "@/lib/flightMath";
import type { FlightPoint, ParsedFlight } from "@/types/flight";

function parseIgcDate(content: string) {
  const dateLine = content
    .split(/\r?\n/)
    .find((line) => line.startsWith("HFDTE") || line.startsWith("HFDTEDATE:"));

  if (!dateLine) {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  const match = dateLine.match(/HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);

  if (!match) {
    throw new Error("Could not read the IGC flight date.");
  }

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const fullYear = year >= 80 ? 1900 + year : 2000 + year;

  return Date.UTC(fullYear, month, day);
}

function parseCoordinate(raw: string, hemisphere: string, degreeLength: 2 | 3) {
  const degrees = Number(raw.slice(0, degreeLength));
  const minutes = Number(raw.slice(degreeLength)) / 1000;
  const value = degrees + minutes / 60;

  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

function parseAltitude(raw: string) {
  if (!/^[-\d]\d{4}$/.test(raw)) {
    return null;
  }

  return Number(raw);
}

function parseFix(line: string, baseDate: number): FlightPoint | null {
  if (!/^B\d{6}\d{7}[NS]\d{8}[EW][AV]/.test(line)) {
    return null;
  }

  const hours = Number(line.slice(1, 3));
  const minutes = Number(line.slice(3, 5));
  const seconds = Number(line.slice(5, 7));
  const latitude = parseCoordinate(line.slice(7, 14), line[14], 2);
  const longitude = parseCoordinate(line.slice(15, 23), line[23], 3);
  const pressureAltitude = parseAltitude(line.slice(25, 30));
  const gpsAltitude = parseAltitude(line.slice(30, 35));
  const altitude = gpsAltitude ?? pressureAltitude;

  if (altitude === null || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }

  const timestamp = baseDate + ((hours * 60 + minutes) * 60 + seconds) * 1000;

  return {
    timestamp,
    elapsedMs: 0,
    latitude,
    longitude,
    altitude,
    gpsAltitude,
    pressureAltitude,
  };
}

export function parseIgcFile(content: string, filename: string): ParsedFlight {
  const baseDate = parseIgcDate(content);
  const points: FlightPoint[] = [];
  let dayOffset = 0;
  let previousTimestamp = 0;

  for (const line of content.split(/\r?\n/)) {
    const fix = parseFix(line.trim(), baseDate);

    if (!fix) {
      continue;
    }

    if (previousTimestamp && fix.timestamp + dayOffset < previousTimestamp) {
      dayOffset += 24 * 60 * 60 * 1000;
    }

    fix.timestamp += dayOffset;

    previousTimestamp = fix.timestamp;
    points.push(fix);
  }

  if (points.length < 2) {
    throw new Error("This IGC file does not contain enough valid GPS fixes.");
  }

  const startTime = points[0].timestamp;
  let distance = 0;
  let minAltitude = Number.POSITIVE_INFINITY;
  let maxAltitude = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    points[index].elapsedMs = points[index].timestamp - startTime;
    minAltitude = Math.min(minAltitude, points[index].altitude);
    maxAltitude = Math.max(maxAltitude, points[index].altitude);

    if (index > 0) {
      distance += distanceMeters(points[index - 1], points[index]);
    }
  }

  const endTime = points.at(-1)?.timestamp ?? startTime;

  return {
    filename,
    points,
    startTime,
    endTime,
    durationMs: endTime - startTime,
    distanceMeters: distance,
    minAltitude,
    maxAltitude,
  };
}
