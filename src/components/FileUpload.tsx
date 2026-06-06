"use client";

import { useState } from "react";
import { parseIgcFile } from "@/lib/igcParser";
import type { ParsedFlight } from "@/types/flight";

type FileUploadProps = {
  onFlightLoaded: (flight: ParsedFlight) => void;
};

export function FileUpload({ onFlightLoaded }: FileUploadProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      onFlightLoaded(parseIgcFile(content, file.name));
      setError(null);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not parse this IGC file.");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="upload-card">
      <label className="upload-target">
        <span>Upload IGC Flight</span>
        <strong>Choose .igc file</strong>
        <input type="file" onChange={handleChange} />
      </label>
      {error ? <p className="upload-error">{error}</p> : null}
    </div>
  );
}
