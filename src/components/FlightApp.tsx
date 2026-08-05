"use client";

import { useState } from "react";
import { CesiumFlightViewer } from "./CesiumFlightViewer";
import { FileUpload } from "./FileUpload";
import type { ComparedFlight, FlightSyncMode, ParsedFlight } from "@/types/flight";

const COMPARISON_COLORS = ["#00d9ff", "#ff6b4a", "#a6e22e", "#b88cff", "#ffd166"];

type FlightAppProps = {
  initialFlight?: ParsedFlight | null;
  initialSourceText?: string | null;
  allowSharing?: boolean;
};

export function FlightApp({ initialFlight = null, initialSourceText = null, allowSharing = true }: FlightAppProps) {
  const [flights, setFlights] = useState<ComparedFlight[]>(() =>
    initialFlight
      ? [{ id: "initial-flight", flight: initialFlight, sourceText: initialSourceText, color: COMPARISON_COLORS[0] }]
      : [],
  );
  const [primaryFlightId, setPrimaryFlightId] = useState<string | null>(initialFlight ? "initial-flight" : null);
  const [syncMode, setSyncMode] = useState<FlightSyncMode>("launch");
  const primaryFlight = flights.find((entry) => entry.id === primaryFlightId) ?? flights[0] ?? null;

  function handleFlightsLoaded(nextFlights: Array<{ flight: ParsedFlight; sourceText: string }>) {
    const additions = nextFlights.map((entry, index) => ({
      id: crypto.randomUUID(),
      ...entry,
      color: COMPARISON_COLORS[(flights.length + index) % COMPARISON_COLORS.length],
    }));

    setFlights((currentFlights) => [...currentFlights, ...additions]);

    if (!primaryFlightId && additions[0]) {
      setPrimaryFlightId(additions[0].id);
    }
  }

  function handleFlightRemoved(id: string) {
    if (id === primaryFlightId) {
      setPrimaryFlightId(flights.find((entry) => entry.id !== id)?.id ?? null);
    }

    setFlights((currentFlights) => currentFlights.filter((entry) => entry.id !== id));
  }

  return (
    <main className="app-shell">
      <aside className="intro-panel">
        <div>
          <p className="eyebrow">IGC Tracker MVP</p>
          <h1>Replay your paraglider flight in 3D.</h1>
          <p className="intro-copy">A personal project by Ary Kleinerman.</p>
        </div>
        <FileUpload
          allowSharing={allowSharing}
          flights={flights}
          primaryFlightId={primaryFlight?.id ?? null}
          onFlightRemoved={handleFlightRemoved}
          onFlightsLoaded={handleFlightsLoaded}
          onPrimaryFlightChange={setPrimaryFlightId}
          onSyncModeChange={setSyncMode}
          syncMode={syncMode}
        />
      </aside>
      <CesiumFlightViewer
        comparisonFlights={flights.filter((entry) => entry.id !== primaryFlight?.id)}
        flight={primaryFlight?.flight ?? null}
        primaryColor={primaryFlight?.color}
        syncMode={syncMode}
      />
    </main>
  );
}
