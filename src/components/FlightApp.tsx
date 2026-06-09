"use client";

import { useState } from "react";
import { CesiumFlightViewer } from "./CesiumFlightViewer";
import { FileUpload } from "./FileUpload";
import type { ParsedFlight } from "@/types/flight";

export function FlightApp() {
  const [flight, setFlight] = useState<ParsedFlight | null>(null);

  return (
    <main className="app-shell">
      <aside className="intro-panel">
        <div>
          <p className="eyebrow">IGC Tracker MVP</p>
          <h1>Replay your paraglider flight in 3D.</h1>
          <p className="intro-copy">A personal project by Ary Kleinerman.</p>
        </div>
        <FileUpload flight={flight} onFlightLoaded={setFlight} />
      </aside>
      <CesiumFlightViewer flight={flight} />
    </main>
  );
}
