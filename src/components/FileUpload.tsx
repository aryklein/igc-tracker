"use client";

import { useRef, useState } from "react";
import { formatDistance, formatDuration } from "@/lib/flightMath";
import { parseIgcFile } from "@/lib/igcParser";
import type { ParsedFlight } from "@/types/flight";

type FileUploadProps = {
  flight: ParsedFlight | null;
  onFlightLoaded: (flight: ParsedFlight) => void;
};

function readFileAsText(file: File) {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("The selected file could not be read as text."));
      }
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read the selected file.")));
    reader.readAsText(file);
  });
}

export function FileUpload({ flight, onFlightLoaded }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setError(null);
      const content = await readFileAsText(file);
      const flight = parseIgcFile(content, file.name);

      onFlightLoaded(flight);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not parse this IGC file.");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <>
      <div className="upload-card">
      <button className="upload-target" type="button" onClick={() => inputRef.current?.click()}>
        <strong>Upload IGC Flight</strong>
      </button>
      <input
        ref={inputRef}
        accept=".igc,.IGC,text/plain,application/octet-stream"
        className="file-input"
        type="file"
        onChange={handleChange}
      />
      {error ? <p className="upload-error">{error}</p> : null}
      </div>
      {flight ? (
        <section className="flight-summary" aria-label="Loaded flight summary">
          <span>Loaded flight</span>
          <strong>{flight.filename}</strong>
          <dl>
            <div>
              <dt>Time</dt>
              <dd>{formatDuration(flight.durationMs)}</dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>{formatDistance(flight.distanceMeters)}</dd>
            </div>
            <div>
              <dt>Altitude</dt>
              <dd>
                {Math.round(flight.minAltitude)}-{Math.round(flight.maxAltitude)} m
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </>
  );
}
