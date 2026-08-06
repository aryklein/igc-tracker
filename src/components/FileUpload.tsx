"use client";

import { useRef, useState } from "react";
import { formatDistance, formatDuration } from "@/lib/flightMath";
import { parseIgcFile } from "@/lib/igcParser";
import type { ComparedFlight, FlightSyncMode, ParsedFlight } from "@/types/flight";

const MAX_COMPARISON_FLIGHTS = 10;

type FileUploadProps = {
  flights: ComparedFlight[];
  primaryFlightId: string | null;
  allowSharing: boolean;
  onFlightsLoaded: (flights: Array<{ flight: ParsedFlight; sourceText: string }>) => void;
  onPrimaryFlightChange: (id: string) => void;
  onFlightRemoved: (id: string) => void;
  syncMode: FlightSyncMode;
  onSyncModeChange: (syncMode: FlightSyncMode) => void;
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

export function FileUpload({
  flights,
  primaryFlightId,
  allowSharing,
  onFlightsLoaded,
  onPrimaryFlightChange,
  onFlightRemoved,
  syncMode,
  onSyncModeChange,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [didCopyShareLink, setDidCopyShareLink] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const primaryFlight = flights.find((entry) => entry.id === primaryFlightId) ?? null;
  const canShare = allowSharing && flights.length === 1 && primaryFlight?.sourceText;

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = [...(event.target.files ?? [])];
    const remainingSlots = MAX_COMPARISON_FLIGHTS - flights.length;

    if (selectedFiles.length === 0) {
      return;
    }

    try {
      setError(null);
      const files = selectedFiles.slice(0, Math.max(0, remainingSlots));
      const loadedFlights: Array<{ flight: ParsedFlight; sourceText: string }> = [];
      const failedFiles: string[] = [];
      const duplicateFiles: string[] = [];
      const sourceTexts = new Set(flights.map((entry) => entry.sourceText).filter((sourceText): sourceText is string => Boolean(sourceText)));

      for (const file of files) {
        try {
          const content = await readFileAsText(file);

          if (sourceTexts.has(content)) {
            duplicateFiles.push(file.name);
            continue;
          }

          loadedFlights.push({ flight: parseIgcFile(content, file.name), sourceText: content });
          sourceTexts.add(content);
        } catch {
          failedFiles.push(file.name);
        }
      }

      if (loadedFlights.length > 0) {
        setShareError(null);
        setShareLink(null);
        setShareExpiresAt(null);
        setDidCopyShareLink(false);
        onFlightsLoaded(loadedFlights);
      }

      if (remainingSlots <= 0) {
        setError(`You can compare up to ${MAX_COMPARISON_FLIGHTS} flights at once.`);
      } else if (selectedFiles.length > remainingSlots) {
        setError(`Added ${loadedFlights.length} flight${loadedFlights.length === 1 ? "" : "s"}. You can compare up to ${MAX_COMPARISON_FLIGHTS} flights at once.`);
      } else if (failedFiles.length > 0) {
        setError(`Could not parse: ${failedFiles.join(", ")}.`);
      } else if (duplicateFiles.length > 0) {
        setError(`Already loaded: ${duplicateFiles.join(", ")}.`);
      }
    } finally {
      event.target.value = "";
    }
  }

  async function handleShare() {
    if (!primaryFlight || !primaryFlight.sourceText || isSharing) {
      return;
    }

    try {
      setIsSharing(true);
      setShareError(null);
      const response = await fetch("/api/flights/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: primaryFlight.sourceText,
          filename: primaryFlight.flight.filename,
          title: primaryFlight.flight.filename,
        }),
      });
      const payload = await readShareResponse(response);

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Could not create share link.");
      }

      const absoluteUrl = new URL(payload.url, window.location.origin).toString();

      setShareLink(absoluteUrl);
      setShareExpiresAt(payload.expiresAt ?? null);
      const didCopy = await navigator.clipboard
        ?.writeText(absoluteUrl)
        .then(() => true)
        .catch(() => false);

      setDidCopyShareLink(Boolean(didCopy));
    } catch (unknownError) {
      setShareError(unknownError instanceof Error ? unknownError.message : "Could not create share link.");
    } finally {
      setIsSharing(false);
    }
  }

  async function handleCopyShareLink() {
    if (!shareLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareLink);
      setShareError(null);
      setDidCopyShareLink(true);
    } catch {
      setShareError("Could not copy automatically. Long-press or open the link to copy it.");
    }
  }

  return (
    <>
      <div className="upload-card">
        <button className="upload-target" type="button" onClick={() => inputRef.current?.click()}>
          <strong>{flights.length === 0 ? "Upload IGC Flights" : "Add IGC Flight"}</strong>
          <span>{flights.length}/{MAX_COMPARISON_FLIGHTS} flights loaded</span>
        </button>
        <input
          ref={inputRef}
          accept=".igc,.IGC,text/plain,application/octet-stream"
          className="file-input"
          multiple
          type="file"
          onChange={handleChange}
        />
        {error ? <p className="upload-error">{error}</p> : null}
        {canShare ? (
          <div className="share-panel">
            <button type="button" onClick={handleShare} disabled={isSharing}>
               {isSharing ? "Creating link..." : "Share flight for 72h"}
            </button>
            <p>Anyone with the link can view this track until it expires.</p>
            {shareLink ? (
              <div className="share-link">
                <span>Share link ready</span>
                <button type="button" onClick={handleCopyShareLink}>
                  {didCopyShareLink ? "Copied" : "Copy link"}
                </button>
                <input aria-label="Share link" readOnly value={shareLink} onFocus={(event) => event.target.select()} />
                {shareExpiresAt ? <small>Expires {new Date(shareExpiresAt).toLocaleString()}</small> : null}
              </div>
            ) : null}
            {shareError ? <p className="upload-error">{shareError}</p> : null}
          </div>
        ) : null}
        {allowSharing && flights.length > 1 ? <p className="upload-status">Comparison sessions stay in this browser and cannot be shared yet.</p> : null}
      </div>
      {flights.length > 0 ? (
        <section className="comparison-flights" aria-label="Compared flights">
          <div className="comparison-flights-heading">
            <span>Compared flights</span>
            <small>Follow one pilot and compare the moving markers.</small>
          </div>
          {flights.length > 1 ? (
            <fieldset className="sync-mode" aria-label="Comparison time sync">
              <legend>Sync time</legend>
              <button className={syncMode === "actual" ? "active" : ""} type="button" onClick={() => onSyncModeChange("actual")}>
                Actual time
              </button>
              <button className={syncMode === "launch" ? "active" : ""} type="button" onClick={() => onSyncModeChange("launch")}>
                From launch
              </button>
            </fieldset>
          ) : null}
          {flights.map((entry) => {
            const displayName = entry.flight.pilotName ?? entry.flight.filename;
            const isPrimary = entry.id === primaryFlightId;

            return (
              <div className={isPrimary ? "comparison-flight active" : "comparison-flight"} key={entry.id}>
                <button type="button" onClick={() => onPrimaryFlightChange(entry.id)}>
                  <i aria-hidden="true" style={{ background: entry.color }} />
                  <span>{displayName}</span>
                  <small>{isPrimary ? "Following" : "Follow"}</small>
                </button>
                <button aria-label={`Remove ${displayName}`} className="comparison-remove" type="button" onClick={() => onFlightRemoved(entry.id)}>
                  ×
                </button>
              </div>
            );
          })}
        </section>
      ) : null}
      {primaryFlight ? (
        <section className="flight-summary" aria-label="Loaded flight summary">
          <span>Following flight</span>
          <dl>
            <div>
              <dt>Time</dt>
              <dd>{formatDuration(primaryFlight.flight.durationMs)}</dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>{formatDistance(primaryFlight.flight.distanceMeters)}</dd>
            </div>
            <div>
              <dt>Altitude</dt>
              <dd>
                {Math.round(primaryFlight.flight.minAltitude)}-{Math.round(primaryFlight.flight.maxAltitude)} m
              </dd>
            </div>
            {primaryFlight.flight.pilotName ? (
              <div>
                <dt>Pilot</dt>
                <dd>{primaryFlight.flight.pilotName}</dd>
              </div>
            ) : null}
            {primaryFlight.flight.gliderModel ? (
              <div>
                <dt>Glider</dt>
                <dd>{primaryFlight.flight.gliderModel}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
    </>
  );
}
