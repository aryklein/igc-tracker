"use client";

import { formatDuration } from "@/lib/flightMath";

const SPEEDS = [1, 4, 8, 16, 32];

type PlaybackControlsProps = {
  currentMs: number;
  currentTimestamp: number | null;
  durationMs: number;
  isPlaying: boolean;
  showLabels: boolean;
  followDirection: boolean;
  onFollowDirectionChange: (enabled: boolean) => void;
  orbitalView: boolean;
  onOrbitalViewChange: (enabled: boolean) => void;
  speed: number;
  onPlayPause: () => void;
  onReset: () => void;
  onSeek: (elapsedMs: number) => void;
  onShowLabelsChange: (enabled: boolean) => void;
  onSpeedChange: (speed: number) => void;
};

export function PlaybackControls({
  currentMs,
  currentTimestamp,
  durationMs,
  isPlaying,
  showLabels,
  followDirection,
  onFollowDirectionChange,
  orbitalView,
  onOrbitalViewChange,
  speed,
  onPlayPause,
  onReset,
  onSeek,
  onShowLabelsChange,
  onSpeedChange,
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
        <label className="label-toggle">
          <input type="checkbox" checked={showLabels} onChange={(event) => onShowLabelsChange(event.target.checked)} />
          Labels
        </label>
        <label className="label-toggle" title="Smoothly follow the pilot's direction of travel; zoom remains available">
          <input type="checkbox" checked={followDirection} onChange={(event) => onFollowDirectionChange(event.target.checked)} />
          Follow Pilot
        </label>
        <label className="label-toggle" title="Slowly circle the pilot, even while paused. Drag to adjust the view; orbit resumes on release. Zoom remains available.">
          <input type="checkbox" checked={orbitalView} onChange={(event) => onOrbitalViewChange(event.target.checked)} />
          Orbital View
        </label>
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
