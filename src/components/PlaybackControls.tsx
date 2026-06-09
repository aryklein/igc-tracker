"use client";

import { formatDuration } from "@/lib/flightMath";

const SPEEDS = [1, 4, 8, 16, 32];

type PlaybackControlsProps = {
  currentMs: number;
  currentTimestamp: number | null;
  durationMs: number;
  isPlaying: boolean;
  speed: number;
  onPlayPause: () => void;
  onReset: () => void;
  onSeek: (elapsedMs: number) => void;
  onSpeedChange: (speed: number) => void;
};

export function PlaybackControls({
  currentMs,
  currentTimestamp,
  durationMs,
  isPlaying,
  speed,
  onPlayPause,
  onReset,
  onSeek,
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
