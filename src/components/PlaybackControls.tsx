"use client";

import { formatDuration } from "@/lib/flightMath";

const SPEEDS = [1, 4, 8, 16, 32];

type PlaybackControlsProps = {
  currentMs: number;
  durationMs: number;
  isPlaying: boolean;
  speed: number;
  onPlayPause: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
};

export function PlaybackControls({
  currentMs,
  durationMs,
  isPlaying,
  speed,
  onPlayPause,
  onReset,
  onSpeedChange,
}: PlaybackControlsProps) {
  const progress = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;

  return (
    <div className="playback-card">
      <div className="playback-topline">
        <button type="button" onClick={onPlayPause}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={onReset}>
          Reset
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
      <div className="progress-track" aria-hidden="true">
        <div style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
