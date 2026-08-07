"use client";

import { useState } from "react";
import { AppLogo } from "./AppLogo";
import { CesiumFlightViewer } from "./CesiumFlightViewer";
import { FileUpload } from "./FileUpload";
import type { ComparedFlight, FlightSyncMode, ParsedFlight } from "@/types/flight";

const COMPARISON_COLORS = [
  "#00d9ff",
  "#ff6b4a",
  "#a6e22e",
  "#b88cff",
  "#ffd166",
  "#ff4fa3",
  "#2dd4bf",
  "#f97316",
  "#4d7cff",
  "#ef4444",
];

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
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [syncMode, setSyncMode] = useState<FlightSyncMode>("launch");
  const primaryFlight = flights.find((entry) => entry.id === primaryFlightId) ?? flights[0] ?? null;

  function handleFlightsLoaded(nextFlights: Array<{ flight: ParsedFlight; sourceText: string }>) {
    const availableColors = COMPARISON_COLORS.filter((color) => !flights.some((flight) => flight.color === color));
    const additions = nextFlights.map((entry, index) => ({
      id: crypto.randomUUID(),
      ...entry,
      color: availableColors[index],
    }));

    setFlights((currentFlights) => [...currentFlights, ...additions]);

    if (!primaryFlightId && additions.length > 0) {
      const firstFlight = additions.reduce((earliest, entry) =>
        entry.flight.startTime < earliest.flight.startTime ? entry : earliest,
      );

      setPrimaryFlightId(firstFlight.id);
    }
  }

  function handleFlightRemoved(id: string) {
    if (id === primaryFlightId) {
      setPrimaryFlightId(flights.find((entry) => entry.id !== id)?.id ?? null);
    }

    setFlights((currentFlights) => currentFlights.filter((entry) => entry.id !== id));
  }

  function handlePanelCollapsed() {
    setIsPanelCollapsed(true);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  return (
    <main className={isPanelCollapsed ? "app-shell panel-collapsed" : "app-shell"}>
      {isPanelCollapsed ? (
        <button className="panel-restore" type="button" onClick={() => setIsPanelCollapsed(false)}>
          Show panel
        </button>
      ) : null}
      <aside className="intro-panel">
        <button className="panel-collapse" type="button" onClick={handlePanelCollapsed}>
          Hide panel
        </button>
        <div>
          <div className="brand-lockup">
            <AppLogo />
          </div>
          <h1>Replay your paraglider flight in 3D.</h1>
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
        flights={flights}
        followedFlightId={primaryFlight?.id ?? null}
        syncMode={syncMode}
      />
    </main>
  );
}
