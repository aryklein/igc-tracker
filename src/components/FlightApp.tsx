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
          <p className="intro-copy">
            Upload an IGC file from your vario. The track is parsed locally in your browser and drawn progressively
            behind the paraglider dot.
          </p>
        </div>
        <FileUpload onFlightLoaded={setFlight} />
        <div className="hint-list">
          <span>Map: satellite imagery when Cesium ion is configured</span>
          <span>Mouse drag: orbit around the paraglider</span>
          <span>Mouse wheel: zoom in and out</span>
          <span>Speeds: 1x, 4x, 8x, 16x, 32x</span>
        </div>
      </aside>
      <CesiumFlightViewer flight={flight} />
    </main>
  );
}
