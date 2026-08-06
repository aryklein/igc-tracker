"use client";

import { formatDuration } from "@/lib/flightMath";

const SPEEDS = [1, 5, 10, 20, 50, 100, 200];

export const TRAIL_DURATION_OPTIONS = [
  { label: "1 min", value: 1 },
  { label: "5 min", value: 5 },
  { label: "10 min", value: 10 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "Full flight", value: Number.POSITIVE_INFINITY },
] as const;

type PlaybackControlsProps = {
  currentMs: number;
  currentTimestamp: number | null;
  durationMs: number;
  isPlaying: boolean;
  speed: number;
  showNames: boolean;
  showAltitudes: boolean;
  trailOption: number;
  onPlayPause: () => void;
  onReset: () => void;
  onSeek: (elapsedMs: number) => void;
  onSpeedChange: (speed: number) => void;
  onShowNames: (enabled: boolean) => void;
  onShowAltitudes: (enabled: boolean) => void;
  onTrailChange: (option: number) => void;
};

export function PlaybackControls({
  currentMs,
  currentTimestamp,
  durationMs,
  isPlaying,
  speed,
  showNames,
  showAltitudes,
  trailOption,
  onPlayPause,
  onReset,
  onSeek,
  onSpeedChange,
  onShowNames,
  onShowAltitudes,
  onTrailChange,
}: PlaybackControlsProps) {
  const localTime = currentTimestamp
    ? new Date(currentTimestamp).toLocaleTimeString([], {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <div className="playback-card">
      <div className="playback-topline">
        <button aria-label={isPlaying ? "Pause" : "Play"} className="icon-button" type="button" onClick={onPlayPause}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button aria-label="Reset" className="icon-button" type="button" onClick={onReset}>
          ↺
        </button>
        <div className="show-labels">
          <label>
            <input type="checkbox" checked={showNames} onChange={() => onShowNames(!showNames)} />
            Show Names
          </label>
          <label>
            <input type="checkbox" checked={showAltitudes} onChange={() => onShowAltitudes(!showAltitudes)} />
            Show Altitudes
          </label>
        </div>
        <div className="trail-options">
          <div className="label">
          Trail:
          </div>
          <select name="trail-options" value={trailOption} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onTrailChange(Number(event.target.value))}>
            {TRAIL_DURATION_OPTIONS.map((option) => {
              return <option key={option.value} value={option.value}>{option.label}</option>
            })}
          </select>
        </div>
        <span>
          {formatDuration(currentMs)} / {formatDuration(durationMs)}
        </span>
      </div>
      <fieldset className="speed-list" aria-label="Playback speed">
        {SPEEDS.map((speedOption) => (
          <button
            className={speedOption === speed ? "active" : ""}
            key={speedOption}
            type="button"
            onClick={() => onSpeedChange(speedOption)}
          >
            {speedOption}x
          </button>
        ))}
      </fieldset>
      <label className="progress-control">
        <span className="progress-heading">
          <span>Flight progress</span>
          <strong>{localTime}</strong>
        </span>
        <input
          aria-label="Flight progress"
          max={durationMs}
          min={0}
          step={1000}
          type="range"
          value={Math.min(currentMs, durationMs)}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
