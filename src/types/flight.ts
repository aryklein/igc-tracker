export type FlightPoint = {
  timestamp: number;
  elapsedMs: number;
  latitude: number;
  longitude: number;
  altitude: number;
  gpsAltitude: number | null;
  pressureAltitude: number | null;
};

export type VarioPeak = {
  value: number;
  elapsedMs: number;
};

export type ParsedFlight = {
  filename: string;
  pilotName: string | null;
  gliderModel: string | null;
  points: FlightPoint[];
  startTime: number;
  endTime: number;
  durationMs: number;
  distanceMeters: number;
  minAltitude: number;
  maxAltitude: number;
  maxLift: VarioPeak | null;
  maxSink: VarioPeak | null;
};

export type ComparedFlight = {
  id: string;
  flight: ParsedFlight;
  sourceText: string | null;
  color: string;
};

export type FlightSyncMode = "launch" | "actual";
