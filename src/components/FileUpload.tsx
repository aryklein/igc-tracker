"use client";

import { useRef, useState } from "react";
import { formatDistance, formatDuration } from "@/lib/flightMath";
import { parseIgcFile } from "@/lib/igcParser";
import type { ParsedFlight } from "@/types/flight";

type FileUploadProps = {
  flight: ParsedFlight | null;
  sourceText: string | null;
  onFlightLoaded: (flight: ParsedFlight, sourceText: string) => void;
};

type ShareResponse = {
  error?: string;
  url?: string;
  expiresAt?: string;
};

async function readShareResponse(response: Response): Promise<ShareResponse> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as ShareResponse;
  } catch {
    return { error: text };
  }
}

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

export function FileUpload({ flight, sourceText, onFlightLoaded }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setError(null);
      const content = await readFileAsText(file);
      const flight = parseIgcFile(content, file.name);

      setShareError(null);
      setShareLink(null);
      setShareExpiresAt(null);
      onFlightLoaded(flight, content);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Could not parse this IGC file.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleShare() {
    if (!flight || !sourceText || isSharing) {
      return;
    }

    try {
      setIsSharing(true);
      setShareError(null);
      const response = await fetch("/api/flights/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: sourceText, filename: flight.filename, title: flight.filename }),
      });
      const payload = await readShareResponse(response);

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Could not create share link.");
      }

      const absoluteUrl = new URL(payload.url, window.location.origin).toString();

      setShareLink(absoluteUrl);
      setShareExpiresAt(payload.expiresAt ?? null);
      await navigator.clipboard?.writeText(absoluteUrl).catch(() => undefined);
    } catch (unknownError) {
      setShareError(unknownError instanceof Error ? unknownError.message : "Could not create share link.");
    } finally {
      setIsSharing(false);
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
          {sourceText ? (
            <div className="share-panel">
              <button type="button" onClick={handleShare} disabled={isSharing}>
                {isSharing ? "Creating link..." : "Share flight for 24h"}
              </button>
              <p>Anyone with the link can view this track until it expires.</p>
              {shareLink ? (
                <div className="share-link">
                  <a href={shareLink}>{shareLink}</a>
                  {shareExpiresAt ? <small>Expires {new Date(shareExpiresAt).toLocaleString()}</small> : null}
                </div>
              ) : null}
              {shareError ? <p className="upload-error">{shareError}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
