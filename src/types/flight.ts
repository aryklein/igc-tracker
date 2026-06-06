export type FlightPoint = {
  timestamp: number;
  elapsedMs: number;
  latitude: number;
  longitude: number;
  altitude: number;
  gpsAltitude: number | null;
  pressureAltitude: number | null;
};

export type ParsedFlight = {
  filename: string;
  points: FlightPoint[];
  startTime: number;
  endTime: number;
  durationMs: number;
  distanceMeters: number;
  minAltitude: number;
  maxAltitude: number;
};
