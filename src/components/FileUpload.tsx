"use client";

import { useRef, useState } from "react";
import { parseIgcFile } from "@/lib/igcParser";
import type { ParsedFlight } from "@/types/flight";

type FileUploadProps = {
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

export function FileUpload({ onFlightLoaded }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setError(null);
      setStatus(`Reading ${file.name}...`);
      const content = await readFileAsText(file);
      const flight = parseIgcFile(content, file.name);

      onFlightLoaded(flight);
      setStatus(`Loaded ${flight.points.length.toLocaleString()} fixes from ${file.name}.`);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not parse this IGC file.");
      setStatus(null);
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="upload-card">
      <button className="upload-target" type="button" onClick={() => inputRef.current?.click()}>
        <span>Upload IGC Flight</span>
        <strong>Choose IGC file from Files</strong>
      </button>
      <input
        ref={inputRef}
        accept=".igc,.IGC,text/plain,application/octet-stream"
        className="file-input"
        type="file"
        onChange={handleChange}
      />
      <p className="upload-help">On mobile, choose Browse or Files and select your `.igc` file.</p>
      {status ? <p className="upload-status">{status}</p> : null}
      {error ? <p className="upload-error">{error}</p> : null}
    </div>
  );
}
