"use client";

import { useState } from "react";
import { CesiumFlightViewer } from "./CesiumFlightViewer";
import { FileUpload } from "./FileUpload";
import type { ParsedFlight } from "@/types/flight";

type FlightAppProps = {
  initialFlight?: ParsedFlight | null;
  initialSourceText?: string | null;
  allowSharing?: boolean;
};

export function FlightApp({ initialFlight = null, initialSourceText = null, allowSharing = true }: FlightAppProps) {
  const [flight, setFlight] = useState<ParsedFlight | null>(initialFlight);
  const [sourceText, setSourceText] = useState<string | null>(initialSourceText);

  function handleFlightLoaded(nextFlight: ParsedFlight, nextSourceText: string) {
    setFlight(nextFlight);
    setSourceText(nextSourceText);
  }

  return (
    <main className="app-shell">
      <aside className="intro-panel">
        <div>
          <p className="eyebrow">IGC Tracker MVP</p>
          <h1>Replay your paraglider flight in 3D.</h1>
          <p className="intro-copy">A personal project by Ary Kleinerman.</p>
        </div>
        <FileUpload flight={flight} sourceText={sourceText} allowSharing={allowSharing} onFlightLoaded={handleFlightLoaded} />
      </aside>
      <CesiumFlightViewer flight={flight} />
    </main>
  );
}
